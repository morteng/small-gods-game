// src/world/road-deformation.ts
//
// Roads → terrain CARVE. Roads are not drawn as a ribbon; they ARE the terrain. Each
// road edge writes ONE corridor deformation into the shared channel
// (`terrain-deformation.ts`, the `heightAt = baseSeedHeight ⊕ deformations` contract),
// and water/ice/snow interaction then falls out of the unified terrain+water shader
// for free (a gutter pools water; a cold paved surface ices; a sunken path floods).
//
// The carve is a PROJECTION of a derived `RoadState` (road-state.ts), NOT a per-class
// table (design doc 2026-06-24 "Road as a connectome projection"):
//   * The cell path is first smoothed to a centripetal Catmull-Rom centerline
//     (road-centerline.ts) — carving a raw 4-connected staircase would dig a staircase
//     ditch.
//   * A per-VERTEX longitudinal grade is smoothed over a window driven by `construction`
//     (roadCrossSection.gradeWindowTiles): a footpath uses local ground height → FOLLOWS
//     the terrain; a prosperous highway averages a long grade → CUTS a flat shelf THROUGH
//     hills ("they spent more on workers modifying terrain"). One knob, emergent.
//   * One `level` deformation with a per-tile `targetAt` = grade(s) + cross-section
//     profile(d): crown camber, kerb gutter+curb, side drainage ditch, worn ruts, and
//     edge irregularity from wear/overgrowth — every dimension a function of RoadState.
//
// Determinism & save-safety: deformations are DERIVED from `map.roadGraph` (persisted)
// + the seed heightfield + worldSeed era; nothing here is persisted; re-derives
// identically on load. Memoised per (seed, dims) like getHeightfield.
import type { GameMap, POI } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';
import {
  ROAD_TILE_TYPES,
  applyRoadMask,
  type RoadGraph, type RoadEdge, type RoadNode, type RoadMask,
} from '@/world/road-graph';
import {
  DeformationStore,
  heightAt,
  type Deformation,
} from '@/world/terrain-deformation';
import { getHeightfield, ELEVATION_SEA_LEVEL, heightMetresAt } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec, shapeSignature } from '@/terrain/terrain-shape';
import { worldStyleOf } from '@/core/world-style';
import { buildRiverDeformations } from '@/world/river-deformation';
import { buildSettlementPadDeformations, settlementBuildCount } from '@/world/settlement-deformation';
import { buildBarrierDeformations, barrierFoundationCount } from '@/world/barrier-deformation';
import { buildEarthworkDeformations } from '@/world/earthwork-deformation';
import { getHydrologyResult } from '@/world/hydrology-store';
import { smoothCenterline, type Pt } from '@/terrain/road-centerline';
import { filletApproach } from '@/world/anchor-fillet';
import { realGateProfiles, gateApproachPlan, type GateApproachProfile } from '@/world/connectome/gate-approach';
import { tileBlockedByBuilding } from '@/world/building-collision';
import type { World } from '@/world/world';
import type { Anchor } from '@/world/anchors';
import { resolveSettlementEra, isEra, type Era } from '@/core/era';
import {
  deriveRoadState,
  roadCrossSection,
  type RoadState,
  type RoadCrossSection,
  type RoadDynamics,
} from '@/world/road-state';
import { clamp01 } from '@/core/math';

/** Embankment batter (fill-side slope): horizontal run in TILES per metre of fill height.
 *  ~0.75 = a 1.5 m run per 1 m rise (≈34° angle of repose) at 2 m / tile. */
const BATTER_RUN_TILES_PER_M = 0.75;

/** Arc step (tiles) for sampling the ground under the grade line to find fill — fine enough
 *  to catch a valley between sparse centerline vertices, coarse enough to stay cheap. */
const FILL_SAMPLE_STEP_TILES = 1;

/**
 * The corridor's fill-side falloff width (tiles) at a point carrying `fillM` metres of
 * embankment fill, built by a road of the given `cutStrength`. On flat or cut ground
 * (`fillM ≤ 0`) it's just the thin shoulder feather, so a road that isn't filling keeps its
 * trail-width footprint (parity with the pre-embankment carve). Where the road rides up on
 * fill, the width grows with the fill actually carried (`cutStrength·fillM`) so the bank
 * descends at the soil's repose angle — a footpath barely banks, an engineered road throws a
 * real causeway. Pure + monotonic; the carve and a parity test both read it.
 */
export function embankmentBatterTiles(fillM: number, cutStrength: number, shoulderFeatherTiles: number): number {
  return Math.max(shoulderFeatherTiles, BATTER_RUN_TILES_PER_M * cutStrength * Math.max(0, fillM));
}

// ── Geometry helpers (pure) ──────────────────────────────────────────────────────

/** Project a point onto a polyline: nearest cross-distance `d` + arc-length `s`. */
function projectToPolyline(pts: Pt[], cumS: number[], px: number, py: number): { d: number; s: number } {
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, ay = pts[i].y;
    const dx = pts[i + 1].x - ax, dy = pts[i + 1].y - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * dx, cy = ay + t * dy;
    const dist = Math.hypot(px - cx, py - cy);
    if (dist < best) {
      best = dist;
      bestS = cumS[i] + t * Math.sqrt(len2);
    }
  }
  return { d: best, s: bestS };
}

