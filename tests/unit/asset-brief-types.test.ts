import { describe, it, expect } from 'vitest';
import type { AssetBrief } from '@/assetgen/asset-brief';

describe('AssetBrief shape', () => {
  it('type-checks a building brief and round-trips through JSON', () => {
    const brief: AssetBrief = {
      kind: 'building',
      subject: 'tavern',
      traits: ['two storeys', 'hanging sign'],
      materials: [
        { part: 'walls', material: 'timber', color: '#8B5A2B' },
        { part: 'roof', material: 'tile', color: '#8B2E2E' },
      ],
      view: 'iso-3q',
      era: 'medieval',
      footprint: { w: 3, h: 3 },
      heightUnits: 1.7,
      door: { x: 1, y: 2, face: 's' },
      paletteAnchors: ['#8B5A2B', '#8B2E2E'],
      guidance: { source: 'massing', strength: 500 },
      negatives: ['blurry'],
      seed: 42,
    };

    const round = JSON.parse(JSON.stringify(brief)) as AssetBrief;
    expect(round).toEqual(brief);
    expect(round.door?.face).toBe('s');
    expect(round.materials.map((m) => m.color)).toEqual(round.paletteAnchors);
  });
});
