import { describe, it, expect } from 'vitest';
import { buildingSpriteTargetWidth, blobToBuildingSprite } from '@/render/blob-to-building-sprite';

describe('buildingSpriteTargetWidth', () => {
  it('matches the parametric diamond width', () => {
    expect(buildingSpriteTargetWidth({ w: 2, h: 2 })).toBe(256);
    expect(buildingSpriteTargetWidth({ w: 3, h: 3 })).toBe(384);
    expect(buildingSpriteTargetWidth({ w: 3, h: 2 })).toBe(320);
  });
});

describe('blobToBuildingSprite', () => {
  it('returns null when no canvas backend is available (jsdom)', async () => {
    const blob = new Blob([new Uint8Array([0])], { type: 'image/png' });
    expect(await blobToBuildingSprite(blob, 256)).toBeNull();
  });
});