/** The centerline point at arc-length `s` (cumS sorted ascending) — mirror of interpAtArc. */
function pointAtArc(pts: Pt[], cumS: number[], s: number): Pt {
  if (s <= cumS[0]) return pts[0];
  const n = cumS.length;
  if (s >= cumS[n - 1]) return pts[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumS[mid] <= s) lo = mid; else hi = mid;
  }
  const span = cumS[hi] - cumS[lo] || 1;
  const w = (s - cumS[lo]) / span;
  return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * w, y: pts[lo].y + (pts[hi].y - pts[lo].y) * w };
}

/** Interpolate a per-vertex value at arc-length `s` (cumS is sorted ascending). */
function interpAtArc(cumS: number[], vals: number[], s: number): number {
  if (s <= cumS[0]) return vals[0];
  const n = cumS.length;
  if (s >= cumS[n - 1]) return vals[n - 1];
  // binary search for the segment containing s
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumS[mid] <= s) lo = mid; else hi = mid;
  }
  const span = cumS[hi] - cumS[lo] || 1;
  const w = (s - cumS[lo]) / span;
  return vals[lo] + (vals[hi] - vals[lo]) * w;
}

/** Symmetric moving-average smoothing — the longitudinal grade window (cut-through). */
function boxSmooth(vals: number[], halfWindow: number): number[] {
  if (halfWindow < 1 || vals.length <= 2) return vals.slice();
  const n = vals.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let k = -halfWindow; k <= halfWindow; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      sum += vals[j];
      cnt++;
    }
    out[i] = sum / cnt;
  }
  return out;
}

/** Deterministic [0,1) hash for edge/surface irregularity (no Math.random). */
function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The signed cross-section displacement (metres) added to the longitudinal grade at
 * cross-distance |d| (tiles). Crown camber over the carriageway, a kerb gutter+lip,
 * a side drainage ditch, worn wheel ruts, and wear/overgrowth edge irregularity.
 */
function crossProfile(ad: number, x: RoadCrossSection, tx: number, ty: number): number {
  let p = 0;
  const half = x.carriageHalf;
  if (ad <= half) {
    const u = half > 0 ? ad / half : 0;
    p += x.crownM * (1 - u * u); // camber: high at centre, 0 at edge
    if (x.rutDepthM > 0) {
      // two symmetric ruts near the wheel paths (~0.55 of the half-width)
      const r = Math.exp(-Math.pow((ad - 0.55 * half) / (0.18 * half + 1e-3), 2));
      p -= x.rutDepthM * r;
    }
  } else if (x.hasCurb && ad <= half + x.curbWidthTiles) {
    const t = (ad - half) / x.curbWidthTiles; // 0..1 across the kerb zone
    if (t < 0.5) {
      // gutter dip (inner half) — collects the water the crown sheds
      p -= x.gutterDepthM * (1 - Math.abs(t - 0.25) / 0.25);
    } else {
      // raised kerb lip (outer half)
      p += x.curbHeightM * (1 - Math.abs(t - 0.75) / 0.25);
    }
  }
  if (x.ditchDepthM > 0) {
    const dd = Math.abs(ad - x.ditchOffsetTiles);
    if (dd < 0.5) p -= x.ditchDepthM * (1 - dd / 0.5);
  }
  if (x.edgeNoiseM > 0) {
    // irregularity concentrated near the shoulders, fading into the carriageway
    const falloff = clamp01((ad - half * 0.6) / (half + x.shoulderFeatherTiles));
    p += x.edgeNoiseM * (hash2(tx, ty) - 0.5) * 2 * falloff;
  }
  return p;
}

// ── RoadState derivation from the graph ──────────────────────────────────────────

function eraForEdge(edge: RoadEdge, fromPoi: POI | undefined, toPoi: POI | undefined, map: GameMap): Era {
  const ws = map.worldSeed;
  if (fromPoi) return resolveSettlementEra(fromPoi, ws);
  if (toPoi) return resolveSettlementEra(toPoi, ws);
  return isEra(ws?.era) ? (ws!.era as Era) : 'medieval';
}

/** Per-edge derived road profile — the shared seam the carve AND the surface field read. */
export interface EdgeRoadProfile {
  centerline: Pt[];
  state: RoadState;
  x: RoadCrossSection;
}

// ── Approach fillets: roads arrive SQUARE at gates AND building-anchor doors ─────────
// The gate waypoint threading (or the anchor-snap door↔road match) forces the route to a
// target point but nothing aligns the approach tangent to the target's own axis, so the
// centerline kinks at the waypoint node. Here (the shared seam BOTH the carve and the
// render ribbon read) any edge end that lands at a real gate OR a matched building anchor
// gets its tail re-shaped by the roads-article fillet so it arrives heading straight at
// the opening/door. `filletApproach` pins the endpoint exactly at the target, so smoothing
// can never detach the road from it. `reconcileFilletRaster` (below) then re-derives the
// tile mask so the raster NPCs walk matches this smoothed ribbon.

/** A road/street approach target: the point it must arrive at + the OUTWARD normal of the
 *  thing it arrives at (a gate's wall normal, or a building door/frontage facing). Gate
 *  profiles and building-anchor profiles share this shape. */
type ApproachProfile = GateApproachProfile;

const gateProfileCache = new WeakMap<object, GateApproachProfile[]>();
function gateProfilesFor(map: GameMap): GateApproachProfile[] {
  const runs = map.barrierRuns;
  if (!runs || runs.length === 0) return [];
  let hit = gateProfileCache.get(runs);
  if (!hit) { hit = realGateProfiles(runs); gateProfileCache.set(runs, hit); }
  return hit;
}

