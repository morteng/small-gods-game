import { describe, it, expect } from 'vitest';
import { buildManifestLine, blobFileName, isSafeId } from '../../vite-plugins/promote-asset';

describe('promote helpers', () => {
  it('builds a stable blob filename from kind + key', () => {
    expect(blobFileName('decoration', 'a1b2')).toBe('decoration-a1b2.png');
  });
  it('builds a one-line JSON manifest record with a relative blob path', () => {
    const line = buildManifestLine({
      key: 'a1b2', kind: 'decoration', style: 'pixel-art', provider: 'pixellab',
      model: 'pixflux', recipeVersion: 'v1', prompt: 'a bush', width: 64, height: 64,
      tags: ['bush'], affinity: { biome: ['grassland'] }, generatedAt: 5,
    });
    const parsed = JSON.parse(line);
    expect(parsed.blob).toBe('blobs/decoration-a1b2.png');
    expect(parsed.key).toBe('a1b2');
    expect(line.endsWith('\n')).toBe(true);
  });
});

describe('isSafeId (path-traversal guard)', () => {
  it('accepts alphanumerics, dash, underscore within the length bound', () => {
    expect(isSafeId('decoration', 32)).toBe(true);
    expect(isSafeId('a1b2-c3_d4', 64)).toBe(true);
    expect(isSafeId('fb6586ba210c6c2cc853e4b308f600141e51e7c0', 64)).toBe(true);
  });
  it('rejects traversal sequences, separators, and filesystem-meaningful chars', () => {
    expect(isSafeId('../../etc/passwd', 64)).toBe(false);
    expect(isSafeId('a/b', 64)).toBe(false);
    expect(isSafeId('a.png', 64)).toBe(false);
    expect(isSafeId('a b', 64)).toBe(false);
  });
  it('rejects empty, over-length, and non-string input', () => {
    expect(isSafeId('', 32)).toBe(false);
    expect(isSafeId('x'.repeat(33), 32)).toBe(false);
    expect(isSafeId(undefined, 32)).toBe(false);
    expect(isSafeId(42, 32)).toBe(false);
  });
});
