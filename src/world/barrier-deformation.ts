// src/world/barrier-deformation.ts
//
// Walls → terrain BENCH (terraced foundation footing). Like roads, rivers and building pads,
// a defensive wall is "a thing to the terrain": a long curtain crossing a slope wants a level
// footing under each stretch so its lit chunks sit FLUSH on the ground instead of floating on
// the downhill side / burying on the uphill one (the wall render places each canonical piece
// at one foot-z, so a single sprite can't follow a grade within itself).
//
// The footing is TERRACED PER RENDER PIECE, not per arbitrary span: each edge of the run is
// ONE `level` deformation whose `targetAt` returns a piecewise-constant bench height per
// canonical piece slot (2 tiles cardinal / √2 diagonal — the SAME grid the render cutter
// `chunkBarrierRun` cuts, phase-0 aligned to the edge start). Every wall piece therefore lands
// wholly on its own level bench: the sprite's foot-z lift equals the ground under its entire
// length, and where the wall steps down a slope the GROUND steps with it — a terraced
// foundation, the way a real curtain is actually built. Full strength (peak 1) under the
// curtain line, feathered out sideways so the bench shoulders into the natural ground.
// On the flat POI sites where settlements actually sit the local mean ≈ the ground, so the
// bench is near-zero — the effect only shows where a wall genuinely crosses a slope.
//
// Determinism & save-safety: foundations derive from `map.barrierRuns` (the runs worldgen
// committed, persisted verbatim on the map), NOT from live World entities — so the composed
// heightfield stays a PURE function of `map` and re-derives identically on load. Reads BASE
// height (not the composed field) for each target, so a footing never feeds back on itself.

import type { GameMap } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';
import { polylineDeformation, type Deformation } from '@/world/terrain-deformation';
import { heightMetresAt } from '@/world/heightfield';

/** Canonical render piece lengths (tiles) — MUST match the cutter's CARDINAL_CUT / DIAG_CUT
 *  (`render/parametric-barrier-source.ts`), so each composed piece sits on one bench. */
const CARDINAL_CUT = 2;
const DIAG_CUT = Math.SQRT2;
/** Bench length for a legacy free-angle edge (no canonical piece grid to align to). */
const FREE_SPAN = 4;
/** Taper from the levelled footing back to untouched terrain, in tiles. A touch wider than
 *  the wall is thick so a footing scarp blends gently into the ground rather than
 *  reading as a cliff at the edge; still under the building pad's 1.5 so it stays local. */
const FEATHER = 1.2;
/** Bench STRENGTH under the curtain line: full — the piece's foot-z lift samples the composed
 *  ground here, so anything less than flush leaves the sprite floating by the residual. */
const PEAK = 1.0;
/** Foundations level BELOW pads (25), roads (30) and rivers (40): a road through a gate, or a
 *  river the wall meets, still rules its own corridor. */
const PRIORITY = 20;

/** Only substantial barriers get a carved footing. A hedge / light fence / barricade follows
 *  the ground naturally (and carving under foliage or a paling reads wrong); a masonry wall,
 *  palisade or rampart wants a level footing so its chunks don't float on a slope. */
function carvesFoundation(run: BarrierRun): boolean {
  return run.kind === 'wall' || run.kind === 'palisade' || run.kind === 'rampart';
}

/** Mean BASE elevation (metres) over a slot, sampled at its endpoints + midpoint. */
function meanBase(map: GameMap, ax: number, ay: number, bx: number, by: number): number {
  return (
    heightMetresAt(map, ax, ay)
    + heightMetresAt(map, (ax + bx) / 2, (ay + by) / 2)
    + heightMetresAt(map, bx, by)
  ) / 3;
}

/** The bench (= render piece) length for an edge bearing: 2 on an axis, √2 on a true
 *  diagonal, a 4-tile span on a legacy free-angle edge. Mirrors the cutter's edge classes. */
function slotLenOf(dx: number, dy: number): number {
  const L = Math.hypot(dx, dy) || 1;
  const ux = Math.abs(dx) / L, uy = Math.abs(dy) / L;
  if (ux < 1e-3 || uy < 1e-3) return CARDINAL_CUT;
  if (Math.abs(ux - uy) < 1e-3) return DIAG_CUT;
  return FREE_SPAN;
}

/**
 * Pure: a map → the foundation-footing deformations its walls imply (one `level` brush per
 * EDGE of every substantial barrier, whose `targetAt` benches each canonical piece slot at
 * its local mean base height). Empty when the map has no carved barriers.
 */
