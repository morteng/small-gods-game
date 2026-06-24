import { describe, it, expect, vi } from 'vitest';
import { ArtResolver } from '@/render/art-resolver';
import type { AssetLibrary, ResolvedAsset } from '@/services/asset-library';
import type { Entity } from '@/core/types';

function fakeLib(pickResult: ResolvedAsset | null) {
  return { pick: vi.fn(async () => pickResult) } as unknown as AssetLibrary;
}
function ent(id: string, kind: string): Entity {
  return { id, kind, x: 1, y: 1, tags: [], properties: {} } as unknown as Entity;
}

describe('ArtResolver', () => {
  it('returns the picked id and memoizes per entity id (one pick call)', async () => {
    const lib = fakeLib({ id: 'asset-x', sourceTier: 'base', width: 64, height: 64, score: 3 });
    const r = new ArtResolver(lib, 'pixel-art');
    const e = ent('boulder#1', 'boulder');
    expect(await r.resolve(e)).toBe('asset-x');
    expect(await r.resolve(e)).toBe('asset-x');
    expect((lib.pick as any)).toHaveBeenCalledTimes(1); // memoized
  });

  it('returns null (and keeps the fallback) when the best pick has score 0', async () => {
    // matchesAsset only hard-filters kind+style, so pick() can return an
    // unrelated top candidate at score 0 — the resolver must reject it.
    const lib = fakeLib({ id: 'unrelated', sourceTier: 'base', width: 64, height: 64, score: 0 });
    const r = new ArtResolver(lib, 'pixel-art');
    const e = ent('english-oak#3', 'english-oak');
    expect(await r.resolve(e)).toBeNull();
    expect(await r.resolve(e)).toBeNull();
    expect((lib.pick as any)).toHaveBeenCalledTimes(1); // still memoized
  });

  it('passes entity kind as a tag + decoration AssetKind, seeded by entity id', async () => {
    const lib = fakeLib(null);
    const r = new ArtResolver(lib, 'pixel-art');
    await r.resolve(ent('boulder#7', 'boulder'));
    const req = (lib.pick as any).mock.calls[0][0];
    expect(req.kind).toBe('decoration');
    expect(req.style).toBe('pixel-art');
    expect(req.tagsAny).toContain('boulder');
    expect(typeof req.seed).toBe('number');
  });

  it('caches null misses too (no repeated pick)', async () => {
    const lib = fakeLib(null);
    const r = new ArtResolver(lib, 'pixel-art');
    const e = ent('rock#2', 'rock');
    expect(await r.resolve(e)).toBeNull();
    expect(await r.resolve(e)).toBeNull();
    expect((lib.pick as any)).toHaveBeenCalledTimes(1);
  });

  it('requests the configured assetKind (building)', async () => {
    const lib = fakeLib(null);
    const r = new ArtResolver(lib, 'pixel-art', 'building');
    await r.resolve(ent('cottage#1', 'cottage'));
    const req = (lib.pick as any).mock.calls[0][0];
    expect(req.kind).toBe('building');
    expect(req.tagsAny).toContain('cottage');
  });

  it('defaults assetKind to decoration', async () => {
    const lib = fakeLib(null);
    const r = new ArtResolver(lib, 'pixel-art');
    await r.resolve(ent('rock#1', 'rock'));
    expect((lib.pick as any).mock.calls[0][0].kind).toBe('decoration');
  });

  it('does not mutate the entity', async () => {
    const lib = fakeLib({ id: 'a', sourceTier: 'base', width: 64, height: 64, score: 0 });
    const r = new ArtResolver(lib, 'pixel-art');
    const e = ent('x#1', 'x');
    const snapshot = JSON.stringify(e);
    await r.resolve(e);
    expect(JSON.stringify(e)).toBe(snapshot);
  });
});

describe('ArtResolver — recipeVersion opt-in', () => {
  it('passes recipeVersion in the pick request when constructed with one', async () => {
    const lib = { pick: vi.fn(async () => null) } as unknown as AssetLibrary;
    const r = new ArtResolver(lib, 'pixel-art', 'building', 'v2');
    await r.resolve(ent('cottage#1', 'cottage'));
    expect((lib.pick as any).mock.calls[0][0]).toMatchObject({ recipeVersion: 'v2' });
  });

  it('omits recipeVersion from the request when constructed without one', async () => {
    const lib = { pick: vi.fn(async () => null) } as unknown as AssetLibrary;
    const r = new ArtResolver(lib, 'pixel-art', 'decoration');
    await r.resolve(ent('flower#1', 'flower'));
    expect((lib.pick as any).mock.calls[0][0].recipeVersion).toBeUndefined();
  });
});
