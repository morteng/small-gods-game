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

/** Perpendicular distance from p to the segment a→b (for polyline simplification). */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

/** Ramer–Douglas–Peucker simplify of an OPEN polyline (endpoints kept). */
function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

/**
 * Simplify a CLOSED radial ring (open list of N samples in angular order) to a low-vertex
 * polygon, escalating epsilon until the vertex count is within `maxVerts` so tower/compose
 * cost stays bounded. Returns an OPEN vertex list (the caller closes it).
 */
function simplifyRing(samples: Pt[], eps0: number, maxVerts: number): Pt[] {
  // Treat the ring as an open path start..end..start-repeat so RDP can drop the seam vertex too.
  let eps = eps0;
  for (let iter = 0; iter < 8; iter++) {
    const open = [...samples, samples[0]];
    const s = rdp(open, eps);
    const verts = s.slice(0, -1);                       // drop the repeated seam point
    if (verts.length <= maxVerts || verts.length <= 4) return verts;
    eps *= 1.5;
  }
  const open = [...samples, samples[0]];
  return rdp(open, eps).slice(0, -1);
}

/**
 * TERRAIN-TRACED settlement ring. Instead of an axis-aligned bounding box, trace a star-shaped
 * polygon around the built cluster that FOLLOWS nearby terrain: each of N rays from the centre is
 * pushed out just far enough to enclose the buildings in its sector (+margin), then — where a
 * riverbank / lakeshore / coast lies close outside the town — PULLED back in to sit just landward
 * of the waterline. The result hugs the water where water is near and rounds the cluster elsewhere;
 * being star-shaped it can never self-intersect. Simplified to a handful of vertices so a corner
 * drum tower lands only at a real turn. Returns null (→ rectangle fallback) when there are too few
 * building cells to trace a meaningful shape.
 */
function traceRing(args: {
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  mapW: number; mapH: number; margin: number;
  isWater: (x: number, y: number) => boolean;
  isBuilding?: (x: number, y: number) => boolean;
}): { path: Pt[]; centroid: Pt } | null {
  const { bbox, mapW, mapH, margin, isWater, isBuilding } = args;
  if (!isBuilding) return null;
  // Gather building cells within the bbox + their centroid.
  const cells: Pt[] = [];
  let sx = 0, sy = 0;
  for (let y = Math.max(0, bbox.minY); y <= Math.min(mapH - 1, bbox.maxY); y++) {
    for (let x = Math.max(0, bbox.minX); x <= Math.min(mapW - 1, bbox.maxX); x++) {
      if (isBuilding(x, y)) { cells.push([x, y]); sx += x; sy += y; }
    }
  }
  if (cells.length < 6) return null;                    // too small — a rectangle is fine
  const cx = sx / cells.length, cy = sy / cells.length;

  const N = 96;
  const core = new Array<number>(N).fill(0);            // town edge (no margin) per ray bucket
  for (const [x, y] of cells) {
    const a = Math.atan2(y - cy, x - cx);
    const k = ((Math.round((a / (2 * Math.PI)) * N) % N) + N) % N;
    const d = Math.hypot(x - cx, y - cy);
    if (d > core[k]) core[k] = d;
  }
  // Windowed circular max so a ray falling BETWEEN two building bearings still encloses them,
  // and a floor of the cluster's half-diagonal keeps the ring from denting into empty sectors.
  const halfDiag = 0.5 * Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  const floorR = 0.4 * halfDiag;
  const coreS = new Array<number>(N);
  for (let k = 0; k < N; k++) {
    let m = 0;
    for (let w = -2; w <= 2; w++) { const j = ((k + w) % N + N) % N; if (core[j] > m) m = core[j]; }
    coreS[k] = Math.max(m, floorR);
  }

  const snapBand = margin + 3;                           // how far out we look for a bank to hug
  const clampX = (v: number): number => Math.max(0, Math.min(mapW - 1, v));
  const clampY = (v: number): number => Math.max(0, Math.min(mapH - 1, v));
  const samples: Pt[] = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * 2 * Math.PI, dx = Math.cos(a), dy = Math.sin(a);
    const coreR = coreS[k];
    let r = coreR + margin;
    // Feature snap: if the land meets water just outside the town along this ray, tuck the wall
    // to sit ~half a tile landward of that bank (never inside a building → clamped to coreR+).
    for (let d = coreR + 0.5; d <= coreR + margin + snapBand; d += 0.5) {
      if (isWater(Math.round(cx + dx * d), Math.round(cy + dy * d))) { r = Math.max(coreR + 0.6, d - 0.6); break; }
    }
    samples.push([clampX(cx + dx * r), clampY(cy + dy * r)]);
  }

  const verts = simplifyRing(samples, 1.2, 14);
  if (verts.length < 3) return null;
  const path: Pt[] = [...verts, [...verts[0]] as Pt];   // close the ring
  return { path, centroid: [cx, cy] };
}

