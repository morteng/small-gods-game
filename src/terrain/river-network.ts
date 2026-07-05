// src/terrain/river-network.ts
//
// The WATER CONNECTOME — rivers promoted from a per-cell raster to a graph.
//
// `generateHydrology` gives us a per-cell drainage RASTER (`waterType`, `drainTo`,
// `flowField`, `strahler`). That is the right substrate for *where the water is*,
// but it has no notion of identity: there is no "this brook", no "the river that
// leaves Mirror Pond", no "two tributaries from different springs that meet here".
// Every feature the design calls for — sub-cell pixel-perfect carving, ponds on a
// stream, lake-fed rivers, multi-source confluences, draggable/reorderable features
// — needs the SAME thing: the channel as a GRAPH.
//
// This module walks the drainage forest in `drainTo` and lifts it into:
//   • NODES — the articulation points where the network's meaning changes:
//       spring (a headwater source), confluence (≥2 channels merge), lake_outlet
//       (a channel born at a lake's spill), lake_inlet (a channel enters a lake),
//       mouth (a channel reaches the ocean / map edge — an estuary).
//   • REACHES — a maximal run of channel cells between two nodes, carrying its
//       Strahler order, flow, a spectrum CLASS (brook → stream → river → major), a
//       lake-fed flag, and a SMOOTHED SUB-CELL centerline (Catmull-Rom resample of
//       the cell centres) — the line the carve and the renderer follow for a
//       contour-hugging channel instead of a blocky per-cell staircase.
//
// Pure + deterministic (cells visited in index order, ids derived from cell index);
// no randomness, no I/O. The raster stays the source of truth for occupancy; this is
// a derived, queryable, editable VIEW of it.

import type { HydrologyResult } from '@/core/types';
import { WaterType } from '@/core/types';

/** Articulation points of the channel graph — where the network's meaning changes. */
export type WaterNodeKind =
  | 'spring'       // headwater source: a channel begins (no upstream channel, no lake feed)
  | 'lake_outlet'  // a channel is born at a lake's spill point (lake-fed river)
  | 'confluence'   // two or more channels merge
  | 'lake_inlet'   // a channel flows into a lake
  | 'mouth';       // a channel reaches the ocean or the map edge (estuary)

/** The river spectrum, derived from Strahler order — a brook is not a trunk river. */
export type ReachClass = 'brook' | 'stream' | 'river' | 'major_river';

/** Still-water size spectrum — a mountain tarn is not a great mere. By cell area. */
export type LakeClass = 'tarn' | 'pond' | 'lake' | 'mere';

/** A connected still-water body (a lake/pond), classified by area, with the channel
 *  junctions on its shore (the springs of its outflow, the mouths of its inflow). */
export interface WaterBody {
  id: string;
  klass: LakeClass;
  cells: number[];       // grid indices of the lake body
  area: number;          // cell count
  x: number;             // centroid (tile coords)
  y: number;
  outletIds: string[];   // lake_outlet junction node ids fed BY this lake
  inletIds: string[];    // lake_inlet junction node ids draining INTO this lake
}

/** Area (cells) → size class. A tarn is a handful of cells; a mere is a major basin. */
export function classifyLake(area: number): LakeClass {
  return area <= 3 ? 'tarn' : area <= 12 ? 'pond' : area <= 60 ? 'lake' : 'mere';
}

export interface WaterNode {
  id: string;
  kind: WaterNodeKind;
  cell: number;          // grid index (y*W + x)
  x: number;             // tile coords (cell column / row)
  y: number;
}

export interface Pt { x: number; y: number; }

export interface WaterReach {
  id: string;
  from: string;          // upstream node id
  to: string;            // downstream node id
  cells: number[];       // ordered channel cells, upstream→downstream (endpoints included)
  order: number;         // Strahler order (max along the reach)
  flow: number;          // accumulated flow at the downstream end
  flowUp: number;        // accumulated flow at the upstream end (for width taper)
  klass: ReachClass;     // spectrum classification
  lakeFed: boolean;      // true when the upstream node is a lake outlet
  /** Smoothed sub-cell centreline (tile coords), Catmull-Rom resample of cell centres. */
  centerline: Pt[];
}

