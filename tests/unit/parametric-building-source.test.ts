import { describe, it, expect, vi } from 'vitest';
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import type { Entity } from '@/core/types';
import type { BuildingDescriptor } from '@/world/building-descriptor';
import type { StructureResult, StructureSpec } from '@/assetgen/compose';

const desc: BuildingDescriptor = {
  category: 'residential', era: 'medieval',
  footprint: { w: 3, h: 3 }, plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 2,
  roof: 'gable', walls: 'timber', roofMat: 'thatch', door: { x: 1, y: 2 },
};
const entity = (d: BuildingDescriptor | undefined): Entity => ({
  id: 'b1', kind: 'building', x: 0, y: 0, tags: ['building'],
  properties: d ? { descriptor: d } : {},
});

const fakeResult = { grey: new Uint8ClampedArray(4), size: 1, bbox: { x: 0, y: 0, w: 1, h: 1 } } as unknown as StructureResult;
const fakeSprite = { width: 10, height: 8 } as unknown as HTMLCanvasElement;

function flush() { return new Promise(r => setTimeout(r, 0)); }

describe('ParametricBuildingSource', () => {
  it('peek is null before warming', () => {
    const src = new ParametricBuildingSource({ compose: async () => fakeResult, toSprite: () => fakeSprite });
    expect(src.peek(entity(desc))).toBeNull();
  });

  it('warm then peek returns the generated sprite', async () => {
    const src = new ParametricBuildingSource({ compose: async () => fakeResult, toSprite: () => fakeSprite });
    src.warm(entity(desc));
    await flush();
    expect(src.peek(entity(desc))).toBe(fakeSprite);
  });

  it('an entity with no descriptor stays null and never composes', async () => {
    const compose = vi.fn(async () => fakeResult);
    const src = new ParametricBuildingSource({ compose, toSprite: () => fakeSprite });
    src.warm(entity(undefined));
    await flush();
    expect(src.peek(entity(undefined))).toBeNull();
    expect(compose).not.toHaveBeenCalled();
  });

  it('a descriptor whose spec is null stays null and never composes', async () => {
    const compose = vi.fn(async () => fakeResult);
    const src = new ParametricBuildingSource({ toSpec: () => null, compose, toSprite: () => fakeSprite });
    src.warm(entity(desc));
    await flush();
    expect(src.peek(entity(desc))).toBeNull();
    expect(compose).not.toHaveBeenCalled();
  });

  it('a compose failure stays null and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const src = new ParametricBuildingSource({ compose: async () => { throw new Error('boom'); }, toSprite: () => fakeSprite });
    src.warm(entity(desc));
    await flush();
    src.warm(entity(desc)); // cached null → no retry
    await flush();
    expect(src.peek(entity(desc))).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('warming twice composes only once (in-flight + cache guard)', async () => {
    const compose = vi.fn(async () => fakeResult);
    const src = new ParametricBuildingSource({ compose, toSprite: () => fakeSprite });
    src.warm(entity(desc));
    src.warm(entity(desc));
    await flush();
    expect(compose).toHaveBeenCalledTimes(1);
  });
});
