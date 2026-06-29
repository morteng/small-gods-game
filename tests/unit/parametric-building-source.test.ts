import { describe, it, expect, vi } from 'vitest';
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import type { Entity } from '@/core/types';
import { blueprintEntity } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';
import type { StructureResult, StructureSpec } from '@/assetgen/compose';
import type { ResolvedPart } from '@/blueprint/types';

const withBlueprint = (): Entity => blueprintEntity('b1', synthesizeBlueprint('cottage')!, 0, 0);
const noBlueprint = (): Entity => ({
  id: 'b1', kind: 'building', x: 0, y: 0, tags: ['building'], properties: {},
});

const fakeResult = { grey: new Uint8ClampedArray(4), size: 1, bbox: { x: 0, y: 0, w: 1, h: 1 } } as unknown as StructureResult;
const fakeSprite = { albedo: { width: 10, height: 8 } as unknown as HTMLCanvasElement };

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

  it('a toSpec that THROWS caches null and warns once — never escapes to the frame loop', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const compose = vi.fn(async () => fakeResult);
    const src = new ParametricBuildingSource({
      toSpec: () => { throw new Error('unknown part type "body"'); }, compose, toSprite: () => fakeSprite,
    });
    expect(() => src.warm(withBlueprint())).not.toThrow();
    expect(() => src.warm(withBlueprint())).not.toThrow(); // cached null → no rethrow
    expect(src.peek(withBlueprint())).toBeNull();
    expect(compose).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('default toSpec works without callers pre-registering part types (autosave path)', async () => {
    // Entities restored from an autosave carry an already-RESOLVED blueprint, so no
    // code path ever calls ensureBuildingTypesRegistered before toGeometry. Simulate
    // by detaching the rb and rebuilding the module graph with a fresh (empty) registry.
    const e: Entity = JSON.parse(JSON.stringify(withBlueprint())); // deserialized save entity
    vi.resetModules();
    const { ParametricBuildingSource: FreshSource } = await import('@/render/parametric-building-source');
    const compose = vi.fn(async () => fakeResult);
    const src = new FreshSource({ compose, toSprite: () => fakeSprite });
    expect(() => src.warm(e)).not.toThrow();
    await flush();
    expect(src.peek(e)).toBe(fakeSprite);
  });

  it('warming twice composes only once (in-flight + cache guard)', async () => {
    const compose = vi.fn(async () => fakeResult);
    const src = new ParametricBuildingSource({ compose, toSprite: () => fakeSprite });
    src.warm(withBlueprint());
    src.warm(withBlueprint());
    await flush();
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it('version bumps PER pack + signals onWarm — so the static cache rebuilds as each lands', async () => {
    // The flatblock bug was bumping the version only once the whole batch drained, freezing
    // the earlier packs as grey blocks. Two distinct blueprints → two packs → two bumps +
    // two onWarm kicks (one per landed pack, each redrawing that building).
    const onWarm = vi.fn();
    const src = new ParametricBuildingSource({ compose: async () => fakeResult, toSprite: () => fakeSprite, onWarm });
    const v0 = src.version();
    src.warm(blueprintEntity('a', synthesizeBlueprint('cottage')!, 0, 0));
    src.warm(blueprintEntity('b', synthesizeBlueprint('tavern')!, 0, 0));
    await flush();
    expect(src.version()).toBe(v0 + 2);
    expect(onWarm).toHaveBeenCalledTimes(2);
  });

  // Interior I-2 (focus reveal): the cutaway variant is a SEPARATE cache entry keyed off the
  // cutaway-patched blueprint, so the closed and open sprites never collide.
  describe('cutaway view (interior I-2)', () => {
    it('cutaway is a distinct cache entry — warming the closed building does not populate it', async () => {
      const src = new ParametricBuildingSource({ compose: async () => fakeResult, toSprite: () => fakeSprite });
      src.warm(withBlueprint());                       // closed only
      await flush();
      expect(src.peek(withBlueprint())).toBe(fakeSprite);    // closed present
      expect(src.peek(withBlueprint(), true)).toBeNull();    // cutaway not warmed → null
      src.warm(withBlueprint(), true);                 // now warm cutaway
      await flush();
      expect(src.peek(withBlueprint(), true)).toBe(fakeSprite);
    });

    it('cutaway warm patches the body part with cutaway:true; closed warm leaves it off', async () => {
      const specs: StructureSpec[] = [];
      const src = new ParametricBuildingSource({
        toSpec: (rb) => { specs.push({ parts: rb.parts } as unknown as StructureSpec); return specs[specs.length - 1]; },
        compose: async () => fakeResult, toSprite: () => fakeSprite,
      });
      src.warm(withBlueprint());        // closed
      src.warm(withBlueprint(), true);  // cutaway
      await flush();
      const bodyOf = (s: StructureSpec) =>
        (s as unknown as { parts: ResolvedPart[] }).parts.find((p) => p.type === 'body')!;
      expect(bodyOf(specs[0]).params.cutaway).not.toBe(true); // closed
      expect(bodyOf(specs[1]).params.cutaway).toBe(true);     // cutaway
    });
  });
});
