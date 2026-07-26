// src/world/tactical-positions.ts
// TACTICAL POSITIONS — the one module that answers "where is it worth standing?", derived purely
// from what worldgen already committed. Phase 1 (the wall-garrison round) populates the
// circulation truth of a defensive `BarrierRun`: the wall-walk height, the mural stair's exact
// placement, and evenly-spaced `wall_station` posts along a crenellated ring — the geometry a
// garrisoning soldier climbs and stands on. Phase 2 grows the SAME `TacticalPosition` union here
// with gate chokes, tower posts, rally points and attacker approaches
// (`docs/superpowers/specs/2026-07-26-tactical-npc-behaviour-spec.md`); consumers speak positions,
// never bare coordinates. A pure leaf: no compose/render/GPU imports, only
// `BarrierRun` data + the battlement height law + the tile/metre scale contract (the sole existing
// exception for `src/sim/`, per CLAUDE.md). Importable by BOTH `src/sim/` (the garrison system
// reads it to place soldiers) and `src/render/` (the wall-source reads it to draw them) — the
// render stair element and the sim's climb point are the SAME spot by construction, never two
// independent derivations that can drift apart.
//
// The gate-framing helpers below (`classifyEdge`, `snappedGateOpening`, `gateFrameOf`, …) used to
// live in `src/render/parametric-barrier-source.ts`. They are pure `BarrierRun`/`BarrierGate` math
// with no render dependency, so they MOVED here and the render source now imports them back —
// never a duplicate copy of the derivation.
import { pathLength, pointAt, segmentIndexAt, type BarrierRun, type BarrierGate } from '@/world/barrier';
import { parapetHeight } from '@/assetgen/geometry/battlement';
import { stairFlightExtent } from '@/assetgen/geometry/stair-spec';
import { mToTiles } from '@/render/scale-contract';

type Pt = [number, number];

// ── Generic path helpers ───────────────────────────────────────────────────────────────────

const unit = (a: Pt, b: Pt): Pt => {
  const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
  return [dx / m, dy / m];
};

/** World point + along-unit direction at path distance `t`. */
function frameAt(path: Pt[], t: number): { p: Pt; dir: Pt } {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (t <= acc + len) { const u = (t - acc) / (len || 1); return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], dir: unit(a, b) }; }
    acc += len;
  }
  const a = path[path.length - 2] ?? path[0], b = path[path.length - 1];
  return { p: b, dir: unit(a, b) };
}

// ── Canonical piece grid (WP-W2) — moved from parametric-barrier-source.ts ────────────────────
// A canonical wall edge is cut into a FINITE vocabulary of pieces; `classifyEdge` decides whether
// an edge is on that grid and, if so, its cut/slot lengths. `snappedGateOpening` uses it to find
// the opening the curtain cutter ACTUALLY cuts, so gate furniture (leaf, jambs, flankers, stair)
// places against the SAME opening the curtain does — not the raw, unsnapped `gate.t`.

/** The 8 canonical unit deltas, indexed by 45° octant from +x (matches wall-connections.ts). */
export const CANONICAL_DIRS: Pt[] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
/** Cardinal render piece: 2 along-axis tiles. */
export const CARDINAL_CUT = 2;
/** Diagonal render piece: ONE (±1,±1) step = √2 tiles. */
export const DIAG_CUT = Math.SQRT2;
/** A GATE slot is a full WP-W1 gate piece: 2 tiles cardinal / 2 diagonal steps (2√2). */
export const CARDINAL_SLOT = 2;
export const DIAG_SLOT = 2 * Math.SQRT2;
/** cos(0.5°): edges whose bearing is within 0.5° of a canonical direction are cut on the grid;
 *  anything more off-axis falls to the legacy free-angle chunker. */
const CANON_DOT = Math.cos(0.5 * Math.PI / 180);

export interface EdgeClass {
  oct: number; canonical: boolean; cls: 'card' | 'diag'; reversed: boolean;
  bearing: 0 | 1 | 2 | 3; worldUnit: Pt; cutLen: number; slotLen: number;
}

