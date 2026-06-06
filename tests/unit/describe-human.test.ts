import { describe, it, expect } from 'vitest';
import { describeForHuman } from '@/assetgen/describe';
import { buildingBrief } from '@/assetgen/producers/building-producer';
import type { BuildingDescriptor } from '@/world/building-descriptor';

const cottage: BuildingDescriptor = {
  preset: 'cottage', category: 'residential', era: 'medieval',
  footprint: { w: 3, h: 3 }, plan: 'rect', levels: 1, levelInset: 0,
  heightPerLevel: 1, roof: 'gable', walls: 'wattle', roofMat: 'thatch',
  groundMaterial: 'dirt', door: { x: 1, y: 2 },
};

describe('describeForHuman', () => {
  it('names subject, wall + roof material, and door face', () => {
    const s = describeForHuman(buildingBrief(cottage, 1));
    expect(s).toContain('cottage');
    expect(s).toContain('wattle');
    expect(s).toContain('thatch');
    expect(s).toContain('south');
  });
});
