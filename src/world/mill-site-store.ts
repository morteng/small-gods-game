// src/world/mill-site-store.ts
//
// WATERMILL SITES — a hydrology-derived affordance layer. The water system, during worldgen,
// TAGS the cells that make good watermill locations: a dry, buildable bank cell sitting right
// against a flowing river reach of wheel-scale (a real stream, not a headwater trickle nor a
// trunk river). Settlement siting then just picks the nearest tag, so a mill lands FLUSH against
// water that already renders — the wheel dips into a genuine river cell instead of a carved
// channel the engine won't paint (the GPU water surface is re-derived from the seed heightfield,
// never from tile edits). This is the declare-affordance / resolve-to-real-terrain pattern the
// coastline anchoring already uses, lifted onto the hydrology raster.
//
// A pure VIEW of the hydrology raster (like `getWaterNetwork`): re-derives identically on load,
// keyed only by (seed, dims), never travels in the save.
//
// WP-1 (believability round, docs/audit/IMPLEMENTATION-PLAN.md §1.2) — "the wheel is beside the
// river, not in it". Two halves, both of whose inputs this module owns:
//
//   • LATERAL. A site is only good if the water is DRAWN on the cell the wheel hangs over and
//     NOT drawn on the cell the mill stands on. Both questions are asked of `paintedWaterAt` —
//     the one query documented as "is this cell BLUE on screen" — and NOT of the render
//     water-TYPE mask (which over-reports: it is the smoothed ribbon plus its fringe).
//   • VERTICAL — the dominant defect. Each surviving site carries `gapM`, the metres its foot
//     stands above the drawn fill line at the wheel cell, so the placer can sink THIS mill's
//     wheel by exactly that much instead of the preset's one-size-fits-all `submerge`. A site
//     needing more than `MAX_GAP_M` is dropped — no plausible wheel reaches that far.
//
// ── A CORRECTION TO THE PLAN, MEASURED (read before "fixing" this back) ────────────────────
// §1.2 diagnosed the lateral half with `waterSurfaceAt`, which answers a DIFFERENT question:
// does standing water cover this cell BY ITS OWN classification and surface. That badly
// understates the painted water, because the shader bilinearly samples the per-cell surface
// field and so paints ~1 cell past the classified channel. Measured on the pinned world within
// 22 tiles of khar_ordu: 200 cells are mask-`River`, 176 are PAINTED, and only 69 are
// `waterSurfaceAt`-wet. Filtering on `waterSurfaceAt` therefore threw away every site near
// every settlement on that seed (three towns lost their mill outright) while claiming the
// "real water" was tiles away — it wasn't, it was right there and blue. `paintedWaterAt` is the
// query that matches the eye, and the eye is what the bug report was about.
//
// The same correction kills the plan's "reject gapM < 0 as a flood seat". Under the painted
// rule a negative gap does NOT mean the mill floods: standing ON drawn water is excluded
// directly and separately (the bank must be unpainted), and a negative gap merely means the
// neighbouring channel's interpolated fill line runs above this bank's bed — routine on an
// incised, bank-referenced surface, and the majority case near khar_ordu (p50 −0.97 m). Those
// sites are the BEST ones: the water already reaches the foot, so the wheel needs nothing but
// its rim dip. The gap is clamped at 0 rather than rejected.
//
// GEN-TIME CAVEAT (deliberate, not an oversight): `heightField` here composes whatever
// deformations the map has DECLARED so far. `placeSettlement` runs on the generator's map stub,
// which carries base terrain ⊕ river incision but not yet roads, foundation pads or wall
// footings — and the drawn river surface is BANK-REFERENCED, so later bank edits move the water
// as well as the ground. Measured residual between the placer's reading and the final field on
// the two probed seeds: 0 to +0.7 m. Trying to model it made things worse (see
// `millWheelSubmergeForFootprint`), so it is left to the `mill.wheel-reaches-water` contract's
// tolerance plus a deliberately deep aim ({@link PLACEMENT_DRIFT_ALLOWANCE_M}).

import type { GameMap } from '@/core/types';
import { WaterType } from '@/core/types';
import { getHydrologyResult } from '@/world/hydrology-store';
import { buildRenderWaterTypeMemo } from '@/render/gpu/render-water-mask';
import { paintedWaterAt, waterSurfaceAt } from '@/render/gpu/water-field';
import { heightField } from '@/render/gpu/terrain-field';
import { worldStyleOf } from '@/core/world-style';
import { ISO_TILE_W } from '@/render/scale-contract';

export type MillFace = 'north' | 'south' | 'east' | 'west';

