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

describe('matchesAsset — recipeVersion gate', () => {
  const base: AssetMeta = {
    kind: 'building', style: 'pixel-art', model: 'pixflux', provider: 'pixellab',
    tags: ['yurt'], width: 64, height: 64,
  };
  const req: AssetRequest = { kind: 'building', style: 'pixel-art' };

  it('rejects an asset whose declared recipeVersion mismatches the request', () => {
    expect(matchesAsset({ ...base, recipeVersion: 'v1' }, { ...req, recipeVersion: 'v2' })).toBe(false);
  });

  it('accepts an asset whose declared recipeVersion matches the request', () => {
    expect(matchesAsset({ ...base, recipeVersion: 'v2' }, { ...req, recipeVersion: 'v2' })).toBe(true);
  });

  it('does not gate an asset that declares no recipeVersion (live runtime art)', () => {
    expect(matchesAsset({ ...base }, { ...req, recipeVersion: 'v2' })).toBe(true);
  });

  it('ignores recipeVersion entirely when the request omits it', () => {
    expect(matchesAsset({ ...base, recipeVersion: 'v1' }, req)).toBe(true);
  });
});