/** A building-anchor arrival profile: a road EDGE's own endpoint matched (by the anchor-snap
 *  layer) to a building door/frontage. Scoped per-edge (`edgeId`) since the anchor-snap
 *  matcher can snap a door to ANY nearby road point, not only an edge's terminus — we only
 *  want to fillet a genuine arrival (the matched road point sits at this edge's own end). */
interface AnchorArrivalProfile extends ApproachProfile { edgeId: string }

const anchorProfileCache = new WeakMap<object, AnchorArrivalProfile[]>();
function allAnchorArrivalProfiles(map: GameMap): AnchorArrivalProfile[] {
  const links = map.anchorLinks;
  if (!links || links.length === 0) return [];
  let hit = anchorProfileCache.get(links);
  if (hit) return hit;
  const anchorById = new Map<string, Anchor>();
  for (const a of map.anchors ?? []) if (a.id) anchorById.set(a.id, a);
  const out: AnchorArrivalProfile[] = [];
  for (const link of links) {
    if (link.relation !== 'connects') continue;
    if (link.b.kind !== 'road' || !link.b.ownerId) continue;
    if (link.a.kind !== 'door' && link.a.kind !== 'frontage') continue;
    const src = link.a.id ? anchorById.get(link.a.id) : undefined;
    if (!src) continue;
    out.push({ x: link.b.x, y: link.b.y, facing: src.facing, edgeId: link.b.ownerId });
  }
  anchorProfileCache.set(links, out);
  return out;
}

/** Building-anchor arrival profiles for ONE edge (WP-Q #2). */
function buildingAnchorProfilesFor(map: GameMap, edgeId: string): AnchorArrivalProfile[] {
  const all = allAnchorArrivalProfiles(map);
  return all.length === 0 ? all : all.filter((p) => p.edgeId === edgeId);
}

/** A centerline end within this many tiles of a real gate point is a gate approach. */
const GATE_SNAP_TILES = 1.6;
/** A centerline end within this many tiles of a matched building anchor is that arrival —
 *  slightly looser than `DEFAULT_RULES`' door/frontage `maxGap` (1.6) to tolerate rounding
 *  between the anchor-snap match point and the edge's own endpoint. */
const ANCHOR_SNAP_TILES = 1.8;

/** Re-shape ONE end (the last point) of `line` to arrive square at approach target `p`. */
function filletEndOntoProfile(line: Pt[], p: ApproachProfile): Pt[] {
  // Which side does this edge approach from? Probe ~2 tiles back along the line: outside
  // (along +facing) arrives heading INTO the target (targetFacing = outward); an interior
  // street reaching the target from inside arrives heading OUT (targetFacing = inward).
  let acc = 0, probe = line[0];
  for (let i = line.length - 1; i > 0; i--) {
    acc += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
    if (acc >= 2) { probe = line[i - 1]; break; }
  }
  const side = (probe.x - p.x) * p.facing[0] + (probe.y - p.y) * p.facing[1];
  const facing: [number, number] = side >= 0 ? p.facing : [-p.facing[0], -p.facing[1]];
  return filletApproach(line, { x: p.x, y: p.y }, facing);
}

