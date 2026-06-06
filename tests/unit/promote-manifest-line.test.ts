import { describe, it, expect } from 'vitest';
import { buildManifestLine, blobFileName } from '../../vite-plugins/promote-asset';

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