export interface MillSite {
  /** The BANK cell (footprint anchor): land the water plane is NOT painted on, orthogonally
   *  adjacent to a rendered wheel-scale river reach that IS painted. */
  x: number;
  y: number;
  /** Cardinal from the bank toward the river — the flank the wheel should face. */
  waterFace: MillFace;
  /** Unit flow of the river cell (downstream sense — for a future spin direction). */
  flowDir: [number, number];
  /** Flow-accumulation of the river cell — a wheel-power proxy; higher = stronger site. */
  strength: number;
  /**
   * METRES the bank foot stands above the DRAWN fill line at the wheel cell (WP-1). At most
   * {@link MAX_GAP_M}; may be NEGATIVE, which simply means the water already reaches the foot
   * (see the module header — that is a good site, not a flooded one). The placer turns this
   * into the wheel's per-site `submerge`; see {@link metresPerPrimZ}.
   */
  gapM: number;
}

// Strahler band for a wheel-scale stream: above a headwater trickle (1), below a trunk river.
const MIN_ORDER = 2;
const MAX_ORDER = 6;

/**
 * How far above the drawn fill line a bank may stand and still be millable, in metres.
 *
 * Beyond this the wheel cannot reach the water without the building visibly levitating over
 * it. 1.5 m is ~0.7 prim-z on the default world — over half the authored wheel radius — so
 * it is already generous; measured surviving gaps sit at a median ≈0.25–0.42 m.
 */
export const MAX_GAP_M = 1.5;

/**
 * Terrain METRES per one prim-z unit of blueprint geometry — the conversion the whole
 * wheel-depth calculation turns on, and the one thing about this fix that is NOT obvious.
 *
 * Sprites and terrain do not share a vertical scale:
 *   • a blueprint prim's z unit ( = one cube-unit = one tile) composes at exactly
 *     `ISO_TILE_W / 2` screen px (`assetgen/render/fit.ts` `fixedFit`), and the composed
 *     sprite is drawn 1:1 in world (`assetgen/view-registry.ts` sizes it metrically);
 *   • a metre of terrain elevation lifts by `worldStyle.terrainVerticalExaggeration`
 *     screen px (`render/gpu/terrain-lift.ts` `liftPxFromElev` — the single CPU mirror of
 *     the terrain shader), which is 20 on the default world, NOT PX_PER_METRE's 32.
 *
 * So one prim-z unit is worth `(ISO_TILE_W/2) / zPxPerM` metres of terrain — 3.2 m by
 * default. This is exactly the reconciliation `crossing-structures.ts`
 * (`clearanceMetresForScreen`) applies to bridge supports, in the other direction.
 *
 * Style-dependent on purpose: an alpine genome (`terrainVerticalExaggeration` 24) needs a
 * SHALLOWER submerge for the same metric gap, and a flat one (8) a deeper one.
 */
export function metresPerPrimZ(map: GameMap): number {
  return (ISO_TILE_W / 2) / worldStyleOf(map.worldSeed).terrainVerticalExaggeration;
}

/**
 * Per-cell memo of the two water reads this module makes, keyed on the map OBJECT — the same
 * lifetime discipline `waterStatic` itself uses, so a generator stub and the final map never
 * share an entry.
 *
 * Not premature: `paintedWaterAt` and `waterSurfaceAt` are each documented as O(1), but "O(1)"
 * here still means a `waterStatic` WeakMap hit, a fresh `worldStyleOf` object, and a
 * `heightField` → `getComposedHeightfield` → `key(map)` round trip that walks every settlement
 * plan's lots to build a cache-key string. The site scan asks nine of those per candidate
 * flank, over every cell on the map. Memoising per cell took the whole-map scan from seconds
 * to milliseconds and stopped `settlement-plan.test.ts` timing out.
 *
 * `wetState`/`paintState`: 0 = not yet probed, 1 = no, 2 = yes.
 */
interface WaterReadCache { wetState: Uint8Array; depth: Float32Array; paintState: Uint8Array }
const READ_CACHE = new WeakMap<GameMap, WaterReadCache>();
function readCache(map: GameMap): WaterReadCache {
  let c = READ_CACHE.get(map);
  if (!c) {
    const n = map.width * map.height;
    c = { wetState: new Uint8Array(n), depth: new Float32Array(n), paintState: new Uint8Array(n) };
    READ_CACHE.set(map, c);
  }
  return c;
}