export function buildBarrierDeformations(map: GameMap): Deformation[] {
  const runs = map.barrierRuns;
  if (!runs || runs.length === 0) return [];
  const out: Deformation[] = [];
  for (const { id, run } of runs) {
    if (!carvesFoundation(run) || run.path.length < 2) continue;
    const halfWidth = Math.max(0.6, run.thickness / 2 + 0.4);
    let cumStart = 0;
    for (let i = 1; i < run.path.length; i++) {
      const [ax, ay] = run.path[i - 1], [bx, by] = run.path[i];
      const L = Math.hypot(bx - ax, by - ay);
      if (L <= 1e-6) continue;
      const cum = cumStart;
      cumStart += L;
      const ux = (bx - ax) / L, uy = (by - ay) / L;
      const slot = slotLenOf(bx - ax, by - ay);
      // Bench height per piece slot, phase-0 aligned to the edge start (the cutter's phase).
      const nSlots = Math.max(1, Math.ceil(L / slot - 1e-6));
      const targets: number[] = [];
      for (let k = 0; k < nSlots; k++) {
        const s0 = k * slot, s1 = Math.min((k + 1) * slot, L);
        targets.push(meanBase(map, ax + ux * s0, ay + uy * s0, ax + ux * s1, ay + uy * s1));
      }
      // ONE terrace per gatehouse: a real gate's opening can span two piece slots — merge
      // their benches to the mean so the whole gate assembly (which lifts from ONE shared
      // foot inside the opening, see chunkBarrierRun) sits flush across the full passage.
      // Snap math mirrors the render cutter's slot grid (half-open centre ownership).
      if (slot !== FREE_SPAN) {
        const gateSlotLen = slot === DIAG_CUT ? 2 * slot : slot;
        for (const g of run.gates) {
          if (g.kind === 'gap') continue;
          const owns = g.t >= cum - 1e-6 && (g.t < cum + L - 1e-6 || i === run.path.length - 1);
          if (!owns) continue;
          const gw = Math.max(1, Math.min(2, Math.round((g.width || gateSlotLen) / gateSlotLen)));
          const W = gw * gateSlotLen;
          if (W > L + 1e-6) continue;
          const nPO = Math.max(1, Math.round(W / slot));
          const startIdx = Math.max(0, Math.min(nSlots - nPO, Math.round((g.t - cum - W / 2) / slot)));
          let sum = 0;
          for (let k = 0; k < nPO; k++) sum += targets[startIdx + k];
          for (let k = 0; k < nPO; k++) targets[startIdx + k] = sum / nPO;
        }
      }
      const d = polylineDeformation({
        id: `wall:${id}:${i - 1}`,
        source: 'wall:foundation',
        points: [{ x: ax, y: ay }, { x: bx, y: by }],
        halfWidth,
        amount: 0,
        op: 'level',
        target: targets[0],
        feather: FEATHER,
        peak: PEAK,
        priority: PRIORITY,
      });
      // Piecewise-constant bench: project the tile onto the edge, pick its slot's target.
      // RAMP-TUCK at bench boundaries: the heightfield interpolates the step between two
      // benches across the boundary tile — a tile ramping DOWN from a piece's bench would
      // open daylight under that piece's end (sprites paint over terrain, so no buried
      // skirt can hide it). A boundary tile therefore takes the HIGHER of the benches
      // within half a tile, tucking the ramp under the uphill piece's end instead: the
      // downhill piece's end buries a step (natural terracing), daylight never shows.
      const slotAt = (s: number): number =>
        Math.min(nSlots - 1, Math.max(0, Math.floor(s / slot + 1e-6)));
      d.targetAt = (tx: number, ty: number): number => {
        const s = Math.min(Math.max((tx - ax) * ux + (ty - ay) * uy, 0), L);
        return Math.max(targets[slotAt(s)], targets[slotAt(s - 0.55)], targets[slotAt(s + 0.55)]);
      };
      out.push(d);
    }
  }
  return out;
}

/** Count of carved barriers — a cheap signature for the deformation cache key so footings
 *  invalidate if the persisted barrier set changes. */
export function barrierFoundationCount(map: GameMap): number {
  return (map.barrierRuns ?? []).reduce((n, b) => n + (carvesFoundation(b.run) ? 1 : 0), 0);
}
