// src/world/enclosure.ts
//
// DC-3 (write side, barriers half) — derive linear enclosures around crofts and
// settlements from the grounded `barrierType` fact catalogue, as the connectome's
// `encloseExisting` move: the protected thing (a burgage lot, a whole settlement)
// is already placed, and the barrier follows its boundary.
//
// Pure + deterministic (seeded rng, no Math.random): returns `BarrierRun`s that the
// building-placer commits to the World via `placeBarrier`. The earthwork half of
// DC-3 (motte/ditch/rampart writing the heightfield) waits on the shared terrain
// deformation channel; barriers need no terrain write, so they ship now.
//
// Dimensions + selection come from `src/catalogue/packs/medieval-europe/
// barrier-types.ts` (Wikipedia-grounded). Croft scale → a hedge/fence/wall ring per
// built lot; settlement scale → one ring around the built area, the rung
// (none / palisade / town wall) chosen by settlement size + wealth + era.

import type { BarrierRun, BarrierKind, BarrierGate } from '@/world/barrier';
import type { Lot } from '@/world/settlement-plan';
import type { Era } from '@/core/era';
import { catalogue, type BarrierTypeFields } from '@/catalogue';
import { mToTiles } from '@/render/scale-contract';

/** Minimal seeded RNG seam — both `core/rng` Rng and `core/noise` Random satisfy it. */
export interface MinRng { next(): number }

export interface EnclosureCtx {
  era: Era;
  wealth?: string;
  region?: string;
}

export interface EnclosureRun {
  id: string;
  run: BarrierRun;
}

type Pt = [number, number];

/** True when a barrierType fact's applicability admits the context. */
function applies(f: { applicability?: { eras?: Era[]; regions?: string[]; wealth?: string[] } }, ctx: EnclosureCtx): boolean {
  const a = f.applicability;
  if (!a) return true;
  if (a.eras && !a.eras.includes(ctx.era)) return false;
  // Region is OPT-IN: a region-specific enclosure (e.g. upland drystone walling) is a
  // characteristic of that region, so it is excluded unless the context names a
  // matching region — unlike the catalogue's default "unset axis = unconstrained".
  if (a.regions && (!ctx.region || !a.regions.includes(ctx.region))) return false;
  // Wealth keeps the standard semantics (unset = allowed): settlement size already
  // implies the means for a town wall, so absent wealth info we don't block it.
  if (a.wealth && ctx.wealth && !a.wealth.includes(ctx.wealth)) return false;
  return true;
}

/** All applicable barrierType facts at the given scale. */
function applicableTypes(scale: 'croft' | 'settlement', ctx: EnclosureCtx) {
  return catalogue
    .all<BarrierTypeFields>('barrierType')
    .filter((e) => e.fields.scale === scale && applies(e, ctx));
}

/** Build a `BarrierRun` from a barrierType fact id, a path, and gate spans. */
export function barrierRunFromType(typeId: string, path: Pt[], gates: BarrierGate[]): BarrierRun | null {
  const fact = catalogue.get<BarrierTypeFields>('barrierType', typeId);
  if (!fact || path.length < 2) return null;
  const f = fact.fields;
  return {
    kind: f.barrierKind as BarrierKind,
    path,
    height: mToTiles(f.heightM),
    thickness: f.thicknessTiles,
    material: f.material,
    crenellated: f.crenellated,
    posts: f.posts,
    gates,
  };
}

/**
 * Pick the settlement-scale enclosure rung: the most substantial applicable barrier
 * whose `minBuildings` the settlement reaches. Hamlets (below the lowest rung) get
 * `null` — only their crofts are hedged.
 */
export function selectSettlementEnclosure(buildingCount: number, ctx: EnclosureCtx): string | null {
  const eligible = applicableTypes('settlement', ctx)
    .filter((e) => buildingCount >= (e.fields.minBuildings ?? 0))
    .sort((a, b) => (b.fields.minBuildings ?? 0) - (a.fields.minBuildings ?? 0));
  return eligible[0]?.id ?? null;
}

