import { describe, it, expect } from 'vitest';
import { generateHydrology } from '@/terrain/hydrology';
import { WaterType, type TerrainField, type TerrainConfig } from '@/core/types';

/** Build a TerrainField from a flat elevation array (moisture/temperature unused here). */
function field(elev: number[]): TerrainField {
  return {
    elevation: new Float32Array(elev),
    moisture: new Float32Array(elev.length),
    temperature: new Float32Array(elev.length),
  };
}

describe('Water S0 — hydrology data model', () => {
  it('1 · leaves riverMask / flowField unchanged (backward compat)', () => {
    // The documented 11×1 valley from hydrology.test.ts.
    const elev = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const r = generateHydrology(field(elev), { seed: 1, width: 11, height: 1, seaLevel: 0.0 }, { riverFlowThreshold: 5 });
    expect(r.flowField[5]).toBe(11);
    expect(Array.from(r.riverMask)).toEqual([0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0]);
  });

  it('2 · classifies a closed inland basin as a lake at its spill height, with no flow vector', () => {
    // 5×5 plain at 0.6 with a sunk centre cell — pit-fill raises it to the rim.
    const w = 5, h = 5;
    const elev = new Array(w * h).fill(0.6);
    const C = 2 * w + 2; // (2,2)
    elev[C] = 0.2;
    const r = generateHydrology(field(elev), { seed: 1, width: w, height: h, seaLevel: 0.1 });
    expect(r.waterType[C]).toBe(WaterType.Lake);
    expect(r.waterMask[C]).toBe(1);
    expect(r.surfaceW[C]).toBeGreaterThan(0.5);  // ≈ rim height 0.6
    expect(r.surfaceW[C]).toBeLessThan(0.62);
    expect(r.flowDirX[C]).toBe(0);               // still water → no flow vector
    expect(r.flowDirY[C]).toBe(0);
    // A dry plain cell carries the −1 surface sentinel.
    expect(r.surfaceW[0]).toBe(-1);
    expect(r.waterType[0]).toBe(WaterType.Dry);
  });

  it('3 · ocean = border-connected sub-sea; an enclosed sub-sea pit stays a lake', () => {
    // 7×3, everything 0.8; left two columns sink below sea (ocean, border-connected);
    // a lone sub-sea pit at (5,1) is walled in by 0.8 on every side → lake.
    const w = 7, h = 3;
    const elev = new Array(w * h).fill(0.8);
    const at = (x: number, y: number) => y * w + x;
    for (let y = 0; y < h; y++) { elev[at(0, y)] = 0.1; elev[at(1, y)] = 0.2; }
    elev[at(5, 1)] = 0.1;
    const r = generateHydrology(field(elev), { seed: 1, width: w, height: h, seaLevel: 0.35 });
    expect(r.waterType[at(0, 1)]).toBe(WaterType.Ocean);
    expect(r.waterType[at(1, 1)]).toBe(WaterType.Ocean);
    expect(r.surfaceW[at(0, 1)]).toBeCloseTo(0.35, 5); // ocean rides sea level
    expect(r.waterType[at(5, 1)]).toBe(WaterType.Lake); // NOT ocean — enclosed
  });

  it('4 · flow vector points downhill and the drainTo chain reaches an outlet', () => {
    const elev = [0.9, 0.7, 0.5, 0.3, 0.1]; // 5×1 ramp descending in +x
    const r = generateHydrology(field(elev), { seed: 1, width: 5, height: 1, seaLevel: 0.0 }, { riverFlowThreshold: 3 });
    // x=2 is a river cell draining to x=3 (lower) → +x unit vector.
    expect(r.waterType[2]).toBe(WaterType.River);
    expect(r.flowDirX[2]).toBe(1);
    expect(r.flowDirY[2]).toBe(0);
    // Walk drainTo from the peak; it must terminate at an outlet (−1) in ≤ N steps.
    let i = 0, steps = 0;
    while (r.drainTo[i] >= 0 && steps < 10) { i = r.drainTo[i]; steps++; }
    expect(r.drainTo[i]).toBe(-1);
    expect(i).toBe(4); // the lowest cell is the outlet
  });

  // Y-confluence: two equal tributaries merge at (1,1) → Strahler order 2.
  //   y0:  0.9  1.0  0.9   (sources at corners; centre is a wall)
  //   y1:  0.5  0.4  0.5
  //   y2:  1.0  0.1  1.0   (outlet at (1,2))
  const CONFLUENCE = [0.9, 1.0, 0.9, 0.5, 0.4, 0.5, 1.0, 0.1, 1.0];

  it('5 · Strahler increments at a confluence and never decreases downstream', () => {
    const r = generateHydrology(field(CONFLUENCE), { seed: 1, width: 3, height: 3, seaLevel: 0.0 }, { riverFlowThreshold: 2 });
    const at = (x: number, y: number) => y * 3 + x;
    expect(r.strahler[at(1, 1)]).toBe(2);                 // two order-1 tributaries merge
    expect(r.strahler[at(1, 2)]).toBeGreaterThanOrEqual(r.strahler[at(1, 1)]); // monotonic
  });

  it('6 · width derives from Strahler so S1 can split ribbon (order 1) from carve (order ≥ 2)', () => {
    const r = generateHydrology(field(CONFLUENCE), { seed: 1, width: 3, height: 3, seaLevel: 0.0 }, { riverFlowThreshold: 2 });
    const widths = Array.from(r.width).filter((_, i) => r.waterType[i] === WaterType.River);
    expect(widths.some((wd) => wd > 0 && wd < 1)).toBe(true);   // a headwater stream (0.5) → ribbon
    expect(widths.some((wd) => wd >= 1)).toBe(true);            // a trunk (≥1.0) → carve+fill
  });

  it('7 · is deterministic (same field ⇒ byte-identical arrays)', () => {
    const elev = Array.from({ length: 12 * 9 }, (_, i) => ((i * 2654435761) % 1000) / 1000);
    const cfg: TerrainConfig = { seed: 1, width: 12, height: 9, seaLevel: 0.35 };
    const a = generateHydrology(field(elev), cfg);
    const b = generateHydrology(field(elev), cfg);
    for (const k of ['drainTo', 'surfaceW', 'waterMask', 'waterType', 'flowDirX', 'flowDirY', 'strahler', 'width'] as const) {
      expect(Array.from(a[k])).toEqual(Array.from(b[k]));
    }
  });
});