/** Classify an edge delta: octant, whether it is (near-)canonical, cardinal/diagonal, and — for
 *  the OUTPUT normalization that halves the sprite set — whether it points into the back half
 *  {W,SW,S,SE} (⇒ emit reversed from the far endpoint at bearing oct%4 ∈ {E,NE,N,NW}). */
export function classifyEdge(dx: number, dy: number): EdgeClass {
  const L = Math.hypot(dx, dy) || 1;
  const oct = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  const cu = CANONICAL_DIRS[oct]; const cl = Math.hypot(cu[0], cu[1]) || 1;
  const canonical = (dx / L) * (cu[0] / cl) + (dy / L) * (cu[1] / cl) >= CANON_DOT;
  const cls = oct % 2 === 1 ? 'diag' : 'card';
  return {
    oct, canonical, cls, reversed: oct >= 4, bearing: (oct % 4) as 0 | 1 | 2 | 3,
    worldUnit: [cu[0] / cl, cu[1] / cl], cutLen: cls === 'diag' ? DIAG_CUT : CARDINAL_CUT,
    slotLen: cls === 'diag' ? DIAG_SLOT : CARDINAL_SLOT,
  };
}

/**
 * The opening the curtain cutter ACTUALLY cuts for a real gate: centre `t` (global path distance)
 * + width, snapped to the carrying edge's piece grid — the same math `chunkBarrierRun` applies.
 * Gate furniture (leaf, jamb frame, flanker towers, stair) must place against THIS opening:
 * anchored at the raw `g.t` it drifts up to a full piece off the cut passage, and the leaf hangs
 * beside its own arch (the floating-door bug). Non-canonical edges cut continuously, so the raw
 * gate comes back unchanged.
 */
export function snappedGateOpening(run: BarrierRun, g: BarrierGate): { t: number; width: number } {
  const path = run.path;
  let cum = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L <= 1e-6) continue;
    // Same HALF-OPEN ownership as chunkBarrierRun: a vertex-centred gate belongs to the edge
    // starting there (except the final edge, which keeps its end so an open-path gate resolves).
    const carries = g.t >= cum - 1e-6 && (g.t < cum + L - 1e-6 || i === path.length - 1);
    if (carries) {
      const ec = classifyEdge(b[0] - a[0], b[1] - a[1]);
      if (!ec.canonical) return { t: g.t, width: g.width };
      const tc = g.t - cum;
      const gw = Math.max(1, Math.min(2, Math.round((g.width || ec.slotLen) / ec.slotLen)));
      const W = gw * ec.slotLen;
      if (W <= L + 1e-6) {
        const nPO = Math.max(1, Math.round(W / ec.cutLen));
        const nPiecesEdge = Math.max(1, Math.round(L / ec.cutLen));
        const startIdx = Math.max(0, Math.min(nPiecesEdge - nPO, Math.round((tc - W / 2) / ec.cutLen)));
        return { t: cum + startIdx * ec.cutLen + W / 2, width: W };
      }
      return { t: g.t, width: W };
    }
    cum += L;
  }
  return { t: g.t, width: g.width };
}

/** A real GATE (road crossing) gets a gatehouse + timber leaf + a stair beside it; a GAP (the line
 *  meeting water / a building / an open waterfront) is just an opening. Missing kind ⇒ gate (legacy). */
export const isRealGate = (g: BarrierGate): boolean => g.kind !== 'gap';

/** A real gate whose opening is swallowed by a GAP span has no curtain to hang furniture on —
 *  the pieces there were dropped (water/building opening overlapping the committed gate), so a
 *  leaf/frame/tower placed anyway floats in the void (the door-over-the-river bug). Skip it. */
export function gateSwallowedByGap(run: BarrierRun, g: BarrierGate): boolean {
  const o = snappedGateOpening(run, g);
  return run.gates.some((other) =>
    other !== g && other.kind === 'gap'
    && o.t > other.t - other.width / 2 - 1e-6 && o.t < other.t + other.width / 2 + 1e-6);
}

/** The gate assembly's shared placement: snapped opening centre/width + frame + the opening-start
 *  foot vertex every element of the assembly lifts from. */