/** Memoised {@link waterSurfaceAt} — standing water by the cell's OWN classification. */
function standingWaterAt(map: GameMap, x: number, y: number): { wet: boolean; depthM: number } {
  const c = readCache(map), i = y * map.width + x;
  if (c.wetState[i] === 0) {
    const p = waterSurfaceAt(map, x, y);
    c.wetState[i] = p.wet ? 2 : 1;
    c.depth[i] = p.depthM;
  }
  return { wet: c.wetState[i] === 2, depthM: c.depth[i] };
}

/**
 * Is the water plane PAINTED over (x,y) — the "is this cell blue on screen" question, which
 * is the one the mill rule cares about on both sides (the wheel must hang over blue, the
 * mill must not stand on it). Delegates to `paintedWaterAt` (memoised per cell) so there is
 * exactly one definition of painted water in the codebase.
 */
export function millWaterDrawnAt(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const c = readCache(map), i = y * map.width + x;
  if (c.paintState[i] === 0) c.paintState[i] = paintedWaterAt(map, x, y).wet ? 2 : 1;
  return c.paintState[i] === 2;
}

/**
 * Normalised elevation of the water plane covering (x,y), or `null` where nothing covers it.
 *
 * This is the ELEVATION companion to `paintedWaterAt`'s boolean, reconstructed with the same
 * rule (the highest fill line among the cell and its 8 neighbours) because the water field's
 * absolute `surfaceW` array is module-private. A neighbour's fill line is recovered from the
 * public probe as `bed + depthM/relief`, which is exact by `waterSurfaceAt`'s own definition
 * of `depthM`. The one divergence from `paintedWaterAt`: it counts a neighbour classified as
 * water even where that neighbour's own bed is above its surface, and such a cell has no
 * readable fill line here — so this can return a lower answer (or null) in that corner. The
 * callers treat "painted but unreadable" as unmeasurable and refuse the site, which is the
 * safe direction.
 */
function drawnSurfaceElevAt(
  map: GameMap, x: number, y: number, hf: Float32Array, relief: number,
): number | null {
  let best = -Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const p = standingWaterAt(map, nx, ny);
      if (!p.wet) continue;
      const surf = hf[ny * map.width + nx] + p.depthM / relief;
      if (surf > best) best = surf;
    }
  }
  return best === -Infinity ? null : best;
}

/**
 * Metres the bank cell (bx,by) stands above the water plane DRAWN over the cell its `face`
 * flank looks onto — or `null` when no water is painted there (nothing for a wheel to dip
 * into) or when its fill line cannot be read.
 *
 * Negative is legitimate and common: it means the fill line already runs above this bank's
 * bed, so the wheel reaches the water with nothing but its rim dip. See the module header
 * for why that is not the flood hazard the plan expected.
 *
 * `hf`/`relief` are passed in so a whole-map scan hoists the two memo lookups out of the
 * loop; both default to the map's own.
 */
export function millWheelGapM(
  map: GameMap, bx: number, by: number, face: MillFace,
  hf: Float32Array = heightField(map), relief = worldStyleOf(map.worldSeed).mountainRelief,
): number | null {
  const [dx, dy] = FACE_VEC[face];
  const wx = bx + dx, wy = by + dy;
  if (wx < 0 || wy < 0 || wx >= map.width || wy >= map.height) return null;
  if (!millWaterDrawnAt(map, wx, wy)) return null;
  const surf = drawnSurfaceElevAt(map, wx, wy, hf, relief);
  const bedBank = hf[by * map.width + bx];
  if (surf === null || bedBank === undefined) return null;
  return (bedBank - surf) * relief;
}

const FACE_VEC: Record<MillFace, readonly [number, number]> = {
  north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
};

/** How far BELOW the drawn fill line the paddle tips should finish, in metres — the PHYSICAL
 *  half of the aim. A wheel whose lowest point merely grazes the waterline reads as balanced
 *  on it; a hand's depth of rim in the race reads as driven by it. Small on purpose: the
 *  paddles must catch the current, not plough the bed. */
const RIM_DIP_M = 0.3;
/**
 * Extra depth (metres) that absorbs the gen-time → final drift described in the module
 * header, biased deliberately DEEP.
 *
 * The bias is not symmetric and that is the whole argument for it. Building sprites paint
 * OVER the water plane, so an over-deep wheel simply reads as a wheel sitting well down in
 * the race — the normal look of an undershot mill. A wheel that stops SHORT is the reported
 * bug, visible at a glance. Measured drift on the two probed seeds ran 0 to +0.7 m; 0.4 m
 * covers the observed cases while adding only ~12 screen px of depth on a ~166 px wheel.
 */