export interface WaterNetwork {
  nodes: WaterNode[];
  reaches: WaterReach[];
  lakes: WaterBody[];
  byId: Map<string, WaterNode>;
  /** node id at a given channel cell, when that cell IS a node (else undefined). */
  nodeAtCell: Map<number, string>;
  /** Grid dimensions — so an editor can re-route a reach (cells → centreline) on a move. */
  width: number;
  height: number;
}

/**
 * Connected-component lake bodies over the still-water raster, each classified by area
 * and linked to the channel junctions on its shore. 4-connected flood fill in index
 * order (deterministic). `nodeAtCell` maps a shore river cell to its junction id so we
 * can record which outlets a lake feeds and which inlets drain into it.
 */
export function detectLakeBodies(
  hydro: HydrologyResult, W: number, H: number, nodeAtCell: Map<number, string>,
): WaterBody[] {
  const { waterType } = hydro;
  const total = W * H;
  const seen = new Uint8Array(total);
  const bodies: WaterBody[] = [];
  const isLakeCell = (i: number): boolean => i >= 0 && i < total && waterType[i] === WaterType.Lake;
  for (let s = 0; s < total; s++) {
    if (!isLakeCell(s) || seen[s]) continue;
    const cells: number[] = [];
    const stack = [s];
    seen[s] = 1;
    let sx = 0, sy = 0;
    const outletIds = new Set<string>();
    const inletIds = new Set<string>();
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % W, cy = (c / W) | 0;
      cells.push(c); sx += cx; sy += cy;
      const visit = (n: number): void => {
        if (isLakeCell(n) && !seen[n]) { seen[n] = 1; stack.push(n); }
        else if (waterType[n] === WaterType.River) {
          // A river junction on this lake's shore: lake_outlet (fed by lake) or lake_inlet.
          const id = nodeAtCell.get(n);
          if (!id) return;
          if (hydro.drainTo[n] === c) inletIds.add(id);        // river drains INTO this lake cell
          else if (hydro.drainTo[c] === n) outletIds.add(id);  // lake spills INTO this river cell
        }
      };
      if (cy > 0) visit(c - W);
      if (cy < H - 1) visit(c + W);
      if (cx > 0) visit(c - 1);
      if (cx < W - 1) visit(c + 1);
    }
    const area = cells.length;
    bodies.push({
      id: `wl:${s}`,
      klass: classifyLake(area),
      cells,
      area,
      x: sx / area,
      y: sy / area,
      outletIds: [...outletIds],
      inletIds: [...inletIds],
    });
  }
  return bodies;
}

const CLASS_RANK: Record<ReachClass, number> = { brook: 0, stream: 1, river: 2, major_river: 3 };

/**
 * Spectrum class from DISCHARGE (flow = upstream drainage area, a discharge proxy)
 * blended with a structural Strahler floor. Discharge is what physically separates a
 * brook from a river — a high-volume trunk reads as a river even if no tributary ever
 * merged into it (Strahler 1). The order floor keeps a post-confluence trunk from
 * dropping below a stream. `threshold` is the flow at which a cell became a channel,
 * so the buckets are relative to "the smallest channel this world has".
 */
export function classifyReach(order: number, flow: number, threshold: number): ReachClass {
  const f = flow / Math.max(1, threshold);
  const byFlow: ReachClass = f < 1.5 ? 'brook' : f < 4 ? 'stream' : f < 10 ? 'river' : 'major_river';
  const byOrder: ReachClass = order <= 1 ? 'brook' : order === 2 ? 'stream' : order === 3 ? 'river' : 'major_river';
  return CLASS_RANK[byFlow] >= CLASS_RANK[byOrder] ? byFlow : byOrder;
}

/** Centreline resample spacing (tiles). ~0.5 tile gives sub-cell pixel-perfect carve
 *  resolution without exploding vertex counts on a long trunk. */
const CENTERLINE_SPACING = 0.5;

/**
 * Chaikin corner-cutting — rounds a polyline by replacing each interior corner with
 * two points 1/4 and 3/4 along its edges, ENDPOINTS PRESERVED (so a reach still
 * starts at its spring and ends at its mouth). The drainage path the raster hands us
 * steps in 8 directions, so a diagonal river arrives as a 90° staircase; Catmull-Rom
 * alone interpolates THROUGH those steps and keeps the jaggedness. Cutting the
 * corners first turns the staircase into the smooth bends a real river cuts. Pure.
 */
