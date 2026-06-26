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

  it("holds 'road' at the walker's prior global default (0.05) so the commonest class is unchanged", () => {
    expect(gradeEnvelope('road').maxGrade).toBe(0.05);
  });
});

// An escarpment a W→E road must climb: low plateau west (0.5), high plateau east (0.8).
// The SAME 0.3 rise is squeezed into a NARROW, steep band on the straight line (y=cy) and
// spread over a WIDE, gentle ramp toward the N/S edges. Total climb is identical on every
// route, so the slope cost telescopes out and the ONLY levers are the over-grade penalty
// (favours the gentle detour) and distance (favours the steep direct line) — exactly the
// switchback trade-off the per-class envelope is meant to decide.
function escarpmentField(w: number, h: number): TerrainField {
  const elevation = new Float32Array(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    const halfBand = 1 + 4 * (Math.abs(y - cy) / cy); // ramp half-width: 1 at centre → 5 at edges
    for (let x = 0; x < w; x++) {
      const t = Math.max(0, Math.min(1, (x - (cx - halfBand)) / (2 * halfBand)));
      elevation[y * w + x] = 0.5 + 0.3 * t;
    }
  }
  return { elevation, moisture: new Float32Array(w * h), temperature: new Float32Array(w * h) };
}

function maxStepGrade(cells: Array<{ x: number; y: number }>, fields: TerrainField, w: number): number {
  let g = 0;
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1], b = cells[i];
    g = Math.max(g, Math.abs(fields.elevation[b.y * w + b.x] - fields.elevation[a.y * w + a.x]));
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
    // And it actually keeps within its own envelope here.
    expect(maxStepGrade(highway.cells, fields, W)).toBeLessThanOrEqual(gradeEnvelope('highway').maxGrade + 1e-6);
  });
});
