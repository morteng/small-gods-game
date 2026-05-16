import { describe, it, expect } from 'vitest';
import { findPeaks } from '@/terrain/hydrology';
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
