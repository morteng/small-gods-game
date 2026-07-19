import { describe, it, expect } from 'vitest';
import { isSnowBuriedRockKind, isRockKind } from '@/world/entity-kinds';

// The draw list hides these entirely once the ground paints predominantly white
// (GROUND_COVER_SNOW_HIDE in entity-draw-list.ts): a knee-high grey lump on a
// snowfield, even whitened, reads as dropped ON the snow (user report). SIZE-
// KEYED (NATURE_HEIGHT_M): rocks a metre and taller poke through real snowpack,
// so they stay drawn and take the per-instance whiten (snow-on-up-normals)
// instead of vanishing. Monuments and resources always stay visible.
describe('isSnowBuriedRockKind', () => {
  it('buries SMALL decorative loose stone (under a metre)', () => {
    expect(isSnowBuriedRockKind('rock_pile')).toBe(true);     // 0.7 m
    expect(isSnowBuriedRockKind('pebbles')).toBe(true);       // 0.2 m
    expect(isSnowBuriedRockKind('field-stone')).toBe(true);   // 0.6 m rock species
  });

  it('keeps boulder-class rocks drawn — snowpack cannot swallow them', () => {
    expect(isSnowBuriedRockKind('boulder')).toBe(false);          // 1.2 m
    expect(isSnowBuriedRockKind('granite-boulder')).toBe(false);  // 1.8 m rock species
    expect(isSnowBuriedRockKind('rock_outcrop')).toBe(false);     // 3.0 m pinnacle
  });

  it('exempts monuments and resource markers even though they are rock family', () => {
    expect(isRockKind('standing_stone')).toBe(true);
    expect(isSnowBuriedRockKind('standing_stone')).toBe(false);
    expect(isRockKind('ore_vein')).toBe(true);
    expect(isSnowBuriedRockKind('ore_vein')).toBe(false);
  });

  it('never touches flora or unknown kinds', () => {
    expect(isSnowBuriedRockKind('english-oak')).toBe(false);
    expect(isSnowBuriedRockKind('grass_tuft')).toBe(false);
    expect(isSnowBuriedRockKind('no-such-kind')).toBe(false);
  });
});
