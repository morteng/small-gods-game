import { describe, it, expect, vi } from 'vitest';
import { drawIsoVegetation } from '@/render/iso/iso-sprites';
import { createNullAtlas } from '@/render/iso/iso-atlas';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import type { Entity } from '@/core/types';

function makeMockCtx() {
  return {
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    fill: vi.fn(), fillRect: vi.fn(), ellipse: vi.fn(), arc: vi.fn(),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
}

function dc(ctx: CanvasRenderingContext2D) {
  return { ctx, atlas: createNullAtlas(), originX: 0, originY: 0 };
}

function entity(kind: string): Entity {
  return { id: `${kind}-1`, kind, x: 2, y: 3 };
}

describe('drawIsoVegetation', () => {
  it('draws a shadow and a canopy for a tree', () => {
    const ctx = makeMockCtx();
    drawIsoVegetation(dc(ctx), entity('oak_tree'));
    // ground shadow ellipse + canopy fill
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect((ctx.ellipse as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('paints the canopy in the entity kind fallback color', () => {
    const ctx = makeMockCtx();
    const seen: string[] = [];
    Object.defineProperty(ctx, 'fillStyle', {
      get: () => seen[seen.length - 1] ?? '',
      set: (v: string) => { seen.push(v); },
    });
    drawIsoVegetation(dc(ctx), entity('orange_tree'));
    const expected = tryGetEntityKindDef('orange_tree')!.sprite.fallbackColor;
    expect(seen).toContain(expected);
  });

  it('draws a triangle canopy for triangle-shaped kinds', () => {
    const ctx = makeMockCtx();
    drawIsoVegetation(dc(ctx), entity('pine_tree'));
    expect((ctx.moveTo as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('draws a trunk for tall trees but not for ground cover', () => {
    const treeCtx = makeMockCtx();
    drawIsoVegetation(dc(treeCtx), entity('oak_tree'));
    expect((treeCtx.fillRect as ReturnType<typeof vi.fn>)).toHaveBeenCalled();

    const fernCtx = makeMockCtx();
    drawIsoVegetation(dc(fernCtx), entity('fern'));
    expect((fernCtx.fillRect as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('ignores non-vegetation entities', () => {
    const ctx = makeMockCtx();
    drawIsoVegetation(dc(ctx), entity('cottage'));
    drawIsoVegetation(dc(ctx), entity('boulder'));
    drawIsoVegetation(dc(ctx), entity('unknown_kind'));
    expect((ctx.fill as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
