import { describe, it, expect } from 'vitest';
import { decodePngToRaster, rasterToSpriteCanvas, rasterToPngBlob } from '@/render/sprite-codec';

// jsdom has no canvas backend — every codec must degrade to null, never throw,
// so the art source falls back to the parametric sprite (and skips persisting).
describe('sprite-codec without a canvas backend', () => {
  it('decodePngToRaster returns null', async () => {
    const blob = new Blob([new Uint8Array([0])], { type: 'image/png' });
    expect(await decodePngToRaster(blob)).toBeNull();
  });

  it('rasterToSpriteCanvas / rasterToPngBlob return null', async () => {
    const r = { data: new Uint8ClampedArray(4), w: 1, h: 1 };
    expect(rasterToSpriteCanvas(r)).toBeNull();
    expect(await rasterToPngBlob(r)).toBeNull();
  });
});
