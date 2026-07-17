import { describe, it, expect } from 'vitest';
import { gradeEnvelope } from '@/world/road-state';
import { walkRoad } from '@/terrain/road-walker';
import type { Tile, TerrainField } from '@/core/types';
import type { RoadClass } from '@/world/road-graph';

// ── G1: per-class grade envelope ────────────────────────────────────────────────────

describe('gradeEnvelope — the per-class steepness model', () => {
  it('is monotonic: gentler class ⇒ lower max grade, higher avoidance penalty', () => {
    const hw = gradeEnvelope('highway');
    const rd = gradeEnvelope('road');
    const tk = gradeEnvelope('track');
    const pa = gradeEnvelope('path');

    // A highway tolerates the LEAST grade; a footpath the most.
    expect(hw.maxGrade).toBeLessThan(rd.maxGrade);
    expect(rd.maxGrade).toBeLessThan(tk.maxGrade);
    expect(tk.maxGrade).toBeLessThan(pa.maxGrade);

    // And avoids steepness the HARDEST (highest over-grade penalty).
    expect(hw.overGradePenalty).toBeGreaterThan(rd.overGradePenalty);
    expect(rd.overGradePenalty).toBeGreaterThan(tk.overGradePenalty);
    expect(tk.overGradePenalty).toBeGreaterThan(pa.overGradePenalty);
  });

  it("expresses the envelope in PHYSICAL grade: 'road' tolerates a 12 % rise/run", () => {
    // Metre-true model (road A*/drawing fix round): units are rise/run, no longer
    // normalised-elevation-per-tile (which meant 84–264 % physical at default relief —
    // the over-grade penalty was dead code). Real-world-flavoured ladder: 8/12/18/25 %.
    expect(gradeEnvelope('highway').maxGrade).toBe(0.08);
    expect(gradeEnvelope('road').maxGrade).toBe(0.12);
    expect(gradeEnvelope('track').maxGrade).toBe(0.18);
    expect(gradeEnvelope('path').maxGrade).toBe(0.25);
  });
});

// An escarpment a W→E road must climb: low plateau west, high plateau east. The SAME rise
// is squeezed into a NARROW, steep band on the straight line (y=cy) and spread over a
// WIDE, gentle ramp toward the N/S edges. Total climb is identical on every route, so the
// slope cost telescopes out and the ONLY levers are the over-grade penalty (favours the
// gentle detour) and distance (favours the steep direct line) — exactly the switchback
// trade-off the per-class envelope is meant to decide.
//
// The rise is sized so the WIDE ramp climbs at ≈6 % physical grade (within the highway's
// 8 % envelope at the default 48 m relief / 2 m tiles) while the NARROW band climbs at
// ≈29 % (over every envelope) — so the highway has a legal line to find and the footpath
// has a steep shortcut it tolerates.
const ESCARPMENT_RISE = 0.024; // normalised elevation; ×48 m relief ≈ 1.15 m of climb

function escarpmentField(w: number, h: number): TerrainField {
  const elevation = new Float32Array(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    const halfBand = 1 + 4 * (Math.abs(y - cy) / cy); // ramp half-width: 1 at centre → 5 at edges
    for (let x = 0; x < w; x++) {
      const t = Math.max(0, Math.min(1, (x - (cx - halfBand)) / (2 * halfBand)));
      elevation[y * w + x] = 0.5 + ESCARPMENT_RISE * t;
    }
  }
  return { elevation, moisture: new Float32Array(w * h), temperature: new Float32Array(w * h) };
}

/** Max per-step PHYSICAL grade (rise/run) — the walker's own metre-true unit
 *  (Δnorm × 48 m relief over 2 m/tile of run; the routes here step orthogonally). */
function maxStepGrade(cells: Array<{ x: number; y: number }>, fields: TerrainField, w: number): number {
  let g = 0;
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1], b = cells[i];
    const run = Math.hypot(b.x - a.x, b.y - a.y);
    g = Math.max(g, (Math.abs(fields.elevation[b.y * w + b.x] - fields.elevation[a.y * w + a.x]) * 48) / (run * 2));
  }
  return g;
}

function grassTiles(w: number, h: number): Tile[][] {
  const rows: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    rows.push(row);
  }
  return rows;
}

describe('grade envelope steers routing — gentle classes switchback, steep classes go direct', () => {
  const W = 15, H = 13;

  function route(cls: RoadClass) {
    const tiles = grassTiles(W, H);
    const fields = escarpmentField(W, H);
    const env = gradeEnvelope(cls);
    return walkRoad({ x: 0, y: 6 }, { x: 14, y: 6 }, tiles, fields, {
      autoBridge: false, waterCost: 1e9, // no water in play; keep grade the only lever
      maxGrade: env.maxGrade, overGradePenalty: env.overGradePenalty,
    });
  }

  it('a highway takes a gentler, longer line than a footpath up the same escarpment', () => {
    const fields = escarpmentField(W, H);
    const highway = route('highway');
    const path = route('path');

    expect(highway.cells.length).toBeGreaterThan(0);
    expect(path.cells.length).toBeGreaterThan(0);

    // Same total climb on every route, so the difference is pure grade-reconciliation:
    // the footpath tolerates the steep direct band; the highway spreads the climb out.
    expect(maxStepGrade(highway.cells, fields, W)).toBeLessThan(maxStepGrade(path.cells, fields, W));
    // The highway pays for the gentler grade with a longer (detouring) route.
    expect(highway.cells.length).toBeGreaterThan(path.cells.length);
    // The envelope is an economic pressure (quadratic in the excess), not a hard cap —
    // over a small total climb the optimum can stop short of the fully-gentle ramp. The
    // honest pin is the SEPARATION: the highway's steepest step stays under half the
    // footpath's direct-band grade (~29 %), i.e. the envelope genuinely steered it.
    expect(maxStepGrade(highway.cells, fields, W)).toBeLessThan(0.5 * maxStepGrade(path.cells, fields, W));
  });
});
