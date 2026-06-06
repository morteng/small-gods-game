import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  generate, cacheGet, listKeptSummaries, _resetDbForTesting,
} from '@/services/pixellab';

beforeEach(async () => {
  _resetDbForTesting();
  await new Promise<void>((res) => {
    const req = indexedDB.deleteDatabase('smallgods.pixellab');
    req.onsuccess = req.onerror = () => res();
  });
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('palette')) {
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as any;
    }
    return { ok: true, json: async () => ({ image: { base64: btoa('PNGDATA') } }) } as any;
  }));
  if (!('createObjectURL' in URL)) (URL as any).createObjectURL = () => 'blob:x';
});

describe('schema v3 write path', () => {
  it('generate() stamps provider/model/style/recipeVersion', async () => {
    const { key } = await generate('test-key', {
      prompt: 'a mossy boulder', width: 64, height: 64,
      kind: 'decoration', origin: 'official', tags: ['boulder'],
      style: 'pixel-art', affinity: { biome: ['grassland'] },
    });
    const rec = await cacheGet(key);
    expect(rec?.schemaVersion).toBe(3);
    expect(rec?.provider).toBe('pixellab');
    expect(rec?.model).toBe('pixflux');
    expect(rec?.style).toBe('pixel-art');
    expect(rec?.affinity).toEqual({ biome: ['grassland'] });
    expect(rec?.recipeVersion).toBeTruthy();
  });

  it('listKeptSummaries returns kept assets of a kind with v3 metadata', async () => {
    await generate('k', {
      prompt: 'a stump', width: 64, height: 64,
      kind: 'decoration', origin: 'official', style: 'pixel-art',
    });
    const out = await listKeptSummaries('decoration');
    expect(out).toHaveLength(1);
    expect(out[0].style).toBe('pixel-art');
    expect(out[0].provider).toBe('pixellab');
    expect(out[0].model).toBe('pixflux');
  });
});
