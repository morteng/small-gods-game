import { describe, it, expect } from 'vitest';
import { describeForHuman } from '@/assetgen/describe';
import { toBrief } from '@/blueprint/compile/to-brief';
import { synthesizeBlueprint } from '@/blueprint/presets';

describe('describeForHuman', () => {
  it('names subject, wall + roof material, and door face', () => {
    const s = describeForHuman(toBrief(synthesizeBlueprint('cottage')!, 1));
    expect(s).toContain('cottage');
    expect(s).toContain('wattle');
    expect(s).toContain('thatch');
    // door {x:1,y:2} on 3x3 → 's' face → screen-relative 'front-left' wall.
    expect(s).toContain('front-left');
  });
});
