// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { readGeneratedArt, writeGeneratedArt, clearGeneratedArt, _resetGeneratedArtDbForTesting, generatedArtKey, canonicalJson } from '@/render/generated-art-cache';

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

describe('canonicalJson', () => {
  it('is insensitive to object key order, recursively', () => {
    const a = { b: 1, a: { y: [1, { q: 2, p: 3 }], x: 'v' } };
    const b = { a: { x: 'v', y: [1, { p: 3, q: 2 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('still distinguishes different values', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
});

describe('generatedArtKey', () => {
  it('keys identical content with reordered properties identically', () => {
    const a = canonicalJson({ preset: 'cottage', storeys: 1 });
    const b = canonicalJson({ storeys: 1, preset: 'cottage' });
    expect(generatedArtKey(a, 'm', { w: 2, h: 2 })).toBe(generatedArtKey(b, 'm', { w: 2, h: 2 }));
  });

  it('embeds the footprint as a collision discriminator', () => {
    const j = canonicalJson({ preset: 'cottage' });
    expect(generatedArtKey(j, 'm', { w: 2, h: 2 })).toContain('2x2');
    expect(generatedArtKey(j, 'm', { w: 2, h: 2 })).not.toBe(generatedArtKey(j, 'm', { w: 3, h: 2 }));
  });
});
