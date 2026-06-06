import { describe, it, expect } from 'vitest';
import { matchesAsset, scoreAsset, type AssetMeta, type AssetRequest } from '@/services/asset-match';

const base: AssetMeta = {
  kind: 'decoration', style: 'pixel-art', model: 'pixflux', provider: 'pixellab',
  tags: ['boulder', 'mossy'], affinity: { biome: ['grassland'], era: ['ancient'] },
  width: 64, height: 64,
};

describe('matchesAsset (hard filters)', () => {
  it('requires kind + style', () => {
    expect(matchesAsset(base, { kind: 'decoration', style: 'pixel-art' })).toBe(true);
    expect(matchesAsset(base, { kind: 'building', style: 'pixel-art' })).toBe(false);
    expect(matchesAsset(base, { kind: 'decoration', style: 'painterly' })).toBe(false);
  });
  it('honors optional model/provider hard filters', () => {
    expect(matchesAsset(base, { kind: 'decoration', style: 'pixel-art', model: 'pixflux' })).toBe(true);
    expect(matchesAsset(base, { kind: 'decoration', style: 'pixel-art', model: 'other' })).toBe(false);
  });
  it('honors size when given', () => {
    expect(matchesAsset(base, { kind: 'decoration', style: 'pixel-art', size: { w: 64, h: 64 } })).toBe(true);
    expect(matchesAsset(base, { kind: 'decoration', style: 'pixel-art', size: { w: 32, h: 32 } })).toBe(false);
  });
});

describe('scoreAsset (soft)', () => {
  it('rewards tag and affinity overlap', () => {
    const req: AssetRequest = {
      kind: 'decoration', style: 'pixel-art',
      tagsAny: ['boulder'], biomeAny: ['grassland'], eraAny: ['ancient'],
    };
    const lean: AssetRequest = { kind: 'decoration', style: 'pixel-art' };
    expect(scoreAsset(base, req)).toBeGreaterThan(scoreAsset(base, lean));
  });
});