const PLACEMENT_DRIFT_ALLOWANCE_M = 0.4;
/** Quantization of the per-site `submerge`, in prim-z units. Every distinct value composes its
 *  OWN sprite (the parametric cache is content-addressed over the spec), so the step is what
 *  bounds the variant count: at 0.05 the whole reachable band is ~15 sprites across all worlds,
 *  against a continuous value's one-per-mill. Coarse enough to share, fine enough that the
 *  residual error is ≤ 0.025 prim-z ≈ 1.6 screen px. */
const SUBMERGE_STEP = 0.05;
/** `waterwheelPartType.paramSchema.submerge` bounds — mirrored here so a clamp can never
 *  produce a value `validateParams` would silently coerce. */
const SUBMERGE_MIN = 0, SUBMERGE_MAX = 1.5;

/**
 * The `submerge` (prim-z units) a mill seated with its `face` flank on bank cell (bx,by)
 * needs for its wheel's lower arc to finish {@link RIM_DIP_M} (+ the drift allowance) under
 * the DRAWN fill line at the cell the wheel hangs over.
 * `null` when that flank isn't looking at drawn water at all — the caller should not be
 * placing a mill there.
 *
 * This is the VERTICAL half of WP-1: it replaces the preset's constant 0.38, which is right
 * only for a bank standing exactly `0.38 · metresPerPrimZ` above the water and is visibly
 * wrong everywhere else. The preset default is deliberately left alone — this rides as a
 * per-call blueprint PATCH, so no recipe/geometry version moves.
 */
export function millWheelSubmerge(
  map: GameMap, bx: number, by: number, face: MillFace,
): number | null {
  return submergeForGap(map, millWheelGapM(map, bx, by, face));
}

/**
 * {@link millWheelSubmerge} for a mill whose SEATED 2×2 footprint is known — the form the
 * placer uses, because the bank cell that matters is the footprint cell the wheel hangs off,
 * which is neither the footprint origin nor (after `flushFootprintForHint` slides the
 * footprint ±1 along the bank) the tagged hint.
 *
 * MEASURED-AND-REJECTED, so nobody re-derives it: a first cut also tried to PREDICT the civic
 * foundation pad that `settlement-deformation.ts` will declare under this footprint once
 * `map.settlementPlans` exists (mean BASE grade − settle depth), on the theory that the pad
 * lifts an incised bank back up and so the pre-pad field under-reads the final gap. It does,
 * sometimes: on the pinned world two mills' final gaps came in +0.4 and +0.7 m above the
 * placer's reading. But the pad is priority 25 and the RIVER INCISION is 40, so on a carved
 * bank — exactly the mills we care about — the pad never applies and the prediction is pure
 * over-correction: it drove khar_ordu's wheel 2.85 m below the fill line (a wheel radius
 * under water) to save oakshire 0.4 m. The residual drift is left to the contract's tolerance
 * instead, where it is visible rather than compensated for by a model that is wrong half the
 * time. (The other drift source is not the pad at all: the drawn river surface is
 * bank-referenced, so any later change to bank heights moves the water too.)
 */
export function millWheelSubmergeForFootprint(
  map: GameMap, ox: number, oy: number, w: number, h: number, face: MillFace,
): number | null {
  const [fx, fy] = FACE_VEC[face];
  const bx = Math.floor(ox + w / 2 + fx * (w / 2 + 0.5)) - fx;
  const by = Math.floor(oy + h / 2 + fy * (h / 2 + 0.5)) - fy;
  return millWheelSubmerge(map, bx, by, face);
}

/** Shared tail of the two submerge entry points: clamp the gap into the reachable band, add
 *  the rim dip, convert to prim-z and quantize. */
function submergeForGap(map: GameMap, gap: number | null): number | null {
  if (gap === null) return null;
  // Clamp, don't reject: a negative gap means the fill line already covers the foot, so all
  // the wheel owes is its rim dip. (Clamping at 0 also keeps the wheel from being hauled UP
  // out of the water on such a site, which a raw negative would do.)
  const reach = Math.min(Math.max(gap, 0), MAX_GAP_M) + RIM_DIP_M + PLACEMENT_DRIFT_ALLOWANCE_M;
  const q = Math.round(reach / metresPerPrimZ(map) / SUBMERGE_STEP) * SUBMERGE_STEP;
  // toFixed(2) kills float-step drift (0.30000000000000004) so equal gaps hash to ONE
  // cache key instead of two sprites that differ in the 17th decimal.
  return Number(Math.min(Math.max(q, SUBMERGE_MIN), SUBMERGE_MAX).toFixed(2));
}

