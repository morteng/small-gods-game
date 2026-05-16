import { describe, it, expect } from 'vitest';
import { findPeaks, walkDownhill } from '@/terrain/hydrology';
import type { TerrainField, TerrainConfig } from '@/core/types';

/**
 * Build a 5×5 terrain field where elevation is a single peak at (2,2).
 *   row 0: 0.0 0.0 0.0 0.0 0.0
 *   row 1: 0.0 0.45 0.45 0.45 0.0
 *   row 2: 0.0 0.45 0.9 0.45 0.0
 *   row 3: 0.0 0.45 0.45 0.45 0.0
 *   row 4: 0.0 0.0 0.0 0.0 0.0
 */
function singlePeakField(): { fields: TerrainField; config: TerrainConfig } {
  const width = 5, height = 5;
  const elev = new Float32Array(width * height);
  const center = 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = Math.abs(x - center), dy = Math.abs(y - center);
      const d = Math.max(dx, dy);
      elev[y * width + x] = d === 0 ? 0.9 : d === 1 ? 0.45 : 0.0;
    }
  }
  const moisture = new Float32Array(width * height).fill(0.5);
  const temperature = new Float32Array(width * height).fill(0.5);
  const config: TerrainConfig = {
    seed: 1, width, height, seaLevel: 0.35,
  };
  return { fields: { elevation: elev, moisture, temperature }, config };
}

describe('findPeaks', () => {
  it('finds a single peak with elevation 0.9', () => {
    const { fields, config } = singlePeakField();
    const peaks = findPeaks(fields, config, { peakThreshold: 0.7 });
    expect(peaks.length).toBe(1);
    expect(peaks[0]).toEqual({ x: 2, y: 2 });
  });

  it('returns empty array when no cell exceeds peakThreshold', () => {
    const { fields, config } = singlePeakField();
    const peaks = findPeaks(fields, config, { peakThreshold: 0.95 });
    expect(peaks).toEqual([]);
  });
});

describe('walkDownhill', () => {
  /**
   * 5×1 strip with descending elevation: 0.9 0.7 0.5 0.3 0.1
   * Sea level = 0.35 → cell at index 4 (0.1) is water, and so is index 3 (0.3).
   * Walking from x=0 should step through 1, 2, then stop at index 3 (water).
   * Resulting path: [(0,0), (1,0), (2,0), (3,0)] — the final cell IS water,
   * which is where the walker stopped. Implementations may equivalently stop
   * BEFORE entering water; pick one and match the test below.
   */
  function descendingStrip(): { fields: TerrainField; config: TerrainConfig } {
    const elev = new Float32Array([0.9, 0.7, 0.5, 0.3, 0.1]);
    return {
      fields: {
        elevation: elev,
        moisture: new Float32Array(5),
        temperature: new Float32Array(5),
      },
      config: { seed: 1, width: 5, height: 1, seaLevel: 0.35 },
    };
  }

  it('walks downhill from a peak and stops at water', () => {
    const { fields, config } = descendingStrip();
    const path = walkDownhill(0, 0, fields, config);
    // Algorithm starts at (0,0), checks elevation, steps to lowest neighbor each time.
    // Stops once the CURRENT cell is below seaLevel (so the path includes the entry
    // into water). Index 3 is the first water cell (0.3 < 0.35).
    expect(path).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    ]);
  });

  it('returns just the start cell when no lower neighbor exists (local minimum)', () => {
    const elev = new Float32Array([0.5, 0.5, 0.5]); // perfectly flat
    const fields: TerrainField = {
      elevation: elev,
      moisture: new Float32Array(3),
      temperature: new Float32Array(3),
    };
    const config: TerrainConfig = { seed: 1, width: 3, height: 1, seaLevel: 0.1 };
    const path = walkDownhill(1, 0, fields, config);
    expect(path).toEqual([{ x: 1, y: 0 }]);
  });

  it('stops at map edge if no water is reached', () => {
    const elev = new Float32Array([0.9, 0.5, 0.4]);
    const fields: TerrainField = {
      elevation: elev,
      moisture: new Float32Array(3),
      temperature: new Float32Array(3),
    };
    const config: TerrainConfig = { seed: 1, width: 3, height: 1, seaLevel: 0.1 };
    const path = walkDownhill(0, 0, fields, config);
    expect(path).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
  });
});