/** Fillet either end of `centerline` onto the nearest profile within `snapTiles`, if any. */
function filletOntoProfiles(centerline: Pt[], profiles: ApproachProfile[], snapTiles: number): Pt[] {
  if (profiles.length === 0 || centerline.length < 2) return centerline;
  const near = (p: Pt): ApproachProfile | undefined => {
    let best: ApproachProfile | undefined, bestD = snapTiles;
    for (const g of profiles) {
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  };
  let line = centerline;
  const tail = near(line[line.length - 1]);
  if (tail) line = filletEndOntoProfile(line, tail);
  const head = near(line[0]);
  if (head) line = filletEndOntoProfile(line.slice().reverse(), head).reverse();
  return line;
}

/** Derive one road edge's smoothed centerline + RoadState + cross-section, or null. */
export function edgeRoadProfile(
  map: GameMap,
  edge: RoadEdge,
  nodeById: Map<string, RoadNode>,
  poiById: Map<string, POI>,
  dynamicFor?: (edge: RoadEdge) => RoadDynamics | undefined,
): EdgeRoadProfile | null {
  if (edge.feature !== 'road' || edge.polyline.length < 2) return null;
  let centerline = filletOntoProfiles(smoothCenterline(edge.polyline), gateProfilesFor(map), GATE_SNAP_TILES);
  const anchorProfiles = buildingAnchorProfilesFor(map, edge.id);
  if (anchorProfiles.length) centerline = filletOntoProfiles(centerline, anchorProfiles, ANCHOR_SNAP_TILES);
  if (centerline.length < 2) return null;
  const fromPoi = poiById.get(nodeById.get(edge.a)?.poiRef ?? '');
  const toPoi = poiById.get(nodeById.get(edge.b)?.poiRef ?? '');
  const era = eraForEdge(edge, fromPoi, toPoi, map);
  // An explicit dynamicFor (preview/scrub) overrides; otherwise the persisted per-edge
  // dynamics evolved by the road-evolution tick flow into BOTH the carve and the surface.
  const dynamic = dynamicFor?.(edge) ?? edge.dynamics;
  const state = deriveRoadState({ roadClass: edge.class, surface: edge.surface, era, dynamic });
  return { centerline, state, x: roadCrossSection(state) };
}

/** One road edge → its corridor deformation, or null if too short to carve. */
export function buildEdgeDeformation(
  map: GameMap,
  edge: RoadEdge,
  nodeById: Map<string, RoadNode>,
  poiById: Map<string, POI>,
  dynamicFor?: (edge: RoadEdge) => RoadDynamics | undefined,
): Deformation | null {
  const profile = edgeRoadProfile(map, edge, nodeById, poiById, dynamicFor);
  if (!profile) return null;
  const { centerline, x } = profile;

  // Per-vertex base grade + cumulative arc-length.
  const n = centerline.length;
  const grade = new Array<number>(n);
  const cumS = new Array<number>(n);
  const overSpan = new Array<boolean>(n);
  cumS[0] = 0;
  for (let i = 0; i < n; i++) {
    grade[i] = heightMetresAt(map, Math.round(centerline[i].x), Math.round(centerline[i].y));
    const tt = map.tiles?.[Math.round(centerline[i].y)]?.[Math.round(centerline[i].x)]?.type ?? '';
    overSpan[i] = tt === 'bridge' || WATER_TYPES.has(tt);
    if (i > 0) cumS[i] = cumS[i - 1] + Math.hypot(centerline[i].x - centerline[i - 1].x, centerline[i].y - centerline[i - 1].y);
  }
  // THE APPROACH-DIVE FIX: a vertex over a crossing samples the carved channel (low), and
  // the longitudinal smoothing dragged the flanking DRY approaches down toward the water —
  // the road visibly plunged beside the deck. The road's true profile over a span is the
  // DECK, which rides the higher bank: pin each wet run to max(bank, bank) before smoothing,
  // so the approaches ramp UP to the deck (embankment fill builds the ramp) instead of diving.
  for (let i = 0; i < n; i++) {
    if (!overSpan[i]) continue;
    let a = i; while (a > 0 && overSpan[a - 1]) a--;
    let b = i; while (b + 1 < n && overSpan[b + 1]) b++;
    const bankA = a > 0 ? grade[a - 1] : -Infinity;
    const bankB = b + 1 < n ? grade[b + 1] : -Infinity;
    const deckM = Math.max(bankA, bankB);
    if (Number.isFinite(deckM)) for (let k = a; k <= b; k++) grade[k] = deckM;
    i = b;
  }
  // Longitudinal smoothing window IS the cut-through lever (construction-driven).
  const halfWindow = Math.max(0, Math.round(x.gradeWindowTiles / 2));
  const smoothGrade = boxSmooth(grade, halfWindow);

  // G2 — embankment fill. Where the smoothed grade rides ABOVE the ground (a dip or valley
  // the road must carry itself across), the road builds UP a fill bank, not only carves down.
  // The `level` op already raises terrain toward grade (`height = lerp(ground, grade, mask)`);
  // the only thing missing for a believable embankment is the SHAPE of its side — a fixed
  // shoulder-feather drops the fill as a near-vertical wall. So on the fill side we widen the
  // falloff to a BATTER whose run scales with the fill height: the lerp then ramps the height
  // from grade down to ground over that run, a side-slope at the soil's repose angle (a
  // footpath barely banks; an engineered road throws a real causeway).
  //
  // The grade line is a smooth ramp between (possibly sparse) centerline vertices, so it can
  // float well above the terrain BETWEEN them — sampling fill only AT vertices misses all of
  // it (there `smoothGrade == grade` by construction). So sample the ground densely along arc.
  const total = cumS[n - 1] || 0;
  const fillArcs: number[] = [];
  const fillVals: number[] = [];
  let maxFill = 0;
  for (let s = 0; s <= total + 1e-6; s += FILL_SAMPLE_STEP_TILES) {
    const p = pointAtArc(centerline, cumS, s);
    const ground = heightMetresAt(map, Math.round(p.x), Math.round(p.y));
    const f = Math.max(0, interpAtArc(cumS, smoothGrade, s) - ground);
    fillArcs.push(s);
    fillVals.push(f);
    if (f > maxFill) maxFill = f;
  }
  const batterRun = (s: number): number =>
    embankmentBatterTiles(interpAtArc(fillArcs, fillVals, s), x.cutStrength, x.shoulderFeatherTiles);
  const maxBatter = embankmentBatterTiles(maxFill, x.cutStrength, x.shoulderFeatherTiles);

  // Footprint: carriageway + kerb + ditch + feather/batter.
  const core = x.carriageHalf + (x.hasCurb ? x.curbWidthTiles : 0);
  const ditchReach = x.ditchDepthM > 0 ? x.ditchOffsetTiles + 0.5 : 0;
  const featherStart = Math.max(core, ditchReach);
  const reach = featherStart + maxBatter; // worst-case footprint for the AABB bounds

  const xs = centerline.map((p) => p.x);
  const ys = centerline.map((p) => p.y);
  const bounds = {
    minX: Math.min(...xs) - reach,
    minY: Math.min(...ys) - reach,
    maxX: Math.max(...xs) + reach,
    maxY: Math.max(...ys) + reach,
  };

  return {
    id: `${edge.id}:corridor`,
    source: 'road:cut',
    op: 'level',
    priority: 30,
    amount: 0,
    bounds,
    mask(tx, ty) {
      const { d, s } = projectToPolyline(centerline, cumS, tx, ty);
      const batter = batterRun(s); // height-proportional on a fill bank; ≥ the thin shoulder feather
      const localReach = featherStart + batter;
      if (d >= localReach) return 0;
      if (d <= featherStart) return x.cutStrength;
      return x.cutStrength * clamp01(1 - (d - featherStart) / batter);
    },
    targetAt(tx, ty) {
      const { d, s } = projectToPolyline(centerline, cumS, tx, ty);
      return interpAtArc(cumS, smoothGrade, s) + crossProfile(d, x, tx, ty);
    },
  };
}

/**
 * Pure: a road graph → the corridor carve deformations its road edges imply (one per
 * edge). Rivers and walls are skipped (separate producers). `map` is read for base
 * heights + era only.
 */
export function buildRoadDeformations(map: GameMap, graph: RoadGraph): Deformation[] {
  const nodeById = new Map(graph.nodes.map((nd) => [nd.id, nd]));
  const poiById = new Map((map.worldSeed?.pois ?? []).map((p) => [p.id, p]));
  const out: Deformation[] = [];
  for (const edge of graph.edges) {
    const def = buildEdgeDeformation(map, edge, nodeById, poiById);
    if (def) out.push(def);
  }
  return out;
}

// ── Fillet → raster reconciliation (WP-Q) ─────────────────────────────────────────
//
// `edgeRoadProfile` smooths + fillets the RENDER centerline, but the integer cell polyline
// worldgen carved into `map.tiles` (what NPCs actually walk) stays the raw, kinked path — so
// the smooth approach the player sees is not the surface NPCs walk. This reconciles the two:
// for each road edge, re-sample the FILLETED centerline and compare it against the edge's own
// (unchanged) `polyline` — the ground truth from gen. Only the fillet-reshaped TAILS (gate
// approaches, building-anchor arrivals) diverge from the raw path; the vast majority of edges
// have no fillet applied at all and this is a no-op.
//
// Hard constraints (Galin 2010 — a pipeline that smooths after routing must RE-VALIDATE
// against the world): a candidate cell is never claimed if it's a curtain BLOCKING cell, open
// water without an existing bridge deck, a building footprint, or a protected green precinct.
// Where any cell in a divergent span fails, the WHOLE span falls back — the original (already
// road) tiles for that span are left untouched, never partially carved. This is PURELY
// ADDITIVE: `edge.polyline` (and `bridgeCells`) are never rewritten, so bridge bookkeeping and
// the graph's own "walked path" stay exactly as gen produced them; `map.tiles` simply gains the
// extra cells the smoothed ribbon needs. "Un-carving" stale cells is deliberately NOT attempted
// — the plan's own guidance ("when in doubt leave them — a slightly wide road is better than a
// broken one") makes a purely-additive reconciliation the conservative, defensible choice.

/** Arc-length step (tiles) for sampling the filleted centerline when reconciling tiles. */
const RECON_SAMPLE_STEP_TILES = 0.35;
/**
 * How far (tiles) a filleted sample may sit from the raw (carved) polyline before it counts
 * as "diverged" and needs new tiles. NOTE this is a tile-GRID tolerance, not a corridor-width
 * one: the carved tile MASK is a single-cell-wide path regardless of road class (only the
 * continuous height/paint carve scales with `carriageHalf`), so the right yardstick is "would
 * this land on a different integer cell than the raw path," not the carriageway's own width.
 * Plain Catmull-Rom smoothing (no fillet) measures ~0 deviation on the fixtures this reconciles
 * against; a gate/anchor fillet's reshaped arc measures well over a tile — comfortably above
 * this margin — so the threshold cleanly separates "ordinary smoothing" from "a real fillet."
 */
const RECON_MATCH_MARGIN_TILES = 0.65;

export interface FilletReconcileSpan {
  edgeId: string;
  /** Arc-length range along the edge's FILLETED centerline this span covers. A fillet built
   *  from a fully-collapsed (straight, RDP-simplified) raw polyline can bulge in the MIDDLE
   *  of the arc (a Hermite/arc curve pins both true endpoints exactly and departs from the
   *  raw path only in between) — so a span is wherever the samples diverge, not necessarily
   *  at either literal end. */
  arcRange: [number, number];
  /** True when new tiles were written; false when the span fell back (left the original
   *  raw-polyline tiles in place because a candidate cell failed a hard constraint). */
  written: boolean;
  cellsWritten: number;
}

/** Sample a polyline at ~`step` arc-length spacing (endpoints included), paired with each
 *  sample's own arc-length position along `pts` (for reporting divergent spans). */
function denseSample(pts: ReadonlyArray<Pt>, step: number): { points: Pt[]; arcLens: number[] } {
  if (pts.length < 2) return { points: pts.slice(), arcLens: pts.map(() => 0) };
  const cumS = new Array<number>(pts.length);
  cumS[0] = 0;
  for (let i = 1; i < pts.length; i++) cumS[i] = cumS[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const total = cumS[pts.length - 1];
  const points: Pt[] = [];
  const arcLens: number[] = [];
  for (let s = 0; s <= total; s += step) { points.push(pointAtArc(pts as Pt[], cumS, s)); arcLens.push(s); }
  const last = pts[pts.length - 1];
  if (points.length === 0 || Math.hypot(points[points.length - 1].x - last.x, points[points.length - 1].y - last.y) > 1e-6) {
    points.push(last);
    arcLens.push(total);
  }
  return { points, arcLens };
}

/** Round + dedupe consecutive identical cells. */
function roundCells(pts: ReadonlyArray<Pt>): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const c = { x: Math.round(p.x), y: Math.round(p.y) };
    const last = out[out.length - 1];
    if (!last || last.x !== c.x || last.y !== c.y) out.push(c);
  }
  return out;
}

