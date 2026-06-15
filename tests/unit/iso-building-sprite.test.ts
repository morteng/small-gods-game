import { describe, it, expect } from 'vitest';
import { buildingSpriteItemFromImage } from '@/render/iso/iso-building';

const o = { originX: 0, originY: 0 };

describe('buildingSpriteItemFromImage', () => {
  it('blits at NATIVE size (no rescale to the footprint diamond) — true 1:1', () => {
    // 2x2 footprint → diamond width (2+2)*64 = 256; sprite authored 256x240.
    const img = { naturalWidth: 256, naturalHeight: 240 } as unknown as HTMLImageElement;
    const item = buildingSpriteItemFromImage(o, img, 0, 0, { w: 2, h: 2 });

    expect(item.t).toBe('image');
    if (item.t !== 'image') return;
    expect(item.src).toBe(img);
    // dest size === native size exactly (one source px == one screen px at zoom 1)
    expect(item.dw).toBe(256); // dest width === naturalWidth
    expect(item.dh).toBe(240); // dest height === naturalHeight
  });

  it('anchors the bottom at the south tip, centred on the footprint', () => {
    const img = { naturalWidth: 256, naturalHeight: 240 } as unknown as HTMLImageElement;
    const item = buildingSpriteItemFromImage(o, img, 0, 0, { w: 2, h: 2 });
    if (item.t !== 'image') throw new Error('expected image item');
    // front tile (1,1) centre = worldToScreen(1,1,0) = (0,64); south tip = +32 = 96; cx = 0
    expect(item.dx).toBe(-128); // x = cx - natW/2 = 0 - 128
    expect(item.dy).toBe(96 - 240); // y = footprint south tip - natH
  });

  it('does NOT stretch an undersized sprite to span the footprint', () => {
    // 3x3 footprint → diamond width 384; an undersized 200x180 sprite stays 200x180.
    const img = { naturalWidth: 200, naturalHeight: 180 } as unknown as HTMLImageElement;
    const item = buildingSpriteItemFromImage(o, img, 0, 0, { w: 3, h: 3 });
    if (item.t !== 'image') throw new Error('expected image item');
    expect(item.dw).toBe(200); // native width — NOT stretched to 384
    expect(item.dh).toBe(180); // native height
    // front tile (2,2) centre = worldToScreen(2,2,0) = (0,128); south tip = +32 = 160; cx = 0
    expect(item.dx).toBe(-100); // cx - natW/2
    expect(item.dy).toBe(160 - 180);
  });
});
