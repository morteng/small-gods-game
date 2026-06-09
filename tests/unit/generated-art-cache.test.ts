// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { readGeneratedArt, writeGeneratedArt, clearGeneratedArt, _resetGeneratedArtDbForTesting } from '@/render/generated-art-cache';

beforeEach(async () => { _resetGeneratedArtDbForTesting(); await clearGeneratedArt(); });

describe('generated-art-cache', () => {
  it('round-trips a blob + targetWidth', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await writeGeneratedArt('k1', blob, { model: 'm', prompt: 'p', targetWidth: 256 });
    const got = await readGeneratedArt('k1');
    expect(got?.targetWidth).toBe(256);
    expect(await got!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer());
  });

  it('returns null on miss', async () => {
    expect(await readGeneratedArt('absent')).toBeNull();
  });
});