/** Insert an orthogonal corner between diagonally-adjacent cells so the reconciled span stays
 *  4-connected (NPC walkability + road-connectivity both step 4-neighbour) — same rule as
 *  `orthogonalize` in road-graph.ts, generalised to this reconciliation's own bad-cell test. */
function fourConnectCells(
  cells: ReadonlyArray<{ x: number; y: number }>,
  isBad: (x: number, y: number) => boolean,
): { x: number; y: number }[] {
  if (cells.length < 2) return cells.slice();
  const out: { x: number; y: number }[] = [cells[0]];
  for (let i = 1; i < cells.length; i++) {
    const p = cells[i - 1], c = cells[i];
    if (p.x !== c.x && p.y !== c.y) {
      const optA = { x: c.x, y: p.y };
      const optB = { x: p.x, y: c.y };
      out.push(!isBad(optA.x, optA.y) ? optA : !isBad(optB.x, optB.y) ? optB : optA);
    }
    out.push(c);
  }
  return out;
}

/** Every tile a settlement plan's `green` civic occupies — protected commons roads must
 *  thread AROUND (mirrors the `greenTiles` set `map-generator.ts` builds pre-carve; here
 *  re-derived from the persisted `settlementPlans` so this module never needs `world`). */
function collectGreenTiles(map: GameMap): Set<string> {
  const out = new Set<string>();
  for (const plan of map.settlementPlans ?? []) {
    for (const c of plan.civics) {
      if (c.type !== 'green') continue;
      for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) out.add(`${c.x + dx},${c.y + dy}`);
    }
  }
  return out;
}

