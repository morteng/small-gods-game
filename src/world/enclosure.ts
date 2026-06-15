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

    const run = barrierRunFromType(typeId, rectRing(minX, minY, maxX, maxY), [{ t: gateT, width: gateW }]);
    if (!run) continue;
    out.push({ id: `${poiId}_croft_${minX}_${minY}`, run });
  }
  return out;
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

  // Walk the ring; a perimeter tile that is a road or water becomes a gate/opening.
  const total = 2 * dx + 2 * dy;
  const openAt: boolean[] = [];
  const pts: Pt[] = [];
  for (let t = 0; t <= total; t += 1) {
    const [px, py] = pointOnPath(path, t);
    const x = Math.round(px), y = Math.round(py);
    pts.push([x, y]);
    openAt.push(args.isRoad(x, y) || args.isWater(x, y));
  }
  // Merge consecutive open steps into gate spans (centre t + padded width).
  const gates: BarrierGate[] = [];
  let runStart = -1;
  for (let i = 0; i <= openAt.length; i++) {
    const open = openAt[i] ?? false;
    if (open && runStart < 0) runStart = i;
    else if (!open && runStart >= 0) {
      const centre = (runStart + (i - 1)) / 2;
      const width = Math.max(gateW, (i - 1 - runStart) + gateW * 0.5);
      gates.push({ t: centre, width });
      runStart = -1;
    }
  }

  const run = barrierRunFromType(typeId, path, gates);
  if (!run) return null;
  return { id: `${args.poiId}_ring`, run };
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
