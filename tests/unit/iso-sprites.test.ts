import { describe, it, expect } from 'vitest';
import { artBillboardItem } from '@/render/iso/iso-sprites';

describe('artBillboardItem (decoration / prop)', () => {
  it('blits at the art NATIVE size (no tile-fraction scaling) — true 1:1', () => {
    const img = { naturalWidth: 96, naturalHeight: 128 } as unknown as HTMLImageElement;
    const item = artBillboardItem({ originX: 0, originY: 0 }, img, 0, 0);

    expect(item.t).toBe('image');
    if (item.t !== 'image') return;
    expect(item.src).toBe(img);
    // dest size === native size exactly (one source px == one screen px at zoom 1)
    expect(item.dw).toBe(96);  // dest width === naturalWidth
    expect(item.dh).toBe(128); // dest height === naturalHeight
    // base anchored at the tile centre (0,0 → screen 0,0): dx = -round(w/2), dy = -h
    expect(item.dx).toBe(-48); // -round(96/2)
    expect(item.dy).toBe(-128);
  });
});