function chaikin(pts: Pt[], iterations: number): Pt[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) break;
    const next: Pt[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i], b = cur[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** Deterministic [0,1) hash of two integers (sfc-flavoured; no Math.random). */
function hash01(x: number, y: number): number {
  let h = Math.imul((Math.trunc(x) * 73856093) ^ (Math.trunc(y) * 19349663), 2654435761) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Per-reach meander shape. `amp`/`wavelength` in tiles; `phase` radians; `skew` is the
 *  Kinoshita third-harmonic weight (asymmetric, down-valley-leaning bends). */
export interface MeanderConfig { amp: number; wavelength: number; phase: number; skew: number; }

/**
 * Bend a polyline into natural sinuous meanders. A raw drainage path reads as a
 * "finger scrape" because it's straight; a real channel follows a sine-generated
 * curve (Langbein & Leopold — the minimum-bend-stress shape) with a Kinoshita
 * third-harmonic skew that leans bends downstream. We displace each vertex
 * perpendicular to its local tangent by that curve, sampled along arc length, with a
 * `sin(π·t)` envelope so the displacement is ZERO at both ends — springs and
 * confluences stay pinned and the network stays joined. Pure + deterministic.
 */
export function meanderPolyline(pts: Pt[], cfg: MeanderConfig): Pt[] {
  const n = pts.length;
  if (n < 3 || cfg.amp <= 0) return pts;
  const s: number[] = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = s[n - 1] || 1;
  const k = (2 * Math.PI) / Math.max(1e-3, cfg.wavelength);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y;
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = -ty, ny = tx;                              // left normal
    const phi = k * s[i] + cfg.phase;
    const env = Math.sin(Math.PI * (s[i] / total));      // 0 at both ends, 1 at mid
    const d = cfg.amp * env * (Math.sin(phi) - cfg.skew * Math.sin(3 * phi));
    out.push({ x: pts[i].x + nx * d, y: pts[i].y + ny * d });
  }
  return out;
}

/**
 * Down-VALLEY slope of a reach: the fall in water-surface elevation from its upstream
 * end to its downstream end over the raw D8 path length (tiles). This is the gradient
 * the channel MUST descend; meandering is how a river lengthens itself to soften it.
 * `surfaceW` is the hydrology water-surface raster (normalized elevation units, −1 on
 * dry land); a dry-sentinel endpoint means no usable gradient (return 0 → straight).
 * Units are normalized-elev-per-tile — the meander constants are calibrated in these
 * same units, so the absolute vertical scale is absorbed. Pure.
 */
export function reachValleySlope(cells: number[], surfaceW: Float32Array, W: number): number {
  const n = cells.length;
  if (n < 2) return 0;
  const z0 = surfaceW[cells[0]], z1 = surfaceW[cells[n - 1]];
  if (!(z0 >= 0) || !(z1 >= 0)) return 0;                 // dry sentinel ⇒ no gradient
  let len = 0;
  for (let i = 1; i < n; i++) {
    const a = cells[i - 1], b = cells[i];
    const dx = (b % W) - (a % W), dy = ((b / W) | 0) - ((a / W) | 0);
    len += Math.hypot(dx, dy);
  }
  return len > 0 ? Math.max(0, z0 - z1) / len : 0;
}

// ── Meander planform (gradient-driven; rivers R1) ──────────────────────────────────
// A channel does not meander by whim — it lengthens itself to spend a fixed slope. The
// Leopold–Wolman threshold S꜀ = k·Q^−0.44 separates the straight/steep regime (bedrock
// & mountain streams, S_v ≥ S꜀) from the sinuous alluvial regime (S_v < S꜀); the
// flatter the valley sits below that line, the curvier the river. We size the wave from
// geomorphology, not vibes:
//   • gate: reach steeper than S꜀ gets NO injected meander (Chaikin smoothing only).
//   • sinuosity K = clamp(S꜀ / S_v, 1.05, MAX) — flatter valley ⇒ higher sinuosity.
//     (The spec sketched K = S_v/S_channel; that ratio is inverted — it would make
//     steep reaches the curvy ones. S꜀/S_v is the physically correct reading and the
//     one that yields "steep runs straight, lowland wanders".)
//   • wavelength λ ≈ 11 · full channel width (Leopold's meander-length scaling), off
//     the REAL hydraulic width (√Q), not the old order proxy.
//   • amplitude from Williams (1986) belt-width fit A/λ ≈ 0.9743·ln K + 0.0803, halved
//     (Williams A is peak-to-peak; meanderPolyline's amp is peak-to-centerline), then
//     an absolute cap in channel widths so a trunk can't wander off its corridor (the
//     confinement clamp — perpendicular valley-floor probing — is a later slice).

/** Leopold–Wolman threshold coefficient, in (normalized-elev/tile)·Q^0.44 units. Below
 *  S꜀ = k·Q^−0.44 a reach meanders; above it runs straight. Calibrated on the probe
 *  seeds so headwaters/steep reaches straighten and lowland trunks wander. */
export const MEANDER_SLOPE_K = 0.16;
export const MEANDER_SLOPE_Q_EXP = -0.44;   // Leopold–Wolman threshold exponent
export const MEANDER_SINUOSITY_MAX = 2.5;
export const MEANDER_WAVELENGTH_WIDTHS = 11; // λ ≈ 11 × full channel width (Leopold)
export const MEANDER_AMP_CAP_WIDTHS = 3;     // belt scales with channel width…
export const MEANDER_AMP_CAP_TILES = 2.75;   // …but never past this (no confinement clamp yet)
/** A reach must be at least this many wavelengths long to host a meander. Below it the
 *  reach is a short junction-to-junction connector (the very reaches roads bridge and
 *  croft walls gate) — a real river bridges/crosses at STRAIGHT narrow reaches, and a
 *  sub-wavelength reach has no room to develop a bend anyway. Straightening these keeps
 *  crossings/gate-seating on the un-displaced channel (bridge/croft reconciliation is
 *  position-sensitive — moving a short crossing reach unseats its deck). */
export const MEANDER_MIN_LEN_WAVELENGTHS = 1;

/**
 * Gradient-driven meander shape for a reach. `flow` is the flow-accumulation proxy for
 * discharge Q, `halfWidth` the channel half-width (tiles) at the reach mouth,
 * `valleySlope` the down-valley gradient from `reachValleySlope`, and `reachLen` the
 * reach's raw arc length (tiles). Steep, gradient-unknown, or TOO-SHORT reaches return a
 * zero-amplitude (straight) config. Deterministic: the spring cell seeds the phase + a
 * hair of wavelength jitter so parallel reaches don't lock.
 */
export function reachMeander(
  flow: number, halfWidth: number, valleySlope: number, reachLen: number,
  springX: number, springY: number,
): MeanderConfig {
  const phase = hash01(springX + 7, springY + 13) * Math.PI * 2;
  const straight: MeanderConfig = { amp: 0, wavelength: 1, phase, skew: 0 };
  const critical = MEANDER_SLOPE_K * Math.pow(Math.max(flow, 1), MEANDER_SLOPE_Q_EXP);
  if (valleySlope <= 0 || valleySlope >= critical) return straight;  // steep ⇒ straight
  const K = Math.min(MEANDER_SINUOSITY_MAX, Math.max(1.05, critical / valleySlope));
  const fullW = Math.max(2 * halfWidth, 1);
  const wavelength = MEANDER_WAVELENGTH_WIDTHS * fullW;
  if (reachLen < MEANDER_MIN_LEN_WAVELENGTHS * wavelength) return straight;  // no room ⇒ straight
  const ampWilliams = 0.5 * wavelength * (0.9743 * Math.log(K) + 0.0803);
  const amp = Math.min(MEANDER_AMP_CAP_WIDTHS * fullW, MEANDER_AMP_CAP_TILES, ampWilliams);
  const j = hash01(springX, springY);
  return { amp, wavelength: wavelength * (0.9 + 0.2 * j), phase, skew: 0.18 };
}

// ── Channel width by flow (downstream hydraulic geometry) ──────────────────────────
// A real channel is not one constant width per spectrum class: it WIDENS downstream as
// tributaries add discharge. Leopold & Maddock's downstream hydraulic geometry gives
// width ∝ Qᵇ with b ≈ 0.5, so the half-width scales with √(flow). We taper each reach
// from its upstream accumulation to its mouth accumulation, and the per-world REFERENCE
// flow (the smallest channel flow ≈ the threshold) anchors the scale, so the same law
// reads correctly in any world without plumbing the threshold around. A spring brook
// stays thin; a post-confluence trunk steps wider; the carve + the render geometry both
// read this one profile, so they never disagree.

/** Channel half-width (tiles) at the reference flow — a brook. */
export const RIVER_HALF_AT_REF = 0.5;
/** Floor / ceiling on a channel's half-width (tiles). The ceiling matters: √Q saturates
 *  at (MAX/AT_REF)² × refFlow, and 2.4 put that at ~23× the smallest channel — every
 *  trunk river on a real map clamped to the identical width. 3.2 (≈13 m full width)
 *  moves saturation to ~41× so majors keep differentiating. */
export const RIVER_HALF_MIN = 0.32;
export const RIVER_HALF_MAX = 3.2;

/** The reference flow for a network: its smallest reach flow (≈ the channel threshold),
 *  so the width law scales per-world. Never 0 (degenerate networks fall back to 1). */
export function referenceFlow(net: WaterNetwork): number {
  let m = Infinity;
  for (const r of net.reaches) if (r.flow < m) m = r.flow;
  return Number.isFinite(m) && m > 0 ? m : 1;
}

/** Channel half-width (tiles) from accumulated flow via W ∝ √(Q/Qref), clamped. */
export function halfWidthFromFlow(flow: number, refFlow: number): number {
  const w = RIVER_HALF_AT_REF * Math.sqrt(Math.max(flow, 0) / (refFlow || 1));
  return Math.min(RIVER_HALF_MAX, Math.max(RIVER_HALF_MIN, w));
}

/** Downstream depth exponent (Leopold & Maddock: mean depth ∝ Qᶠ, f ≈ 0.4). */
export const RIVER_DEPTH_FLOW_EXP = 0.4;
/** Floor on the depth taper so a headwater bed never vanishes (fraction of class depth). */
export const RIVER_DEPTH_MIN_FRAC = 0.4;

/** Per-centreline-vertex carve depth (metres) for a reach: the reach's spectrum-class
 *  depth (`classDepthM`, the value at the mouth) tapered SHALLOWER upstream by
 *  (localFlow / mouthFlow)^0.4, floored so the bed never disappears at the spring. The
 *  bed therefore drops continuously from headwater to mouth WITHIN a reach, and steps up
 *  at confluences where the class grows — so the river stops reading as one flat trench. */
export function reachDepths(reach: WaterReach, classDepthM: number): number[] {
  const cl = reach.centerline;
  const n = cl.length;
  if (n === 0) return [];
  // No flow gradient to taper along (a zero-flow degenerate/headwater stub) ⇒ uniform
  // class depth, the shallow base value for that channel size.
  if (reach.flow <= 0) return new Array(n).fill(classDepthM);
  const mouth = reach.flow;
  if (n === 1) return [classDepthM];
  const s: number[] = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(cl[i].x - cl[i - 1].x, cl[i].y - cl[i - 1].y));
  const total = s[n - 1] || 1;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const f = reach.flowUp + (reach.flow - reach.flowUp) * (s[i] / total);
    const ratio = Math.min(1, Math.max(0, f / mouth));
    out[i] = classDepthM * Math.max(RIVER_DEPTH_MIN_FRAC, Math.pow(ratio, RIVER_DEPTH_FLOW_EXP));
  }
  return out;
}

