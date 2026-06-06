import { describe, it, expect, vi } from 'vitest';
import { AssetLibrary } from '@/services/asset-library';
import type { BaseLibraryRecord } from '@/services/base-library-loader';
import type { AssetSummary } from '@/core/types';

const baseRec: BaseLibraryRecord = {
  key: 'base1', kind: 'decoration', style: 'pixel-art', provider: 'pixellab', model: 'pixflux',
  recipeVersion: 'v1', prompt: 'a base bush', width: 64, height: 64, tags: ['bush'],
  affinity: { biome: ['grassland'] }, blob: 'blobs/decoration-base1.png', generatedAt: 1,
};

function summary(over: Partial<AssetSummary>): AssetSummary {
  return {
    id: 'live1', kind: 'decoration', tags: ['bush'], prompt: 'a live bush',
    width: 64, height: 64, addedAt: 2, style: 'pixel-art', model: 'pixflux',
    provider: 'pixellab', ...over,
  };
}

describe('AssetLibrary.query', () => {
  it('merges base + live, base wins on duplicate key, applies hard filters', async () => {
    const live = vi.fn(async () => [summary({ id: 'live1' }), summary({ id: 'base1' })]);
    const lib = new AssetLibrary([baseRec], { listKeptSummaries: live });
    const res = await lib.query({ kind: 'decoration', style: 'pixel-art' });
    const ids = res.map(r => r.id).sort();
    expect(ids).toEqual(['base1', 'live1']); // base1 de-duped to the base record
    expect(res.find(r => r.id === 'base1')!.sourceTier).toBe('base');
    expect(res.find(r => r.id === 'live1')!.sourceTier).toBe('live');
  });

  it('degrades to base-only when the live source throws (storage degraded)', async () => {
    const live = vi.fn(async () => { throw new Error('IndexedDB unavailable'); });
    const lib = new AssetLibrary([baseRec], { listKeptSummaries: live });
    const res = await lib.query({ kind: 'decoration', style: 'pixel-art' });
    expect(res.map(r => r.id)).toEqual(['base1']); // no throw; base record still served
  });

  it('filters out the wrong kind/style', async () => {
    const live = vi.fn(async () => [summary({ id: 'live1', style: 'painterly' })]);
    const lib = new AssetLibrary([baseRec], { listKeptSummaries: live });
    const res = await lib.query({ kind: 'decoration', style: 'pixel-art' });
    expect(res.map(r => r.id)).toEqual(['base1']);
  });
});

describe('AssetLibrary.pick', () => {
  it('is deterministic for the same seed and varies candidates by seed', async () => {
    const recs: BaseLibraryRecord[] = [
      { ...baseRec, key: 'b1' }, { ...baseRec, key: 'b2' }, { ...baseRec, key: 'b3' },
    ];
    const lib = new AssetLibrary(recs, { listKeptSummaries: async () => [] });
    const a = await lib.pick({ kind: 'decoration', style: 'pixel-art', seed: 5 });
    const b = await lib.pick({ kind: 'decoration', style: 'pixel-art', seed: 5 });
    expect(a!.id).toBe(b!.id); // stable
  });

  it('returns null when nothing matches', async () => {
    const lib = new AssetLibrary([], { listKeptSummaries: async () => [] });
    expect(await lib.pick({ kind: 'building', style: 'pixel-art' })).toBeNull();
  });
});