export function gateFrameOf(run: BarrierRun, g: BarrierGate): { p: Pt; dir: Pt; width: number; foot: Pt } {
  const o = snappedGateOpening(run, g);
  const { p, dir } = frameAt(run.path, o.t);
  // Half a tile INSIDE the opening — the same shared foot the gate fragments carry
  // (chunkBarrierRun's `footS`), clear of the bench-boundary ramp-tuck tile.
  const { p: foot } = frameAt(run.path, o.t - o.width / 2 + 0.55);
  return { p, dir, width: o.width, foot };
}

// ── Circulation truth (W0) ─────────────────────────────────────────────────────────────────

/** Height (tiles) of the wall-walk (allure) atop `run` — the crest minus the parapet a defender
 *  stands behind. 0 for an uncrenellated run: nothing crenellated has a protected walk to garrison
 *  (a plain wall/palisade top is not a fighting platform). ONE derivation, shared with the curtain,
 *  its towers and the mural stair — an inline copy of this formula is how a flight (or a soldier)
 *  ends up stopping short of, or overshooting, the walk it's supposed to reach. */
export function walkZOf(run: BarrierRun): number {
  if (!run.crenellated) return 0;
  return run.height - parapetHeight(run.height);
}

/** Only real defensive rings (a crenellated masonry curtain that knows its inside) get a stair. */
function stairsEnabled(run: BarrierRun): boolean {
  return !!run.crenellated && !!run.centroid && (run.material === 'stone' || run.material === 'brick');
}

/** Where the mural stair's flight foot sits, and the climb it defines: the SAME derivation the
 *  render source turns into a stone flight — gate pick (first real, non-gap-swallowed gate), the
 *  opening frame, half a tile clear of the passage + gatehouse (`off`), and the inward unit vector
 *  toward the ring centroid a climbing soldier walks along. `null` when the run has no stair
 *  (uncrenellated, no centroid, non-masonry, or no real gate to stand the flight beside). */
export function stairPlacementOf(run: BarrierRun): StairPlacement | null {
  if (!stairsEnabled(run)) return null;
  const gate = run.gates.find((g) => isRealGate(g) && !gateSwallowedByGap(run, g));   // the main (first real) gate
  if (!gate) return null;
  const c = run.centroid!;
  const walkZ = walkZOf(run);
  const { p, dir, width } = gateFrameOf(run, gate);
  const off = width / 2 + mToTiles(2.4);                    // sit clear of the passage + gatehouse
  const foot: Pt = [p[0] - dir[0] * off, p[1] - dir[1] * off];
  const inx = c[0] - foot[0], iny = c[1] - foot[1], m = Math.hypot(inx, iny) || 1;
  const inward: Pt = [inx / m, iny / m];
  return { foot, dir, inward, walkZ, t: snappedGateOpening(run, gate).t - off };
}

/** The mural stair's placement on a ring. `foot` is the flight's reference point ON the wall
 *  centreline; `t` is that point's PATH DISTANCE along `run.path` — the arc coordinate the on-wall
 *  movement track is parameterised by, so a soldier stepping off the flight knows where on the
 *  polyline it has landed (exact wherever the flight sits on the gate's own leg, which is by
 *  construction — `off` is a couple of tiles). */
export interface StairPlacement { foot: Pt; dir: Pt; inward: Pt; walkZ: number; t: number }

/** The parametric CLIMB the mural stair defines: the ground point at the flight's bottom step, the
 *  wall-walk point at its top, and the arc coordinate that top sits at. A garrisoning soldier walks
 *  the ground to `bottom`, slides `bottom → top` while its height rises `0 → walkZ`, and steps onto
 *  the allure at path distance `topT`. Derived from `stairFlightExtent` — the same envelope the
 *  drawn flight is emitted from, never a parallel guess at where the steps are. `null` whenever
 *  `stairPlacementOf` is (no stair ⇒ no way onto the wall ⇒ no garrison). */
