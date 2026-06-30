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
import type { RoadGraph, RoadEdge, RoadNode } from '@/world/road-graph';
import {
  DeformationStore,
  heightAt,
  type Deformation,
} from '@/world/terrain-deformation';
import { getHeightfield, ELEVATION_SEA_LEVEL, heightMetresAt } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { worldStyleOf } from '@/core/world-style';
import { buildRiverDeformations } from '@/world/river-deformation';
import { buildSettlementPadDeformations, settlementBuildCount } from '@/world/settlement-deformation';
import { buildBarrierDeformations, barrierFoundationCount } from '@/world/barrier-deformation';
import { buildEarthworkDeformations } from '@/world/earthwork-deformation';
import { getHydrologyResult } from '@/world/hydrology-store';
import { smoothCenterline, type Pt } from '@/terrain/road-centerline';
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

/** Derive one road edge's smoothed centerline + RoadState + cross-section, or null. */
export function edgeRoadProfile(
  map: GameMap,
  edge: RoadEdge,
  nodeById: Map<string, RoadNode>,
  poiById: Map<string, POI>,
  dynamicFor?: (edge: RoadEdge) => RoadDynamics | undefined,
): EdgeRoadProfile | null {
  if (edge.feature !== 'road' || edge.polyline.length < 2) return null;
  const centerline = smoothCenterline(edge.polyline);
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
  cumS[0] = 0;
  for (let i = 0; i < n; i++) {
    grade[i] = heightMetresAt(map, Math.round(centerline[i].x), Math.round(centerline[i].y));
    if (i > 0) cumS[i] = cumS[i - 1] + Math.hypot(centerline[i].x - centerline[i - 1].x, centerline[i].y - centerline[i - 1].y);
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
  return `${map.seed}:${map.width}x${map.height}:r${map.roadGraph?.rev ?? 0}:b${settlementBuildCount(map)}:w${barrierFoundationCount(map)}:e${map.earthworks?.length ?? 0}`;
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
  const base = getHeightfield(map.seed, map.width, map.height, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null);
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