/** Total length of a polyline (tiles). */
function pathLen(path: Pt[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

/**
 * Enclose each built burgage lot with a croft ring (hedge/fence/wall), gated on the
 * street side so the door stays reachable.
 */
export function deriveCroftEnclosures(
  lots: Lot[], poiId: string, rng: MinRng, ctx: EnclosureCtx,
  isBuilding?: (x: number, y: number) => boolean,
  isWater?: (x: number, y: number) => boolean,
  isRoad?: (x: number, y: number) => boolean,
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
    const total = 2 * dx + 2 * dy;
    const gates: BarrierGate[] = [{ t: gateT, width: gateW }];
    if (isBuilding) gates.push(...gatesWhereOpen(path, total, isBuilding, gateW));
    // A lane threading the croft (its own access, or a through-road the informal ring
    // straddles) must pass through a real GATE, not ford the hedge. Crofts modelled the
    // opening as an ABSENT gate, so the path read as fording the wall — the `road-x-barrier`
    // finding the claims ledger surfaced. Cut the span the same way the settlement ring does
    // (same `gatesWhereOpen` slab machinery, no parallel mechanism).
    if (isRoad) gates.push(...gatesWhereOpen(path, total, isRoad, gateW).map((g) => ({ ...g, kind: 'gate' as const })));
    // A riverside lot's rectangle can cross the channel — a hedge has no business
    // standing in the water. Open the wet stretches; if the wet spans cover most of
    // the ring the enclosure is noise, so skip it entirely.
    if (isWater) {
      const wetGaps = gatesWhereOpen(path, total, isWater, gateW).map((g) => ({ ...g, kind: 'gap' as const }));
      const wetLen = wetGaps.reduce((s, g) => s + g.width, 0);
      if (wetLen > 0.4 * total) continue;
      gates.push(...wetGaps);
    }

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
  /** The settlement's HOME-BANK cells (`"x,y"`). When supplied, "off the home bank"
   *  (water OR the far bank) is the authoritative wall boundary — the ring opens
   *  wherever it fronts anything that isn't our own land, instead of ray-sampling for
   *  water. Absent ⇒ fall back to the water heuristic (byte-identical). */
  parcel?: Set<string>;
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

  const gateW = catalogue.get<BarrierTypeFields>('barrierType', typeId)?.fields.gateWidthTiles ?? 3;

  // The river's carved valley extends a feathered bank slope 1–3 tiles beyond the water
  // tiles themselves. A wall standing on the last dry tile sits mid-slope and visually
  // overhangs the channel, so the ring treats anything within ONE tile of water as wet:
  // the tuck stands back from the bank EDGE and slabs that graze the bank open up.
  const nearWater = (x: number, y: number): boolean => {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (args.isWater(x + ox, y + oy)) return true;
    }
    return false;
  };

  // TERRAIN-TRACED ring: a star-shaped polygon that hugs the built cluster and follows nearby
  // waterlines (diagonal corners fall out of the existing angle-general renderer). Falls back to
  // the axis-aligned bounding rectangle for tiny/degenerate clusters the tracer can't shape.
  const traced = traceRing({ bbox: args.bbox, mapW: args.mapW, mapH: args.mapH, margin, isWater: nearWater, isBuilding: args.isBuilding });
  const path = traced?.path ?? rectRing(minX, minY, maxX, maxY);
  const centroid: Pt = traced?.centroid ?? [(minX + maxX) / 2, (minY + maxY) / 2];

  // The authoritative "beyond our bank" test: with a home-parcel mask, a cell is off-bank
  // if it isn't one of our land cells (water OR the far bank) — the wall stays on the home
  // bank by construction. Without a mask, fall back to the water test. Either way the
  // 1-tile water dilation applies: home-bank cells right at the waterline are still banks.
  const offBank = args.parcel
    ? (x: number, y: number): boolean => !args.parcel!.has(`${x},${y}`) || nearWater(x, y)
    : nearWater;

  // Walk the ring at slab midpoints (same as the croft rings — keeps the renderer in lockstep).
  // Distinguish WHY each opening exists so the defences read believably:
  //   • ROAD crossings → real GATES (gatehouse + timber leaf).
  //   • OFF-BANK (water / far bank) / BUILDING crossings → plain GAPS (the line just opens).
  const total = pathLen(path);
  const roadGates = gatesWhereOpen(path, total, args.isRoad, gateW).map((g) => ({ ...g, kind: 'gate' as const }));
  const softOpen = (x: number, y: number): boolean => offBank(x, y) || (args.isBuilding?.(x, y) ?? false);
  const softGaps = gatesWhereOpen(path, total, softOpen, gateW).map((g) => ({ ...g, kind: 'gap' as const }));
  // TERRAIN AS DEFENCE: a whole ring side fronted by off-bank ground (a river bend, a lakeshore,
  // the coast) needs no wall — the water is the line. Open that side entirely, so the town is
  // walled only on its approachable landward sides (the authentic waterfront town).
  const waterGaps = waterFrontedSides(path, centroid, offBank).map((g) => ({ ...g, kind: 'gap' as const }));
  // Every walled town needs a way IN. If no road actually crosses the ring (the road often just
  // approaches it), place ONE main gate on the landward point nearest the road — the gatehouse the
  // approach road runs up to. Never on a water/off-bank side.
  const mainGate = roadGates.length === 0
    ? ensureMainGate(path, total, centroid, args.isRoad, offBank, gateW)
    : [];
  const gates: BarrierGate[] = [...roadGates, ...mainGate, ...softGaps, ...waterGaps];

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

/**
 * Guarantee ONE main gate on a walled ring that no road crosses. Walks the perimeter, and at each
 * step looks OUTWARD for the nearest road cell (up to `reach` tiles) on a non-water stretch — the
 * gate goes where the approach road comes closest to the wall. If no road is near, it falls back to
 * the midpoint of the longest landward side, so a town is never sealed shut.
 */
function ensureMainGate(
  path: Pt[], total: number, centroid: Pt,
  isRoad: (x: number, y: number) => boolean, isWater: (x: number, y: number) => boolean,
  gateW: number, reach = 10,
): BarrierGate[] {
  const outwardAt = (t: number): { p: Pt; n: Pt } => {
    const p = pointOnPath(path, t);
    const a = pointOnPath(path, Math.max(0, t - 0.5)), b = pointOnPath(path, Math.min(total, t + 0.5));
    const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
    let nx = -dy / m, ny = dx / m;
    if (nx * (p[0] - centroid[0]) + ny * (p[1] - centroid[1]) < 0) { nx = -nx; ny = -ny; }
    return { p, n: [nx, ny] };
  };
  let best = -1, bestDist = Infinity;
  for (let t = 0.5; t < total; t += 1) {
    const { p, n } = outwardAt(t);
    if (isWater(Math.round(p[0] + n[0]), Math.round(p[1] + n[1]))) continue;   // not on a water side
    for (let d = 2; d <= reach; d++) {
      if (isRoad(Math.round(p[0] + n[0] * d), Math.round(p[1] + n[1] * d))) {
        if (d < bestDist) { bestDist = d; best = t; }
        break;
      }
    }
  }
  if (best < 0) {
    // No road near — gate the longest landward side's midpoint so the town still has a way in.
    let acc = 0, bestMid = total / 2, bestLen = -1;
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1], [bx, by] = path[i];
      const len = Math.hypot(bx - ax, by - ay);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      let nx = -(by - ay), ny = bx - ax; const mm = Math.hypot(nx, ny) || 1; nx /= mm; ny /= mm;
      if (nx * (mx - centroid[0]) + ny * (my - centroid[1]) < 0) { nx = -nx; ny = -ny; }
      const wet = isWater(Math.round(mx + nx * 2), Math.round(my + ny * 2));
      if (!wet && len > bestLen) { bestLen = len; bestMid = acc + len / 2; }
      acc += len;
    }
    best = bestMid;
  }
  return [{ t: best, width: gateW, kind: 'gate' }];
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
