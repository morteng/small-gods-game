import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArtImageCache } from '@/render/decoration-image-cache';

beforeEach(() => {
  (URL as any).createObjectURL = vi.fn(() => 'blob:fake');
  (URL as any).revokeObjectURL = vi.fn();
});

describe('ArtImageCache', () => {
  it('uses the injected resolver to fetch blobs', async () => {
    const resolver = vi.fn(async (id: string) =>
      id === 'known' ? new Blob([new Uint8Array([1])], { type: 'image/png' }) : null);
    const cache = new ArtImageCache(resolver);
    const img = await cache.load('known');
    expect(resolver).toHaveBeenCalledWith('known');
    expect(img).not.toBeNull();
  });

  it('returns null for unknown ids and does not cache an Image', async () => {
    const resolver = vi.fn(async () => null);
    const cache = new ArtImageCache(resolver);
    expect(await cache.load('missing')).toBeNull();
  });
});
