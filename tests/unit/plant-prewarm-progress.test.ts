import { describe, it, expect } from 'vitest';
import { ParametricPlantSource } from '@/render/parametric-plant-source';
import { plantPresetNames } from '@/blueprint/presets';
import type { StructureResult } from '@/assetgen/compose';

const fakeResult = { grey: new Uint8ClampedArray(4), size: 1, bbox: { x: 0, y: 0, w: 1, h: 1 } } as unknown as StructureResult;
const fakeSprite = { albedo: { width: 4, height: 4 } as unknown as HTMLCanvasElement };

describe('ParametricPlantSource.prewarmAll progress', () => {
  it('reports done/total once per species, ending complete', async () => {
    const src = new ParametricPlantSource({ compose: async () => fakeResult, toSprite: () => fakeSprite });
    const ticks: Array<[number, number]> = [];
    await src.prewarmAll((done, total) => ticks.push([done, total]));
    const total = plantPresetNames().length;
    expect(total).toBeGreaterThan(0);
    expect(ticks).toHaveLength(total);
    expect(ticks.map(([d]) => d)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(ticks.every(([, t]) => t === total)).toBe(true);
  });

  it('prewarmAll still resolves with no callback', async () => {
    const src = new ParametricPlantSource({ compose: async () => fakeResult, toSprite: () => fakeSprite });
    await expect(src.prewarmAll()).resolves.toBeUndefined();
  });
});