const NEIGH: ReadonlyArray<readonly [number, number, MillFace]> = [
  [0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east'],
];

const cache = new Map<string, MillSite[]>();
const CACHE_CAP = 4;
const keyOf = (m: GameMap): string => `${m.seed}:${m.width}x${m.height}`;

/** Every good watermill site on the map, strongest flow first. Memoised by (seed, dims). */
export function getMillSites(map: GameMap): MillSite[] {
  const k = keyOf(map);
  const hit = cache.get(k);
  if (hit) { cache.delete(k); cache.set(k, hit); return hit; }   // LRU touch
  const sites = computeMillSites(map);
  cache.set(k, sites);
  if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value as string);
  return sites;
}

function computeMillSites(map: GameMap): MillSite[] {
  const hydro = getHydrologyResult(map);
  const { strahler, flowField, flowDirX, flowDirY } = hydro;
  const W = map.width, H = map.height;
  // Tag against the RENDER water — the smoothed connectome ribbon the shader actually paints —
  // not the hydrology raster / tile 'river', which can sit a cell off the visible channel at
  // meanders (so a mill tagged on the raster could dip into dry-looking ground). The wheel-scale
  // filter still comes from the hydrology Strahler/flow, sampled over a 3×3 around the ribbon
  // cell to bridge that raster↔ribbon offset.
  const renderWT = buildRenderWaterTypeMemo(map);
  const idx = (x: number, y: number): number => y * W + x;
  // Strongest (max-order) hydrology channel cell within a 3×3 of (cx,cy) — the raster reach that
  // feeds this rendered river cell — with its flow for scoring.
  const channelAround = (cx: number, cy: number): { ord: number; k: number } => {
    let ord = -1, k = -1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const kk = idx(x, y);
        if (strahler[kk] > ord) { ord = strahler[kk]; k = kk; }
      }
    }
    return { ord, k };
  };
  // WP-1 — the two memo lookups the wet test needs, hoisted out of the O(W·H) scan.
  const hf = heightField(map);
  const relief = worldStyleOf(map.worldSeed).mountainRelief;
  const out: MillSite[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // The BANK's own dryness is checked after a flank qualifies (see below) — the mask read
      // that used to gate it here (`renderWT[bank] === Dry`) is deliberately gone. The mask's
      // ribbon is ~1 cell wider than the painted water on each side, so insisting on a mask-dry
      // bank pushes the mill a cell or two back from the water for no visual reason, which is
      // most of the vertical gap this WP is fixing. The real rule is the visible one: don't
      // stand the mill on blue.
      let bestS = -1, bestFace: MillFace | null = null, bestK = -1, bestGap = 0;
      for (const [dx, dy, face] of NEIGH) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        // The render mask + hydrology Strahler/flow still decide WHICH water this is — a
        // wheel-scale flowing reach rather than a lake edge, a trunk river or a trickle. They
        // are cheap array reads, so they pre-filter the expensive painted-water probes below.
        if (renderWT[idx(nx, ny)] !== WaterType.River) continue;   // a RENDERED flowing reach
        const { ord, k } = channelAround(nx, ny);
        if (ord < MIN_ORDER || ord > MAX_ORDER || k < 0) continue;  // wheel-scale, not trunk/trickle
        // …and `millWheelGapM` decides whether the water is actually PAINTED there and how far
        // the wheel would have to reach down to it. Null ⇒ nothing blue under the wheel.
        const gap = millWheelGapM(map, x, y, face, hf, relief);
        if (gap === null || gap > MAX_GAP_M) continue;
        const s = flowField[k];
        if (s > bestS) { bestS = s; bestFace = face; bestK = k; bestGap = gap; }
      }
      // Only now — after a candidate flank has passed the cheap pre-filters — is the bank's own
      // paint worth a probe (this loop visits every cell on the map). A mill may not STAND in
      // the drawn river; its wheel is the only part allowed over the water.
      if (bestFace && !millWaterDrawnAt(map, x, y)) {
        out.push({
          x, y, waterFace: bestFace, flowDir: [flowDirX[bestK], flowDirY[bestK]],
          strength: bestS, gapM: bestGap,
        });
      }
    }
  }
  out.sort((a, b) => b.strength - a.strength);
  return out;
}

/** The good mill sites within `maxDist` tiles of (cx,cy), NEAREST first (flow breaks ties, since
 *  the input is flow-sorted). The caller tries them in order until a clean footprint seats. */
export function millSitesNear(sites: MillSite[], cx: number, cy: number, maxDist: number): MillSite[] {
  return sites
    .filter(s => Math.abs(s.x - cx) + Math.abs(s.y - cy) <= maxDist)
    .sort((a, b) => (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy)));
}