/** Hard constraints a reconciled cell must pass: never a curtain blocking cell, never open
 *  water without an existing bridge deck, never a protected green, never a building
 *  structure cell. The building check is TWO-layered: `tileBlockedByBuilding(world, …)` is
 *  the real authority (the registry tile index sees EVERY building, including entity-only
 *  ones — crossing tolls/shrines, stoops — that never stamp `tile.walkable`; this was the
 *  INV3 regression: a walkable-flag-only proxy missed them). The tile-walkable proxy is kept
 *  as a second layer for callers with no `world` (isolated tests / tooling). */
function blockedForReconcile(
  map: GameMap, x: number, y: number,
  wallObstacles: ReadonlySet<string>, greenTiles: ReadonlySet<string>, world?: World,
): boolean {
  const t = map.tiles[y]?.[x];
  if (!t) return true;
  const key = `${x},${y}`;
  if (wallObstacles.has(key)) return true;
  if (WATER_TYPES.has(t.type) && t.type !== 'bridge') return true;
  if (greenTiles.has(key)) return true;
  if (t.walkable === false && !ROAD_TILE_TYPES.has(t.type)) return true;
  if (world && tileBlockedByBuilding(world, x, y)) return true;
  return false;
}

/**
 * Reconcile ONE divergent span of an edge's filleted centerline against the tile grid. `sample`
 * is the dense-sampled sub-run covering just that span (padded 1 sample into the matching
 * neighbourhood on each side so the new cells stay 4-connected to the untouched raw tiles).
 * Validates every candidate cell; on success, stamps them via `applyRoadMask` (reusing the
 * exact tile-write rules `buildRoadGraph`/`rasterizeRoadGraph` already use — bridge/water
 * preserved, base biome recorded). On failure, writes nothing (fall back to the original tiles).
 */
function reconcileSpan(
  map: GameMap, edge: RoadEdge, sample: Pt[], arcRange: [number, number],
  wallObstacles: ReadonlySet<string>, greenTiles: ReadonlySet<string>, world?: World,
): FilletReconcileSpan {
  const isBad = (x: number, y: number): boolean => blockedForReconcile(map, x, y, wallObstacles, greenTiles, world);
  const cells = fourConnectCells(roundCells(sample), isBad);
  const safe = cells.length > 0 && cells.every((c) => !isBad(c.x, c.y));
  if (!safe) return { edgeId: edge.id, arcRange, written: false, cellsWritten: 0 };
  const mask: RoadMask = {
    width: map.width,
    height: map.height,
    writes: cells.map((c) => ({ x: c.x, y: c.y, surface: edge.surface, bridge: false })),
  };
  applyRoadMask(map.tiles, mask);
  return { edgeId: edge.id, arcRange, written: true, cellsWritten: cells.length };
}

/**
 * Re-derive the road tile mask along every edge's FILLETED centerline so the raster NPCs walk
 * matches the rendered ribbon (WP-Q #1). Purely additive: edges with no fillet divergence (the
 * common case) are untouched; edges whose gate/anchor-arrival fillet moved the centerline off
 * its raw walked path get the new cells stamped, falling back per-span wherever a candidate
 * cell would violate a hard constraint. Safe to call more than once: divergence is measured
 * against `edge.polyline` (never rewritten), so a repeat call re-identifies the same span, but
 * `applyRoadMask` is itself idempotent (stamping an already-road tile is a no-op) — the TILE
 * GRID never changes on a second pass, even though the returned span list isn't empty.
 *
 * SEQUENCING (the INV3 lesson): this is an EXPLICIT worldgen pass, called once by
 * `map-generator.ts` after ALL building placement is final (settlements, crossing ancillary
 * structures, stoops, aqueducts, `reconcileBuildingsWithWater` nudges) and after the
 * anchor-snap layer is derived (`map.anchorLinks` feeds the building-anchor fillets) — the
 * same "final authority" pattern as `reconcileBuildingsWithWater`. It must NOT be triggered
 * lazily from a deformation-store/feature-geometry getter: a mid-generation read would stamp
 * road tiles BEFORE later structures validate their seats, and those structures (sited to
 * avoid roads-at-that-time) would then sit on roads they never saw. Pass `world` so the
 * blocked check consults the real building registry, not just tile flags.
 */
