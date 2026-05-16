import { describe, it, expect } from 'vitest';
import { generateHydrology } from '@/terrain/hydrology';
import type { TerrainField, TerrainConfig } from '@/core/types';

describe('generateHydrology (flow accumulation)', () => {
  /**
   * 11×1 valley: two peaks at the ends, minimum in the middle.
   *   x:  0    1   2   3   4   5   6   7   8   9   10
   *   e: 0.9 0.8 0.7 0.6 0.5 0.4 0.5 0.6 0.7 0.8 0.9
   *
   * With flow accumulation, each cell starts with 1, then cascades downhill.
   * Expected flow:
   *   x=0,10: 1 (sources, peak)
   *   x=1,9:  2 (1 from peak + 1 self)
   *   x=2,8:  3
   *   x=3,7:  4
   *   x=4,6:  5
   *   x=5:    11 (gets 5 from each side + 1 self)
   */
  it('accumulates flow downhill on an 11×1 valley', () => {
    const elev = new Float32Array([0.9,0.8,0.7,0.6,0.5,0.4,0.5,0.6,0.7,0.8,0.9]);
    const fields: TerrainField = {
      elevation: elev,
      moisture: new Float32Array(11),
      temperature: new Float32Array(11),
    };
    const config: TerrainConfig = { seed: 1, width: 11, height: 1, seaLevel: 0.0 };

    const result = generateHydrology(fields, config, { riverFlowThreshold: 5 });

    // Verify flow field accumulates correctly
    expect(result.flowField[0]).toBe(1);
    expect(result.flowField[1]).toBe(2);
    expect(result.flowField[5]).toBe(11);
    expect(result.flowField[10]).toBe(1);

    // Threshold = 5: cells x=4, x=5, x=6 should be rivers (flow ≥ 5)
    expect(result.riverMask[4]).toBe(1);
    expect(result.riverMask[5]).toBe(1);
    expect(result.riverMask[6]).toBe(1);
    expect(result.riverMask[0]).toBe(0);
    expect(result.riverMask[10]).toBe(0);
  });

  it('produces sized result arrays matching width*height', () => {
    const fields: TerrainField = {
      elevation: new Float32Array(20),
      moisture: new Float32Array(20),
      temperature: new Float32Array(20),
    };
    const config: TerrainConfig = { seed: 1, width: 4, height: 5, seaLevel: 0.35 };
    const result = generateHydrology(fields, config);
    expect(result.riverMask.length).toBe(20);
    expect(result.flowField.length).toBe(20);
  });

  it('water tiles generate no rain of their own but can receive land drainage', () => {
    // 3×1 strip: land, land, water
    const elev = new Float32Array([0.9, 0.5, 0.1]);
    const fields: TerrainField = {
      elevation: elev,
      moisture: new Float32Array(3),
      temperature: new Float32Array(3),
    };
    const config: TerrainConfig = { seed: 1, width: 3, height: 1, seaLevel: 0.35 };
    const result = generateHydrology(fields, config, { riverFlowThreshold: 2 });

    // x=0 is a source (peak land cell) → flow = 1
    expect(result.flowField[0]).toBe(1);
    // x=1 (land) receives x=0's flow → 1 + 1 = 2
    expect(result.flowField[1]).toBe(2);
    // x=2 is water — generates no rain of its own, but receives x=1's flow
    // (rivers naturally flow INTO the sea). Flow = 0 (self) + 2 (from x=1) = 2.
    expect(result.flowField[2]).toBe(2);
    // Threshold = 2 → x=1 is a river (we don't mark water tiles even if their flow ≥ threshold:
    // they're already water, and the integration layer skips river overwrites of existing water).
    expect(result.riverMask[1]).toBe(1);
  });
});
