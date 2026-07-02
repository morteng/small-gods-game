// tests/unit/seed-validation.test.ts
// The schema half of the "world doctor": validateWorldSeed must catch the silent
// failure modes an authoring agent hits — typo'd POI types (silently skipped by
// poi-influence), dead fields, out-of-range sizes (silently clamped), region on a
// point-elevation type, style knobs outside `overrides`.
import { describe, it, expect } from 'vitest';
import { validateWorldSeed } from '@/core/schema';
import type { WorldSeed } from '@/core/types';

const base = (over: Partial<WorldSeed> = {}): Partial<WorldSeed> => ({
  name: 'Test',
  size: { width: 64, height: 64 },
  biome: 'temperate',
  pois: [],
  connections: [],
  ...over,
});

describe('validateWorldSeed — errors', () => {
  it('accepts a minimal valid seed with no warnings', () => {
    const v = validateWorldSeed(base());
    expect(v.valid).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it('rejects a typo’d POI type with a did-you-mean', () => {
    const v = validateWorldSeed(base({
      pois: [{ id: 'v1', type: 'vulcano', position: { x: 10, y: 10 } }],
    }));
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('did you mean "volcano"?');
  });

  it('rejects out-of-range size instead of letting the engine clamp silently', () => {
    const v = validateWorldSeed(base({ size: { width: 600, height: 64 } }));
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('silently clamp');
  });

  it('rejects a POI positioned off the map', () => {
    const v = validateWorldSeed(base({
      pois: [{ id: 'm1', type: 'mountain', position: { x: 999, y: 10 } }],
    }));
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('outside');
  });

  it('rejects an inverted region and a bad size/importance/coast enum', () => {
    const v = validateWorldSeed(base({
      pois: [{
        id: 'f1', type: 'forest',
        region: { x_min: 50, x_max: 10, y_min: 0, y_max: 20 },
        size: 'gigantic' as never, coast: 'up' as never,
      }],
    }));
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('inverted');
    expect(v.errors.join(' ')).toContain('gigantic');
    expect(v.errors.join(' ')).toContain('coast anchor');
  });

  it('rejects duplicate POI ids', () => {
    const v = validateWorldSeed(base({
      pois: [
        { id: 'a', type: 'village', position: { x: 1, y: 1 } },
        { id: 'a', type: 'village', position: { x: 2, y: 2 } },
      ],
    }));
    expect(v.errors.join(' ')).toContain('Duplicate POI id');
  });

  it('suggests a close POI id for a dangling connection', () => {
    const v = validateWorldSeed(base({
      pois: [{ id: 'oakshire', type: 'village', position: { x: 1, y: 1 } }],
      connections: [{ from: 'oakshired', to: 'oakshire', type: 'road' }],
    }));
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('did you mean "oakshire"?');
  });
});

describe('validateWorldSeed — warnings (generates, but something is dead)', () => {
  it('warns on unknown fields the engine ignores', () => {
    const v = validateWorldSeed(base({
      pois: [{ id: 'f1', type: 'forest', region: { x_min: 0, x_max: 10, y_min: 0, y_max: 10 }, density: 0.5 } as never],
    }));
    expect(v.valid).toBe(true); // still generates
    expect(v.warnings.join(' ')).toContain('unknown field "density"');
  });

  it('warns when region is authored on a point-elevation type (mountain)', () => {
    const v = validateWorldSeed(base({
      pois: [{ id: 'm1', type: 'mountain', position: { x: 10, y: 10 }, region: { x_min: 0, x_max: 30, y_min: 0, y_max: 30 } }],
    }));
    expect(v.valid).toBe(true);
    expect(v.warnings.join(' ')).toContain('region has no terrain effect');
  });

  it('warns on style knobs outside overrides (the silently-dropped footgun)', () => {
    const v = validateWorldSeed(base({ style: { mountainRelief: 80 } as never }));
    expect(v.valid).toBe(true);
    expect(v.warnings.join(' ')).toContain('style.overrides.mountainRelief');
  });

  it('warns on an unknown constraint', () => {
    const v = validateWorldSeed(base({ constraints: ['castles_everywhere'] }));
    expect(v.warnings.join(' ')).toContain('Unknown constraint');
  });
});
