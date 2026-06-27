import { describe, it, expect } from 'vitest';
import { DEFAULT_LIGHTING, LIGHTING_OFF, DEFAULT_SUN_DIR, normalizeVec3 } from '@/render/lighting-state';

describe('lighting state', () => {
  it('default sun is normalized and upper-left (left of screen, above, in front)', () => {
    const [x, y, z] = DEFAULT_SUN_DIR;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    expect(x).toBeLessThan(0);     // from the left
    expect(y).toBeGreaterThan(0);  // from above (normal-map +y = screen-up)
    expect(z).toBeGreaterThan(0);  // in front of the facade
  });

  it('defaults are enabled and gentle (ambient-dominant; peak stays near unlit)', () => {
    expect(DEFAULT_LIGHTING.enabled).toBe(true);
    expect(LIGHTING_OFF.enabled).toBe(false);
    for (let c = 0; c < 3; c++) {
      const peak = DEFAULT_LIGHTING.ambient[c] + DEFAULT_LIGHTING.sunColor[c];
      expect(DEFAULT_LIGHTING.ambient[c]).toBeGreaterThan(DEFAULT_LIGHTING.sunColor[c]);
      expect(peak).toBeGreaterThan(0.9);
      expect(peak).toBeLessThan(1.25);
    }
    expect(DEFAULT_LIGHTING.bands).toBeGreaterThanOrEqual(2);
  });

  it('normalizeVec3 handles the zero vector without NaN', () => {
    expect(normalizeVec3([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
