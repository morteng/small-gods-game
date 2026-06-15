import { describe, it, expect } from 'vitest';
import { buildingSpriteItemFromCanvas } from '@/render/iso/iso-building';

const o = { originX: 0, originY: 0 };

describe('buildingSpriteItemFromCanvas', () => {
  it('emits a single image item at the canvas native size', () => {
    const sprite = { width: 40, height: 30 } as unknown as HTMLCanvasElement;
    const item = buildingSpriteItemFromCanvas(o, sprite, 2, 2, { w: 3, h: 3 });
    expect(item.t).toBe('image');
    if (item.t !== 'image') return;
    expect(item.src).toBe(sprite);
    expect(item.dw).toBe(40);
    expect(item.dh).toBe(30);
  });
});
