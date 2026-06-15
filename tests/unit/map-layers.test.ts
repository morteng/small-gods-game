import { describe, it, expect } from 'vitest';
import { drawBiomeLayer, drawPoiLayer, BIOME_COLORS } from '@/render/map-layers';
import { createCamera } from '@/render/camera';
import type { BiomeMap, POI } from '@/core/types';

// Stub 2D context recording the calls the layer drawers make.
function stubCtx() {
  const calls: Record<string, number> = {};
  const bump = (k: string) => { calls[k] = (calls[k] ?? 0) + 1; };
  const ctx = {
    save: () => bump('save'), restore: () => bump('restore'),
    beginPath: () => bump('beginPath'), moveTo: () => bump('moveTo'),
    lineTo: () => bump('lineTo'), closePath: () => bump('closePath'),
    stroke: () => bump('stroke'), fill: () => bump('fill'),
    fillRect: () => bump('fillRect'), strokeRect: () => bump('strokeRect'),
    arc: () => bump('arc'), ellipse: () => bump('ellipse'),
    fillText: () => bump('fillText'),
    fillStyle: '', strokeStyle: '', globalAlpha: 1, shadowColor: '', shadowBlur: 0,
    lineWidth: 0, font: '', textAlign: '', textBaseline: '',
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function biomeMap(biomes: string[], width: number, height: number): BiomeMap {
  return { biomes, width, height };
}

describe('BIOME_COLORS', () => {
  it('has colors for the common land biomes', () => {
    for (const b of ['temperate_forest', 'desert', 'tundra', 'savanna', 'swamp']) {
      expect(BIOME_COLORS[b]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('drawBiomeLayer', () => {
  it('does nothing when the biome map is null', () => {
    const { ctx, calls } = stubCtx();
    drawBiomeLayer(ctx, null, createCamera());
    expect(Object.keys(calls)).toHaveLength(0);
  });

  it('skips ocean cells (no fill for them)', () => {
    const { ctx, calls } = stubCtx();
    const bm = biomeMap(['ocean', 'ocean'], 2, 1);
    drawBiomeLayer(ctx, bm, createCamera());
    expect(calls.fill ?? 0).toBe(0);
  });

  it('iso: fills cells as diamonds (fill, not fillRect)', () => {
    const { ctx, calls } = stubCtx();
    const bm = biomeMap(['desert', 'temperate_forest'], 2, 1);
    drawBiomeLayer(ctx, bm, createCamera());
    expect(calls.fill).toBeGreaterThanOrEqual(2);
    expect(calls.fillRect ?? 0).toBe(0);
  });
});

describe('drawPoiLayer', () => {
  it('does nothing for an empty list', () => {
    const { ctx, calls } = stubCtx();
    drawPoiLayer(ctx, [], createCamera());
    expect(Object.keys(calls)).toHaveLength(0);
  });

  it('outlines a region POI (iso diamond) and labels it', () => {
    const { ctx, calls } = stubCtx();
    const pois = [{ id: 'p1', name: 'Town', type: 'village', region: { x_min: 1, x_max: 4, y_min: 1, y_max: 3 } }] as unknown as POI[];
    drawPoiLayer(ctx, pois, createCamera());
    expect(calls.closePath).toBeGreaterThanOrEqual(1); // region outline diamond (drawOutlineRect)
    expect(calls.stroke).toBeGreaterThanOrEqual(1);
    expect(calls.fillText).toBeGreaterThanOrEqual(1);    // label
  });

  it('draws a radius ring for a position-only POI', () => {
    const { ctx, calls } = stubCtx();
    const pois = [{ id: 'p2', name: 'Shrine', type: 'shrine', position: { x: 5, y: 5 } }] as unknown as POI[];
    drawPoiLayer(ctx, pois, createCamera());
    expect(calls.ellipse).toBeGreaterThanOrEqual(1);
    expect(calls.fillText).toBeGreaterThanOrEqual(1);
  });
});
