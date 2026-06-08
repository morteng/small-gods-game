import { describe, it, expect, vi } from 'vitest';
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import type { Entity } from '@/core/types';
import { blueprintEntity } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';
import type { StructureResult } from '@/assetgen/compose';

const withBlueprint = (): Entity => blueprintEntity('b1', synthesizeBlueprint('cottage')!, 0, 0);
const noBlueprint = (): Entity => ({
  id: 'b1', kind: 'building', x: 0, y: 0, tags: ['building'], properties: {},
});

const fakeResult = { grey: new Uint8ClampedArray(4), size: 1, bbox: { x: 0, y: 0, w: 1, h: 1 } } as unknown as StructureResult;
const fakeSprite = { width: 10, height: 8 } as unknown as HTMLCanvasElement;

function flush() { return new Promise(r => setTimeout(r, 0)); }

describe('ParametricBuildingSource', () => {
  it('peek is null before warming', () => {
    const src = new ParametricBuildingSource({ compose: async () => fakeResult, toSprite: () => fakeSprite });
    expect(src.peek(withBlueprint())).toBeNull();
  });

  it('warm then peek returns the generated sprite', async () => {
    const src = new ParametricBuildingSource({ compose: async () => fakeResult, toSprite: () => fakeSprite });
    src.warm(withBlueprint());
    await flush();
    expect(src.peek(withBlueprint())).toBe(fakeSprite);
  });

  it('an entity with no blueprint stays null and never composes', async () => {
    const compose = vi.fn(async () => fakeResult);
    const src = new ParametricBuildingSource({ compose, toSprite: () => fakeSprite });
    src.warm(noBlueprint());
    await flush();
    expect(src.peek(noBlueprint())).toBeNull();
    expect(compose).not.toHaveBeenCalled();
  });

  it('a blueprint whose spec is null stays null and never composes', async () => {
    const compose = vi.fn(async () => fakeResult);
    const src = new ParametricBuildingSource({ toSpec: () => null, compose, toSprite: () => fakeSprite });
    src.warm(withBlueprint());
    await flush();
    expect(src.peek(withBlueprint())).toBeNull();
    expect(compose).not.toHaveBeenCalled();
  });

  it('a compose failure stays null and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const src = new ParametricBuildingSource({ compose: async () => { throw new Error('boom'); }, toSprite: () => fakeSprite });
    src.warm(withBlueprint());
    await flush();
    src.warm(withBlueprint()); // cached null → no retry
    await flush();
    expect(src.peek(withBlueprint())).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('warming twice composes only once (in-flight + cache guard)', async () => {
    const compose = vi.fn(async () => fakeResult);
    const src = new ParametricBuildingSource({ compose, toSprite: () => fakeSprite });
    src.warm(withBlueprint());
    src.warm(withBlueprint());
    await flush();
    expect(compose).toHaveBeenCalledTimes(1);
  });
});