/** Deterministically pick a croft enclosure, biased toward the living hedge. */
export function selectCroftEnclosure(rng: MinRng, ctx: EnclosureCtx): string | null {
  const types = applicableTypes('croft', ctx);
  if (types.length === 0) return null;
  // Bias toward the hedge (the commonest), else any applicable croft type.
  const hedge = types.find((t) => t.id === 'hedge');
  if (hedge && rng.next() < 0.6) return hedge.id;
  return types[Math.floor(rng.next() * types.length)].id;
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

/** Closed rectangle ring path (5 points) tracing the tile-corner boundary. */
function rectRing(minX: number, minY: number, maxX: number, maxY: number): Pt[] {
  return [
    [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY],
  ];
}

/**
 * Enclose each built burgage lot with a croft ring (hedge/fence/wall), gated on the
 * street side so the door stays reachable.
 */
export function deriveCroftEnclosures(
  lots: Lot[], poiId: string, rng: MinRng, ctx: EnclosureCtx,
  isBuilding?: (x: number, y: number) => boolean,
): EnclosureRun[] {
  const out: EnclosureRun[] = [];
  for (const lot of lots) {
    if (!lot.buildingId || lot.tiles.length === 0) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of lot.tiles) {
      if (t.x < minX) minX = t.x; if (t.x > maxX) maxX = t.x;
      if (t.y < minY) minY = t.y; if (t.y > maxY) maxY = t.y;
    }
    const dx = maxX - minX, dy = maxY - minY;
    if (dx < 1 || dy < 1) continue; // too small/thin to enclose

    const typeId = selectCroftEnclosure(rng, ctx);
    if (!typeId) continue;
    const gateW = Math.min(
      catalogue.get<BarrierTypeFields>('barrierType', typeId)?.fields.gateWidthTiles ?? 1.5,
      Math.max(dx, dy),
    );

    // Gate on the street-facing edge (road is on the −side side of the lot).
    const [sx, sy] = lot.side;
    let gateT: number;
    if (sy > 0) gateT = dx / 2;                       // road north → top edge
    else if (sy < 0) gateT = dx + dy + dx / 2;        // road south → bottom edge
    else if (sx > 0) gateT = dx + dy + dx + dy / 2;   // road west  → left edge
    else gateT = dx + dy / 2;                          // road east  → right edge

    // A tight lot can put the croft ring directly over its own building's walls
    // (the footprint reaches the lot edge). Open the ring (gate) wherever it
    // crosses a building structure cell, so no hedge/fence runs through a wall.
    const path = rectRing(minX, minY, maxX, maxY);
    const gates: BarrierGate[] = [{ t: gateT, width: gateW }];
    if (isBuilding) gates.push(...gatesWhereOpen(path, 2 * dx + 2 * dy, isBuilding, gateW));

    const run = barrierRunFromType(typeId, path, gates);
    if (!run) continue;
    out.push({ id: `${poiId}_croft_${minX}_${minY}`, run });
  }
  return out;
}

/**
 * Walk a closed ring SLAB-BY-SLAB (the same unit segments `barrierItems` draws)
 * and merge the spans where the slab crosses an `isOpen` cell into gate spans.
 *
 * Two invariants keep this in lockstep with the renderer (`iso-barrier.ts`),
 * which drops a slab `[k, k+1]` when its MIDPOINT `k+0.5` falls in a gate:
 *   - we sample at slab midpoints `k+0.5` (not integer vertices) — no half-tile
 *     phase drift between "where we open a gate" and "which slab gets dropped";
 *   - a slab counts as blocked if EITHER endpoint cell or its midpoint cell is
 *     open, so a slab straddling two building cells can't slip through the seam.
 * The emitted gate covers the full run of blocked slab midpoints plus the
 * configured door padding.
 */
function gatesWhereOpen(
  path: Pt[], total: number, isOpen: (x: number, y: number) => boolean, gateW: number,
): BarrierGate[] {
  const cellOpen = (t: number): boolean => {
    const [px, py] = pointOnPath(path, t);
    return isOpen(Math.round(px), Math.round(py));
  };
  // One sample per unit slab: blocked if the slab touches an open cell anywhere.
  const slabCount = Math.max(0, Math.ceil(total));
  const blocked: boolean[] = [];
  for (let k = 0; k < slabCount; k++) {
    const t1 = Math.min(k + 1, total);
    blocked.push(cellOpen(k) || cellOpen((k + t1) / 2) || cellOpen(t1));
  }
  const gates: BarrierGate[] = [];
  let runStart = -1;
  for (let k = 0; k <= slabCount; k++) {
    const isBlocked = blocked[k] ?? false;
    if (isBlocked && runStart < 0) runStart = k;
    else if (!isBlocked && runStart >= 0) {
      const last = k - 1;
      // blocked slab midpoints span [runStart+0.5, last+0.5]
      const centre = (runStart + last + 1) / 2;
      const width = Math.max(gateW, (last - runStart) + 1 + gateW * 0.5);
      gates.push({ t: centre, width });
      runStart = -1;
    }
  }
  return gates;
}

/**
 * Enclose the whole settlement with one defensive ring (palisade or town wall),
 * gated where the bounding ring crosses a road OR water — the "incorporate rivers
 * and roads into the line" rule. Returns `null` for settlements below the lowest
 * rung (hamlets), or when the ring would be degenerate.
 */
