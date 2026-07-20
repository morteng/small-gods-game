import { describe, it, expect } from 'vitest';
import { dustBandAll } from '@/world/brushes/vegetation-placer';

// The bare-ground cull strengths derive from the flora DB's moisture ecology — ONE rule
// for every brush, not per-brush hand lists. Dry species and non-flora kinds are omitted
// on purpose: painted dust/scree is their habitat.

describe('dustBandAll — species-moisture derived bare-ground cull strengths', () => {
  it('wet species never root in painted dust (strength 1)', () => {
    expect(dustBandAll([['common-reed', 1]])).toEqual({ 'common-reed': 1 });
  });

  it('mesic species nearly never (strength 0.9 — a little edge tolerance)', () => {
    const band = dustBandAll([['english-oak', 1], ['oxeye-daisy', 1]]);
    expect(band['english-oak']).toBe(0.9);
    expect(band['oxeye-daisy']).toBe(0.9);
  });

  it('dry species are omitted — dust is their home ground', () => {
    expect(dustBandAll([['gorse', 1], ['common-juniper', 1]])).toEqual({});
  });

  it('non-flora kinds (stone, debris) are omitted — scree is where loose stone belongs', () => {
    expect(dustBandAll([['field-stone', 1], ['boulder', 1], ['rock_pile', 1]])).toEqual({});
  });
});
