import { describe, it, expect, vi } from 'vitest';
import { GeneratedBuildingArtSource } from '@/render/generated-building-art-source';
import type { Entity } from '@/core/types';

const SPRITE = {} as unknown as HTMLCanvasElement; // opaque stand-in
function entity(seed: string): Entity {
  return { id: 'b1', kind: 'cottage', x: 0, y: 0,
    properties: { blueprint: { rb: { preset: seed, footprint: { w: 2, h: 2 } } } } } as unknown as Entity;
}

function makeSource(over = {}) {
  const generate = vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/png' }));
  const src = new GeneratedBuildingArtSource({
    enabled: () => true, canSpend: () => true, model: () => 'm',
    prompt: () => 'P', initDataUri: async () => 'data:image/png;base64,AA',
    targetWidth: () => 256, generate,
    cacheGet: async () => null, cachePut: async () => {},
    decode: async () => SPRITE,
    ...over,
  });
  return { src, generate };
}

describe('GeneratedBuildingArtSource', () => {
  it('peek is null until warm resolves, then returns the sprite', async () => {
    const { src, generate } = makeSource();
    const e = entity('cottage');
    expect(src.peek(e)).toBeNull();
    src.warm(e); await vi.waitFor(() => expect(src.peek(e)).toBe(SPRITE));
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('serves a cache hit without calling generate', async () => {
    const { src, generate } = makeSource({ cacheGet: async () => ({ blob: new Blob(), targetWidth: 256 }) });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).toBe(SPRITE));
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not generate when disabled or over budget → peek stays null', async () => {
    const a = makeSource({ enabled: () => false });
    const b = makeSource({ canSpend: () => false });
    const e = entity('cottage');
    a.src.warm(e); b.src.warm(e); await Promise.resolve(); await Promise.resolve();
    expect(a.src.peek(e)).toBeNull(); expect(b.src.peek(e)).toBeNull();
    expect(a.generate).not.toHaveBeenCalled(); expect(b.generate).not.toHaveBeenCalled();
  });

  it('over budget caches null → does not re-enter run() / re-read cache each frame', async () => {
    const cacheGet = vi.fn(async () => null);
    const { src } = makeSource({ canSpend: () => false, cacheGet });
    const e = entity('cottage');
    src.warm(e); await vi.waitFor(() => expect(cacheGet).toHaveBeenCalledTimes(1));
    src.warm(e); src.warm(e); await Promise.resolve(); await Promise.resolve();
    expect(cacheGet).toHaveBeenCalledTimes(1); // cached null after the first miss; no thrash
  });

  it('caches null on failure (falls back) and never throws', async () => {
    const { src } = makeSource({ generate: vi.fn(async () => { throw new Error('boom'); }) });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).toBeNull());
  });

  it('identical blueprints share one generation', async () => {
    const { src, generate } = makeSource();
    src.warm(entity('cottage')); src.warm(entity('cottage'));
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  });
});