/** Per-centreline-vertex half-widths (tiles) for a reach: the channel widens by arc
 *  length from its upstream accumulation (`flowUp`) to its mouth (`flow`). Both the
 *  carve and the render geometry consume this, so width is coherent end-to-end. */
export function reachHalfWidths(reach: WaterReach, refFlow: number): number[] {
  const cl = reach.centerline;
  const n = cl.length;
  if (n === 0) return [];
  if (n === 1) return [halfWidthFromFlow(reach.flow, refFlow)];
  const s: number[] = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(cl[i].x - cl[i - 1].x, cl[i].y - cl[i - 1].y));
  const total = s[n - 1] || 1;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const f = reach.flowUp + (reach.flow - reach.flowUp) * (s[i] / total);
    out[i] = halfWidthFromFlow(f, refFlow);
  }
  return out;
}

/**
 * Smooth a channel control polyline into a bendy centreline: round the D8 staircase
 * with Chaikin corner-cutting, then Catmull-Rom resample at a fixed spacing for an
 * even, sub-cell carve. Endpoints are duplicated for the end tangents so the curve
 * passes through every (rounded) point and stays in the corridor. Pure.
 */
export function smoothCenterline(control: Pt[], spacing = CENTERLINE_SPACING, meander?: MeanderConfig): Pt[] {
  if (control.length <= 2) return control.slice();
  // Round the D8 staircase, THEN meander (so bends ride the smoothed path, not the
  // jagged one), THEN Catmull-Rom resample to an even sub-cell spacing.
  const p = meander ? meanderPolyline(chaikin(control, 2), meander) : chaikin(control, 2);
  const n = p.length;
  const at = (i: number): Pt => p[i < 0 ? 0 : i >= n ? n - 1 : i];
  const out: Pt[] = [{ x: p[0].x, y: p[0].y }];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const steps = Math.max(1, Math.round(segLen / spacing));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const t2 = t * t, t3 = t2 * t;
      // Catmull-Rom basis (uniform, tension 0.5).
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x, y });
    }
  }
  return out;
}

