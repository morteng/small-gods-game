import { describe, it, expect } from 'vitest';
import { isSnowBuriedRockKind, isRockKind } from '@/world/entity-kinds';

// The draw list hides these entirely once the ground paints predominantly white
// (GROUND_COVER_SNOW_HIDE in entity-draw-list.ts): a grey lump on a snowfield,
// even whitened, reads as dropped ON the snow (user report). Monuments and
// resources are gameplay-relevant and must stay visible.
describe('isSnowBuriedRockKind', () => {
  it('buries decorative loose stone (built-in kinds + rock species)', () => {
    expect(isSnowBuriedRockKind('boulder')).toBe(true);
    expect(isSnowBuriedRockKind('rock_pile')).toBe(true);
    expect(isSnowBuriedRockKind('pebbles')).toBe(true);
    expect(isSnowBuriedRockKind('field-stone')).toBe(true);   // procedural habit:'rock' species
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
