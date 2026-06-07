import { describe, it, expect, vi } from 'vitest';
import { guidanceOrigin, drawMassingGuidance, renderMassingToImage } from '@/assetgen/massing-guidance';
import type { BuildingDescriptor } from '@/world/building-descriptor';

const cottage: BuildingDescriptor = {
  preset: 'cottage', category: 'residential', era: 'medieval',
  footprint: { w: 2, h: 2 }, plan: 'rect', levels: 1, levelInset: 0,
  heightPerLevel: 1, roof: 'gable', walls: 'wattle', roofMat: 'thatch',
  groundMaterial: 'dirt', door: { x: 1, y: 1 },
};

function fakeCtx() {
  const calls: string[] = [];
  return {
    calls,
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    ellipse: vi.fn(),
    stroke: vi.fn(() => calls.push('stroke')),
    fill: vi.fn(() => calls.push('fill')),
    fillRect: vi.fn(() => calls.push('fillRect')),
    fillStyle: '', strokeStyle: '', lineWidth: 0,
  } as any;
}

describe('guidanceOrigin', () => {
  it('centres the footprint diamond and anchors the south tip at the bottom', () => {
    // 2x2 → contentW = (2+2)*64 = 256; size 256x240
    // originX = (256-256)/2 + 2*64 = 128; originY = 240 - (2+2)*32 = 240-128 = 112
    expect(guidanceOrigin(cottage, { width: 256, height: 240 })).toEqual({ originX: 128, originY: 112 });
  });
});

describe('drawMassingGuidance', () => {
  it('draws the massing (path fills) and a door marker (fillRect)', () => {
    const ctx = fakeCtx();
    drawMassingGuidance(ctx, cottage, { width: 256, height: 240 });
    expect(ctx.calls).toContain('fill');     // massing body
    expect(ctx.calls).toContain('fillRect'); // door marker
  });
});

describe('renderMassingToImage', () => {
  it('renders to a canvas and returns the base64 payload (no data-URI prefix)', () => {
    const ctx = fakeCtx();
    const canvas = {
      width: 0, height: 0,
      getContext: () => ctx,
      toDataURL: () => 'data:image/png;base64,STUBPAYLOAD',
    } as any;
    const b64 = renderMassingToImage(cottage, { width: 256, height: 240 }, () => canvas);
    expect(b64).toBe('STUBPAYLOAD');
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(240);
    expect(ctx.calls).toContain('fillRect'); // door marker drawn
  });
});