/**
 * Lift the hydrology raster into the water connectome (nodes + reaches).
 * `hydro` is the per-cell drainage model; `W`/`H` are the grid dimensions; `threshold`
 * is the flow at which a cell became a channel (so reach classes scale to this world).
 */
export function buildWaterNetwork(hydro: HydrologyResult, W: number, H: number, threshold = 500): WaterNetwork {
  const { waterType, drainTo, flowField } = hydro;
  const total = W * H;
  const isRiver = (i: number): boolean => i >= 0 && i < total && waterType[i] === WaterType.River;
  const isLake = (i: number): boolean => i >= 0 && i < total && waterType[i] === WaterType.Lake;
  const isOcean = (i: number): boolean => i >= 0 && i < total && waterType[i] === WaterType.Ocean;

  // ── Upstream channel in-degree, and whether a lake feeds each river cell. ──
  // A river cell's downstream is the single `drainTo`; its UPSTREAM donors are every
  // neighbour whose drainTo points back at it. We count river donors (for confluence
  // detection) and note any lake donor (a lake spilling into this cell = lake-fed).
  const riverInDeg = new Uint8Array(total);
  const lakeFeeds = new Uint8Array(total);
  for (let j = 0; j < total; j++) {
    const t = drainTo[j];
    if (t < 0) continue;
    if (!isRiver(t)) continue;
    if (isRiver(j)) { if (riverInDeg[t] < 255) riverInDeg[t]++; }
    else if (isLake(j)) lakeFeeds[t] = 1;
  }

  // ── CHANNEL Strahler — order over the river subgraph only. ──
  // `hydro.strahler` is the FULL-drainage-tree order (every hillslope land cell is a
  // node), so even a headwater channel reads order 3-4 because a big slope drains into
  // it. For the river SPECTRUM we want the channel order: a source channel = 1, rising
  // only where two CHANNELS meet. Process river cells in ascending flow (donors, which
  // carry less flow, finalize before the cell they feed) and apply the Strahler rule.
  const chOrder = new Uint16Array(total);
  const riverCells: number[] = [];
  for (let i = 0; i < total; i++) if (isRiver(i)) riverCells.push(i);
  riverCells.sort((a, b) => flowField[a] - flowField[b]);
  for (const i of riverCells) {
    const x = i % W, y = (i / W) | 0;
    let maxOrd = 0, cntMax = 0;
    const consider = (n: number): void => {
      if (drainTo[n] === i && isRiver(n)) {
        const o = chOrder[n];
        if (o > maxOrd) { maxOrd = o; cntMax = 1; }
        else if (o === maxOrd) cntMax++;
      }
    };
    if (y > 0) consider(i - W);
    if (y < H - 1) consider(i + W);
    if (x > 0) consider(i - 1);
    if (x < W - 1) consider(i + 1);
    chOrder[i] = maxOrd === 0 ? 1 : (cntMax >= 2 ? maxOrd + 1 : maxOrd);
  }

  // ── Classify each river cell as a node (or interior body cell). ──
  // Downstream terminal kinds (mouth / inlet) are read from what `drainTo` points at;
  // upstream kinds (spring / lake_outlet / confluence) from the donor counts above.
  const nodes: WaterNode[] = [];
  const nodeAtCell = new Map<number, string>();
  const byId = new Map<string, WaterNode>();
  const addNode = (cell: number, kind: WaterNodeKind): string => {
    const id = `wn:${cell}`;
    if (nodeAtCell.has(cell)) return nodeAtCell.get(cell)!;   // one node per cell; first kind wins
    const x = cell % W, y = (cell / W) | 0;
    const node: WaterNode = { id, kind, cell, x, y };
    nodes.push(node);
    nodeAtCell.set(cell, id);
    byId.set(id, node);
    return id;
  };

  // Downstream-terminal nodes (mouth / lake_inlet) — precedence over interior.
  const terminalKind = (i: number): WaterNodeKind | null => {
    const t = drainTo[i];
    if (t < 0) return 'mouth';                 // drains off the map edge → estuary/mouth
    if (isOcean(t)) return 'mouth';
    if (isLake(t)) return 'lake_inlet';
    return null;                               // drains into another river cell → interior
  };

  for (let i = 0; i < total; i++) {
    if (!isRiver(i)) continue;
    // Upstream identity first (a cell can be BOTH a source and a terminal in a 1-cell reach).
    if (lakeFeeds[i] && riverInDeg[i] === 0) addNode(i, 'lake_outlet');
    else if (riverInDeg[i] === 0) addNode(i, 'spring');
    else if (riverInDeg[i] >= 2) addNode(i, 'confluence');
    // Downstream terminal (mouth / inlet) — added even if the cell already became an
    // upstream node, but addNode keeps the first kind; terminal-only cells get it here.
    const tk = terminalKind(i);
    if (tk && !nodeAtCell.has(i)) addNode(i, tk);
  }

  // ── Walk reaches: from every NON-terminal node, follow drainTo to the next node. ──
  // A reach is the maximal chain of channel cells between two nodes. Springs / outlets /
  // confluences all START a downstream reach; mouths / inlets only END one.
  const reaches: WaterReach[] = [];
  const controls: Pt[][] = [];   // raw control polylines, parallel to reaches (2nd pass)
  const startsReach = (id: string): boolean => {
    const k = byId.get(id)!.kind;
    return k === 'spring' || k === 'lake_outlet' || k === 'confluence';
  };
  for (const node of nodes) {
    if (!startsReach(node.id)) continue;
    const cells: number[] = [node.cell];
    let cur = node.cell;
    let guard = 0;
    let toId: string | null = null;
    while (guard++ < total) {
      const next = drainTo[cur];
      if (next < 0 || !isRiver(next)) {            // ran off the channel without hitting a node
        toId = nodeAtCell.get(cur) ?? null;        // (cur should already be a terminal node)
        break;
      }
      cells.push(next);
      if (nodeAtCell.has(next)) { toId = nodeAtCell.get(next)!; break; }
      cur = next;
    }
    if (!toId) {
      // The chain ended at a non-node cell — make the last cell a mouth so the reach closes.
      toId = addNode(cells[cells.length - 1], 'mouth');
    }
    // Reach order = its UPSTREAM end's CHANNEL Strahler. Channel order is constant along
    // a reach and only jumps AT a confluence (the reach's downstream `to` node), so the
    // from-node cell carries the reach's own order (a confluence start already holds the
    // merged value, correct for the trunk leaving it). Flow at the downstream end gives
    // the channel's volume for width.
    const order = chOrder[node.cell];
    const flow = flowField[cells[cells.length - 1]] ?? 0;
    const flowUp = flowField[cells[0]] ?? flow;
    const control: Pt[] = cells.map((c) => ({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 }));
    controls.push(control);
    reaches.push({
      id: `wr:${node.cell}-${cells[cells.length - 1]}`,
      from: node.id,
      to: toId,
      cells,
      order,
      flow,
      flowUp,
      klass: classifyReach(order, flow, threshold),
      lakeFed: node.kind === 'lake_outlet',
      centerline: [],   // filled in the 2nd pass once refFlow (min reach flow) is known
    });
  }

  // ── Second pass: meander each centerline. Meander SIZING needs the per-world
  // reference flow (min reach flow ⇒ hydraulic width via √Q) and each reach's down-
  // valley slope (gradient gate + sinuosity), neither of which is known until every
  // reach exists — hence a second pass over the finished `reaches`. Deterministic. ──
  let minFlow = Infinity;
  for (const r of reaches) if (r.flow < minFlow) minFlow = r.flow;
  const refFlowLocal = Number.isFinite(minFlow) && minFlow > 0 ? minFlow : 1;  // === referenceFlow()
  for (let ri = 0; ri < reaches.length; ri++) {
    const reach = reaches[ri];
    const ctrl = controls[ri];
    const sx = reach.cells[0] % W, sy = (reach.cells[0] / W) | 0;
    const slope = reachValleySlope(reach.cells, hydro.surfaceW, W);
    const half = halfWidthFromFlow(reach.flow, refFlowLocal);
    let reachLen = 0;
    for (let k = 1; k < ctrl.length; k++) reachLen += Math.hypot(ctrl[k].x - ctrl[k - 1].x, ctrl[k].y - ctrl[k - 1].y);
    reach.centerline = smoothCenterline(ctrl, CENTERLINE_SPACING,
      reachMeander(reach.flow, half, slope, reachLen, sx, sy));
  }

  const lakes = detectLakeBodies(hydro, W, H, nodeAtCell);
  return { nodes, reaches, lakes, byId, nodeAtCell, width: W, height: H };
}

