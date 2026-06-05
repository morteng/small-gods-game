import { describe, it, expect, vi } from 'vitest';
import { drawIsoGroundField } from '@/render/iso/iso-ground';
import { buildingEntity } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';

function makeMockCtx() {
  return {
    save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    fill: vi.fn(), fillStyle: '', globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

const bounds = { minTx: -10, maxTx: 50, minTy: -10, maxTy: 50 };

function worldOf(entities: object[]) {
  return { query: () => entities } as any;
}

describe('drawIsoGroundField', () => {
  it('fills a foundation+apron diamond per ground cell for a building', () => {
    // cottage preset: 3×3 footprint, packed_dirt ground + radius-1 apron
    const cottage = buildingEntity('b1', synthesizeFromPreset('cottage')!, 5, 5);
    const ctx = makeMockCtx();
    drawIsoGroundField(ctx, worldOf([cottage]), 0, 0, bounds);
    // footprint (9) + apron ring (25-9=16) = 25 cells, each one filled diamond
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBe(25);
  });

  it('draws nothing when there are no buildings', () => {
    const ctx = makeMockCtx();
    drawIsoGroundField(ctx, worldOf([]), 0, 0, bounds);
    expect((ctx.fill as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('culls cells outside the visible bounds', () => {
    const cottage = buildingEntity('b1', synthesizeFromPreset('cottage')!, 5, 5);
    const ctx = makeMockCtx();
    // bounds that exclude the building entirely
    drawIsoGroundField(ctx, worldOf([cottage]), 0, 0, { minTx: 100, maxTx: 200, minTy: 100, maxTy: 200 });
    expect((ctx.fill as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