export function deriveSettlementRing(args: {
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  mapW: number; mapH: number;
  margin?: number;
  buildingCount: number;
  poiId: string;
  isWater: (x: number, y: number) => boolean;
  isRoad: (x: number, y: number) => boolean;
  /** A building structure cell — the ring opens (gates) rather than running through it. */
  isBuilding?: (x: number, y: number) => boolean;
  ctx: EnclosureCtx;
}): EnclosureRun | null {
  const typeId = selectSettlementEnclosure(args.buildingCount, args.ctx);
  if (!typeId) return null;

  const margin = args.margin ?? 2;
  const minX = Math.max(0, args.bbox.minX - margin);
  const minY = Math.max(0, args.bbox.minY - margin);
  const maxX = Math.min(args.mapW - 1, args.bbox.maxX + margin);
  const maxY = Math.min(args.mapH - 1, args.bbox.maxY + margin);
  const dx = maxX - minX, dy = maxY - minY;
  if (dx < 2 || dy < 2) return null;

  const path = rectRing(minX, minY, maxX, maxY);
  const gateW = catalogue.get<BarrierTypeFields>('barrierType', typeId)?.fields.gateWidthTiles ?? 3;
  const centroid: Pt = [(minX + maxX) / 2, (minY + maxY) / 2];

  // Walk the ring at slab midpoints (same as the croft rings — keeps the renderer in lockstep).
  // Distinguish WHY each opening exists so the defences read believably:
  //   • ROAD crossings → real GATES (gatehouse + timber leaf).
  //   • WATER / BUILDING crossings → plain GAPS (the line just opens; no gatehouse).
  const total = 2 * dx + 2 * dy;
  const roadGates = gatesWhereOpen(path, total, args.isRoad, gateW).map((g) => ({ ...g, kind: 'gate' as const }));
  const softOpen = (x: number, y: number): boolean => args.isWater(x, y) || (args.isBuilding?.(x, y) ?? false);
  const softGaps = gatesWhereOpen(path, total, softOpen, gateW).map((g) => ({ ...g, kind: 'gap' as const }));
  // TERRAIN AS DEFENCE: a whole ring side fronted by water (a river bend, a lakeshore, the coast)
  // needs no wall — the water is the line. Open that side entirely, so the town is walled only on
  // its approachable landward sides (the authentic waterfront town).
  const waterGaps = waterFrontedSides(path, centroid, args.isWater).map((g) => ({ ...g, kind: 'gap' as const }));
  const gates: BarrierGate[] = [...roadGates, ...softGaps, ...waterGaps];

  const run = barrierRunFromType(typeId, path, gates);
  if (!run) return null;
  // Mark the ring centre so the geometry can face parapet/merlons/hoardings OUTWARD.
  run.centroid = centroid;
  // A crenellated masonry town wall carries timber hoardings — the wartime defensive galleries.
  if (run.crenellated && (run.material === 'stone' || run.material === 'brick')) run.hoarded = true;
  return { id: `${args.poiId}_ring`, run };
}

/**
 * Classify each SIDE of a closed ring by what lies just OUTSIDE it, and return a full-side gap for
 * every side fronted by water — a river bend, lakeshore or coast the wall would only duplicate.
 * Samples a few points along each side, offset outward (away from `centroid`) by `outDist` tiles;
 * a side that reads mostly water is opened entirely. This is how walls "use the terrain": you don't
 * wall the river, you let it be the wall and fortify only the landward approaches.
 */
function waterFrontedSides(
  path: Pt[], centroid: Pt, isWater: (x: number, y: number) => boolean,
  sampleN = 5, outDist = 2.5, waterFrac = 0.6,
): BarrierGate[] {
  const gaps: BarrierGate[] = [];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen > 1e-6) {
      const dxu = (bx - ax) / segLen, dyu = (by - ay) / segLen;
      let nx = -dyu, ny = dxu;                                   // a side normal
      const mx = (ax + bx) / 2, my = (ay + by) / 2;             // side midpoint
      if (nx * (mx - centroid[0]) + ny * (my - centroid[1]) < 0) { nx = -nx; ny = -ny; }   // point OUTWARD
      let wet = 0;
      for (let k = 1; k <= sampleN; k++) {
        const t = k / (sampleN + 1);
        const px = ax + (bx - ax) * t + nx * outDist, py = ay + (by - ay) * t + ny * outDist;
        if (isWater(Math.round(px), Math.round(py))) wet++;
      }
      if (wet / sampleN >= waterFrac) gaps.push({ t: acc + segLen / 2, width: segLen + 2 });   // open the whole side
    }
    acc += segLen;
  }
  return gaps;
}

/** Map a path distance `t` (tiles) to a world point along the polyline. */
function pointOnPath(path: Pt[], t: number): Pt {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (t <= acc + len) { const u = (t - acc) / (len || 1); return [ax + (bx - ax) * u, ay + (by - ay) * u]; }
    acc += len;
  }
  return path[path.length - 1];
}