/**
 * The cells a water feature DIRECTLY occupies (its own reach/lake cells) and the
 * cells it INDIRECTLY affects (everything downstream — what its water feeds), as
 * row-major grid indices. Powers selection highlighting: "this is the water, and
 * this is what it carries on into." A lake's direct cells are its body and its
 * indirect cells are its outlet drainage; a junction's direct cells are the
 * reaches touching it. Downstream is followed by chasing reaches that LEAVE a
 * node (`from === node`) to the sea, cycle-guarded. Pure.
 */
export function affectedWaterCells(net: WaterNetwork, id: string): { direct: number[]; indirect: number[] } {
  const direct = new Set<number>();
  const indirect = new Set<number>();
  const startNodes: string[] = [];
  const lake = net.lakes.find((l) => l.id === id);
  if (lake) {
    for (const c of lake.cells) direct.add(c);
    startNodes.push(...lake.outletIds);
  } else if (net.byId.has(id)) {
    for (const r of net.reaches) {
      if (r.from === id || r.to === id) for (const c of r.cells) direct.add(c);
    }
    startNodes.push(id);
  } else {
    return { direct: [], indirect: [] };
  }
  const seen = new Set<string>();
  const queue = [...startNodes];
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const r of net.reaches) {
      if (r.from !== n) continue;
      for (const c of r.cells) if (!direct.has(c)) indirect.add(c);
      queue.push(r.to);
    }
  }
  return { direct: [...direct], indirect: [...indirect] };
}

/** Quick tally for studio / debug — counts by node kind and reach class. Pure. */
export function summarizeNetwork(net: WaterNetwork): {
  nodes: Record<WaterNodeKind, number>;
  reaches: Record<ReachClass, number>;
  lakes: Record<LakeClass, number>;
  lakeFedReaches: number;
  totalReaches: number;
  totalNodes: number;
  totalLakes: number;
} {
  const nodes: Record<WaterNodeKind, number> = {
    spring: 0, lake_outlet: 0, confluence: 0, lake_inlet: 0, mouth: 0,
  };
  const reaches: Record<ReachClass, number> = { brook: 0, stream: 0, river: 0, major_river: 0 };
  const lakes: Record<LakeClass, number> = { tarn: 0, pond: 0, lake: 0, mere: 0 };
  for (const n of net.nodes) nodes[n.kind]++;
  let lakeFed = 0;
  for (const r of net.reaches) { reaches[r.klass]++; if (r.lakeFed) lakeFed++; }
  for (const l of net.lakes) lakes[l.klass]++;
  return {
    nodes, reaches, lakes,
    lakeFedReaches: lakeFed,
    totalReaches: net.reaches.length,
    totalNodes: net.nodes.length,
    totalLakes: net.lakes.length,
  };
}