export function reconcileFilletRaster(map: GameMap, world?: World): FilletReconcileSpan[] {
  const graph = map.roadGraph;
  if (!graph || !map.tiles?.length) return [];
  const nodeById = new Map(graph.nodes.map((nd) => [nd.id, nd]));
  const poiById = new Map((map.worldSeed?.pois ?? []).map((p) => [p.id, p]));
  const wallObstacles = gateApproachPlan(map.barrierRuns ?? [], [], map.worldSeed?.pois ?? []).wallObstacles;
  const greenTiles = collectGreenTiles(map);

  const results: FilletReconcileSpan[] = [];
  for (const edge of graph.edges) {
    if (edge.feature !== 'road' || edge.polyline.length < 2) continue;
    const profile = edgeRoadProfile(map, edge, nodeById, poiById);
    if (!profile || profile.centerline.length < 2) continue;

    const raw = edge.polyline as Pt[];
    const rawCumS = new Array<number>(raw.length);
    rawCumS[0] = 0;
    for (let i = 1; i < raw.length; i++) rawCumS[i] = rawCumS[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);

    const { points: sampled, arcLens } = denseSample(profile.centerline, RECON_SAMPLE_STEP_TILES);
    const tol = RECON_MATCH_MARGIN_TILES;
    const dists = sampled.map((p) => projectToPolyline(raw, rawCumS, p.x, p.y).d);

    // Every contiguous run of divergent samples — a fillet reshapes a TAIL near a gate/anchor
    // in the common case, but a fully-collapsed (straight) raw polyline can pin BOTH literal
    // endpoints exactly and bulge only in the middle (a Hermite/arc property), so divergence
    // isn't guaranteed to touch either end. Pad one matching sample on each side so the
    // written cells stay 4-connected to the untouched raw tiles at the seam.
    let i = 0;
    while (i < dists.length) {
      if (dists[i] <= tol) { i++; continue; }
      let j = i;
      while (j + 1 < dists.length && dists[j + 1] > tol) j++;
      const from = Math.max(0, i - 1);
      const to = Math.min(dists.length - 1, j + 1);
      results.push(reconcileSpan(
        map, edge, sampled.slice(from, to + 1), [arcLens[from], arcLens[to]], wallObstacles, greenTiles, world,
      ));
      i = j + 1;
    }
  }
  return results;
}

// ── Riverside levee (#24): roads alongside open water ride up on an embankment ──

/** Full-height berm rise (metres) where a road runs alongside open water. ~1.5 m reads as a
 *  real causeway above the waterline without looking like a wall (cf. embankment fill G2). */
const LEVEE_HEIGHT_M = 1.5;
/** Half-width (tiles) of the levee's full-height crown about the road centerline. */
const LEVEE_HALF_TILES = 1.2;
/** Bank falloff (tiles) beyond the crown — the embankment slopes back down to grade. */
const LEVEE_FEATHER_TILES = 1.6;
/** A road vertex counts as "riverside" if open water lies within this radius (tiles). */
const RIVERSIDE_REACH_TILES = 2.5;

/**
 * Pure: the riverside-levee deformations a map's roads imply (#24 — "road-river
 * relationship"). A road that runs flush alongside a river reads as if it would flood;
 * a real road there sits on a raised embankment. For each road edge we find its
 * CONTIGUOUS riverside sub-runs (consecutive polyline vertices whose cell is near open
 * water) and raise each on an `add` berm that composes ABOVE the road's grade-cut and the
 * river incision (priority 80 > road 30 > river-carve 40). The mask returns 0 over water
 * tiles, so the river keeps its bed — only the road and its landward bank lift. Empty when
 * no road runs beside water (exact parity by construction).
 */
export function buildLeveeDeformations(map: GameMap): Deformation[] {
  if (!map.roadGraph || !map.tiles?.length) return [];
  const W = map.width, H = map.height;
  const isWater = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
    const t = map.tiles[ty]?.[tx];
    return !!t && WATER_TYPES.has(t.type);
  };
  const r = Math.ceil(RIVERSIDE_REACH_TILES);
  const reach2 = RIVERSIDE_REACH_TILES * RIVERSIDE_REACH_TILES;
  const nearWater = (p: Pt): boolean => {
    const cx = Math.round(p.x), cy = Math.round(p.y);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > reach2) continue;
        if (isWater(cx + dx, cy + dy)) return true;
      }
    }
    return false;
  };

  const out: Deformation[] = [];
  for (const edge of map.roadGraph.edges) {
    if (edge.feature !== 'road' || edge.polyline.length < 2) continue;
    // Split the edge into contiguous riverside sub-runs — a road may touch water in two
    // separate places, and one polyline across the gap would berm dry ground between them.
    const runs: Pt[][] = [];
    let cur: Pt[] = [];
    for (const p of edge.polyline) {
      if (nearWater(p)) cur.push(p);
      else { if (cur.length >= 2) runs.push(cur); cur = []; }
    }
    if (cur.length >= 2) runs.push(cur);

    runs.forEach((run, ri) => {
      const cumS = new Array<number>(run.length);
      cumS[0] = 0;
      for (let i = 1; i < run.length; i++) cumS[i] = cumS[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
      const reachT = LEVEE_HALF_TILES + LEVEE_FEATHER_TILES;
      const xs = run.map((p) => p.x), ys = run.map((p) => p.y);
      out.push({
        id: `${edge.id}:levee:${ri}`,
        source: 'road:levee',
        op: 'add',
        priority: 80,
        amount: LEVEE_HEIGHT_M,
        bounds: {
          minX: Math.min(...xs) - reachT,
          minY: Math.min(...ys) - reachT,
          maxX: Math.max(...xs) + reachT,
          maxY: Math.max(...ys) + reachT,
        },
        mask(tx, ty) {
          if (isWater(Math.round(tx), Math.round(ty))) return 0; // never raise the river bed
          const { d } = projectToPolyline(run, cumS, tx, ty);
          if (d >= reachT) return 0;
          if (d <= LEVEE_HALF_TILES) return 1;
          return clamp01(1 - (d - LEVEE_HALF_TILES) / LEVEE_FEATHER_TILES);
        },
      });
    });
  }
  return out;
}

