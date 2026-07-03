import { describe, it, expect, vi } from 'vitest';
import { createRng } from '@/core/rng';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { stageStrangerOnHardship, type ProducerCtx } from '@/sim/threads/stub-producer';
import { StoryRegistry } from '@/story/story-registry';
import type { StoryPack } from '@/story/story-ir';
import { STORY_IR_VERSION } from '@/story/story-ir';

function pack(overrides: Partial<StoryPack> = {}): StoryPack {
  return {
    id: 'test-pack',
    version: STORY_IR_VERSION,
    storylets: [
      { id: 'entry', title: 'Entry', priority: 5, body: [{ t: 'end' }] },
    ],
    ...overrides,
  };
}

function baseCtx(overrides: Partial<ProducerCtx> = {}): ProducerCtx {
  const threads = new PlotThreadStore();
  const t = threads.open('trial', { kind: 'settlement', poiId: 'p1' }, 0);
  threads.advance(t.id, 'hardship', 1, 0);
  return {
    world: undefined as unknown as ProducerCtx['world'],
    threads,
    staging: new StagingBuffer(),
    now: 10,
    rng: createRng(1),
    ...overrides,
  };
}

describe('stageStrangerOnHardship — storylet arming', () => {
  it('arms hard/soft-only (no storylet field) when no storyRegistry is supplied', () => {
    const ctx = baseCtx();
    stageStrangerOnHardship(ctx);
    const beats = ctx.staging.armedByTrigger('discovery');
    expect(beats).toHaveLength(1);
    expect(beats[0].storylet).toBeUndefined();
    expect(beats[0].hard).toHaveLength(1);
  });

  it('selects and attaches an entry storylet from the loaded pack', () => {
    const registry = new StoryRegistry();
    expect(registry.register(pack())).toEqual([]);
    const ctx = baseCtx({ storyRegistry: registry });
    stageStrangerOnHardship(ctx);
    const beats = ctx.staging.armedByTrigger('discovery');
    expect(beats).toHaveLength(1);
    expect(beats[0].storylet).toBe('entry');
  });

  it('honours pack `when` gating: an ineligible-only pack yields no storylet ref', () => {
    const registry = new StoryRegistry();
    expect(registry.register(pack({
      storylets: [{ id: 'gated', priority: 5, when: [false], body: [{ t: 'end' }] }],
    }))).toEqual([]);
    const ctx = baseCtx({ storyRegistry: registry });
    stageStrangerOnHardship(ctx);
    const beats = ctx.staging.armedByTrigger('discovery');
    expect(beats[0].storylet).toBeUndefined();
  });

  it('drops a selected storylet id the registry does not recognize, logging a warning (defensive drift guard)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A registry-shaped fake whose all() returns a pack, but has() denies the id —
    // simulating drift between selection and the index (defense-in-depth; not
    // reachable via the real StoryRegistry.register() path, which indexes every
    // storylet of an accepted pack).
    const fakeRegistry = {
      all: () => [pack()],
      has: () => false,
    } as unknown as StoryRegistry;
    const ctx = baseCtx({ storyRegistry: fakeRegistry });
    stageStrangerOnHardship(ctx);
    const beats = ctx.staging.armedByTrigger('discovery');
    expect(beats).toHaveLength(1);
    expect(beats[0].storylet).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unregistered storylet id'),
      'entry',
    );
    warn.mockRestore();
  });

  it('is deterministic: the same seed picks the same storylet across runs', () => {
    const registry = new StoryRegistry();
    registry.register(pack({
      storylets: [
        { id: 'a', priority: 5, body: [{ t: 'end' }] },
        { id: 'b', priority: 5, body: [{ t: 'end' }] },
      ],
    }));
    const run = () => {
      const ctx = baseCtx({ storyRegistry: registry, rng: createRng(42) });
      stageStrangerOnHardship(ctx);
      return ctx.staging.armedByTrigger('discovery')[0].storylet;
    };
    expect(run()).toBe(run());
  });
});
