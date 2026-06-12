import { describe, it, expect } from 'vitest';
import { DEFAULT_LIGHTING, LIGHTING_OFF, DEFAULT_SUN_DIR, normalizeVec3 } from '@/render/lighting-state';
import { LIT_VERTEX, LIT_FRAGMENT, litUniformValues, litUniformGroup } from '@/render/pixi/lit-shader';

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

describe('lit shader contract', () => {
  it('vertex shader follows the pixi v8 mesh conventions', () => {
    // These uniform names are bound by pixi's MeshPipe (groups 100/101) — the
    // shader only works if it declares exactly these.
    for (const u of ['uProjectionMatrix', 'uWorldTransformMatrix', 'uTransformMatrix', 'aPosition', 'aUV']) {
      expect(LIT_VERTEX).toContain(u);
    }
  });

  it('fragment shader samples all three maps and bands the diffuse term', () => {
    for (const u of ['uAlbedo', 'uNormalMap', 'uMaterialMap', 'uSunDir', 'uAmbient', 'uSunColor', 'uBands']) {
      expect(LIT_FRAGMENT).toContain(u);
    }
    expect(LIT_FRAGMENT).toMatch(/floor\(.*uBands.*\)/); // quantization
    expect(LIT_FRAGMENT).toContain('nrm.a > 0.5');       // silhouette-alpha guard
  });

  it('litUniformValues mirrors the lighting state and clamps bands to ≥1', () => {
    const v = litUniformValues({ enabled: true, ambient: [0.1, 0.2, 0.3], sunDir: [0, 1, 0], sunColor: [1, 0.5, 0], bands: 0 });
    expect(v.uAmbient).toEqual([0.1, 0.2, 0.3]);
    expect(v.uSunDir).toEqual([0, 1, 0]);
    expect(v.uSunColor).toEqual([1, 0.5, 0]);
    expect(v.uBands).toBe(1);
  });

  it('litUniformGroup declares GPU types for every uniform', () => {
    const g = litUniformGroup(DEFAULT_LIGHTING);
    expect(g.uAmbient.type).toBe('vec3<f32>');
    expect(g.uSunDir.type).toBe('vec3<f32>');
    expect(g.uSunColor.type).toBe('vec3<f32>');
    expect(g.uBands.type).toBe('f32');
  });
});