export function stairClimbOf(run: BarrierRun): { bottom: Pt; top: Pt; walkZ: number; topT: number } | null {
  const placement = stairPlacementOf(run);
  if (!placement) return null;
  const { foot, inward, walkZ, t } = placement;
  const { topInset, runIn } = stairFlightExtent(walkZ, run.thickness);
  return {
    bottom: [foot[0] + inward[0] * runIn, foot[1] + inward[1] * runIn],
    top: [foot[0] + inward[0] * topInset, foot[1] + inward[1] * topInset],
    walkZ,
    topT: t,
  };
}

/** Default spacing (tiles) between patrol stations — a soldier every ~2 tiles along the allure. */
const DEFAULT_STATION_SPACING = 2;

/**
 * A place worth standing, derived deterministically from what worldgen already committed.
 * DISCRIMINATED on `kind` and deliberately OPEN: phase 2 of the tactical-behaviour track
 * (`docs/superpowers/specs/2026-07-26-tactical-npc-behaviour-spec.md`) grows this same union in
 * this same module with `'gate_choke'` (the snapped opening's inside face), `'tower_post'` (tower
 * crowns, from `TowerPlacement`), `'rally'` (where civilians shelter) and `'approach'` (the
 * outside positions an attacker wants, on `defends === 'open'` legs only). Everything downstream
 * speaks tactical positions, not bare coordinates — so adding a kind widens what a consumer can
 * be handed without changing its shape.
 */
export type TacticalPosition = WallStationPosition;

/** The `'wall_station'` arm: an allure post between the merlons of a crenellated ring. */
export interface WallStationPosition {
  kind: 'wall_station';
  x: number; y: number; walkZ: number;
  /** Unit vector pointing away from the ring centroid — the direction a stationed defender faces
   *  (out over the field), and the "outward" the render lift uses to seat a soldier's foot inside
   *  the allure rather than atop a merlon. */
  outward: Pt;
  /** Index into `run.path` of the leg (`path[segIdx] → path[segIdx + 1]`) the station sits on. */
  segIdx: number;
  /** PATH DISTANCE (tiles) of the station along `run.path` — the arc coordinate the on-wall
   *  movement track is parameterised by (`arcLengthPoint(run, t)` returns exactly `{x, y}`).
   *  Carried here so a consumer never has to re-derive the spacing walk (and drift out of step
   *  with which spans got skipped) just to know how far along the allure a post is. */
  t: number;
}

/** Ordered patrol stations along a crenellated ring's wall-walk, at ~`spacing` tiles apart.
 *  Gate/gap spans are skipped (nothing to stand on over an open passage); an uncrenellated run —
 *  or one with no ring centroid (no notion of "outward" without an inside to defend) — yields no
 *  stations. Deterministic: walks the path once, allocates one array. */
export function wallStations(run: BarrierRun, spacing: number = DEFAULT_STATION_SPACING): WallStationPosition[] {
  if (!run.crenellated || !run.centroid || !run.path || run.path.length < 2 || spacing <= 0) return [];
  const c = run.centroid;
  const walkZ = walkZOf(run);
  const total = pathLength(run.path);
  const out: WallStationPosition[] = [];
  for (let t = spacing / 2; t < total; t += spacing) {
    const inSpan = run.gates.some((g) => t > g.t - g.width / 2 - 1e-6 && t < g.t + g.width / 2 + 1e-6);
    if (inSpan) continue;
    const { p, dir } = frameAt(run.path, t);
    const perp: Pt = [-dir[1], dir[0]];
    const dot = perp[0] * (p[0] - c[0]) + perp[1] * (p[1] - c[1]);
    const sign = dot >= 0 ? 1 : -1;
    const outward: Pt = [perp[0] * sign, perp[1] * sign];
    out.push({ kind: 'wall_station', x: p[0], y: p[1], walkZ, outward, segIdx: segmentIndexAt(run.path, t), t });
  }
  return out;
}

/** World position (tiles) at path-distance `t` along `run` — the on-wall movement track a
 *  garrisoning soldier walks (climb → walk → station), reusing the SAME polyline interpolation
 *  every other placement (gates, towers, stations) already shares. */
export function arcLengthPoint(run: BarrierRun, t: number): Pt {
  return pointAt(run.path, t);
}