// ── Memoised stores + composed fields, keyed by (seed, dims) like getHeightfield ──

const storeCache = new Map<string, DeformationStore>();
const fieldCache = new Map<string, Float32Array>();
const CACHE_CAP = 4;

function key(map: GameMap): string {
  // `rev` bumps when road-evolution mutates edge.dynamics; `b` is the built-lot count so
  // settlement foundation pads invalidate when live growth fills a lot. Both keep the
  // composed heightfield a pure, cache-correct function of the map's evolving state.
  return `${map.seed}:${map.width}x${map.height}:r${map.roadGraph?.rev ?? 0}:b${settlementBuildCount(map)}:w${barrierFoundationCount(map)}:e${map.earthworks?.length ?? 0}:s${shapeSignature(styledShapeSpec(map.worldSeed))}`;
}

function evict(cache: Map<string, unknown>): void {
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/**
 * The road deformation store for a world — memoised. Empty (size 0) when the map
 * has no road graph, so consumers compose to exact base-terrain parity.
 */
export function getRoadDeformationStore(map: GameMap): DeformationStore {
  const k = key(map);
  let store = storeCache.get(k);
  if (store) return store;
  store = new DeformationStore();
  if (map.roadGraph) store.add(...buildRoadDeformations(map, map.roadGraph));
  storeCache.set(k, store);
  evict(storeCache);
  return store;
}

// ── Merged WORLD store: road grade-cuts ⊕ river incision (memoised) ──
const worldStoreCache = new Map<string, DeformationStore>();

/**
 * The full terrain-deformation store for a world — road corridors AND river incision,
 * composed into one store (priority/id order handles overlaps where a road bridges a
 * river). This is what the renderer and composed heightfield read; `getRoadDeformationStore`
 * stays road-only for callers that want just roads.
 */
export function getWorldDeformationStore(map: GameMap): DeformationStore {
  const k = key(map);
  let store = worldStoreCache.get(k);
  if (store) return store;
  store = new DeformationStore();
  if (map.roadGraph) store.add(...buildRoadDeformations(map, map.roadGraph));
  store.add(...buildRiverDeformations(map, getHydrologyResult(map)));
  store.add(...buildSettlementPadDeformations(map));
  store.add(...buildBarrierDeformations(map)); // walls: stepped foundation footing under the curtain
  store.add(...buildEarthworkDeformations(map.earthworks ?? [])); // motte/ditch/rampart of a placed complex
  store.add(...buildLeveeDeformations(map)); // #24: riverside roads ride up on an embankment
  worldStoreCache.set(k, store);
  evict(worldStoreCache);
  return store;
}

/**
 * The world's NORMALISED `[0,1]` elevation field with road grade-cuts AND river
 * incision composed in — what the GPU terrain mesh lifts. Returns the SAME base
 * array instance (zero cost, byte-parity) when there are no deformations at all.
 * Memoised by (seed, dims, store version); callers must treat it read-only.
 */
export function getComposedHeightfield(map: GameMap): Float32Array {
  // Inspection ground (studio): a dead-flat plane just above sea level — no seed
  // noise, so the subject sits clean with no procedural peaks/snow/rock around it.
  // The same flat field feeds entity foot-z lift, so the building stays flush.
  if (map.flatHeight) return new Float32Array(map.width * map.height).fill(ELEVATION_SEA_LEVEL + 0.1);
  const base = getHeightfield(map.seed, map.width, map.height, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed));
  const store = getWorldDeformationStore(map);
  if (store.size === 0) return base; // parity by construction

  const k = `${key(map)}:v${store.version}`;
  const cached = fieldCache.get(k);
  if (cached) return cached;

  const { width, height } = map;
  const relief = worldStyleOf(map.worldSeed).mountainRelief;
  const out = new Float32Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const m = heightAt(map, store, tx, ty);
      out[ty * width + tx] = m / relief + ELEVATION_SEA_LEVEL;
    }
  }
  fieldCache.set(k, out);
  evict(fieldCache);
  return out;
}

/** Drop memoised stores + composed fields (tests; harmless in prod). */
export function clearRoadDeformationCache(): void {
  storeCache.clear();
  worldStoreCache.clear();
  fieldCache.clear();
}
