import { describe, it, expect, vi } from 'vitest';
import { CAPABILITY_REGISTRY, getCapability, isMetaVerb } from '@/sim/command/registry';
import { previewCommand } from '@/sim/command/command-system';
import { CommandQueue } from '@/sim/command/command-queue';
import { createGameBus } from '@/game/game-bus';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import type { GameQuery } from '@/game/game-query';
import type { Command } from '@/sim/command/types';
import type { GameMap } from '@/core/types';

const META_VERBS = ['set_time_rate', 'skip_to_next_event', 'cancel_seek'] as const;

function emptyMap(): GameMap {
  return { tiles: [], width: 4, height: 4, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

describe('time meta-commands — registration', () => {
  it('are in the capability registry so the bus/story allowlist accepts the verbs', () => {
    for (const v of META_VERBS) {
      const def = getCapability(v);
      expect(def, v).toBeDefined();
      expect(def!.tier).toBe('meta');
      expect(isMetaVerb(v)).toBe(true);
      // Meta verbs carry NO apply — they are handled off-sim.
      expect(def!.apply).toBeUndefined();
    }
    expect(isMetaVerb('whisper')).toBe(false);
    // Present in the verb vocabulary the story-pack guard reads.
    for (const v of META_VERBS) expect(Object.keys(CAPABILITY_REGISTRY)).toContain(v);
  });

  it('are rejected not_implemented if one ever reaches the sim executor (belt & suspenders)', () => {
    const state = createState();
    state.world = new World(emptyMap());
    const cmd: Command = { verb: 'set_time_rate', source: 'player', target: { kind: 'none' }, params: { rate: 8 }, seq: 0 };
    const reason = previewCommand(cmd, { world: state.world, spirits: state.spirits, log: state.eventLog });
    expect(reason).toBe('not_implemented');
  });
});

describe('time meta-commands — routed off-sim, never in the replay/event stream', () => {
  function makeBus(onMeta: (c: Omit<Command, 'seq'>) => void) {
    const state = createState();
    state.world = new World(emptyMap());
    const queue = new CommandQueue();
    const query = {} as GameQuery;
    const bus = createGameBus({ queue, state, query, onMeta });
    return { state, queue, bus };
  }

  it('bus.emit routes meta verbs to onMeta and does NOT enqueue or log them', () => {
    const onMeta = vi.fn();
    const { state, queue, bus } = makeBus(onMeta);
    const eventsBefore = state.eventLog.size();

    bus.emit({ verb: 'set_time_rate', source: 'player', target: { kind: 'none' }, params: { rate: 60 } });
    bus.emit({ verb: 'skip_to_next_event', source: 'player', target: { kind: 'none' } });
    bus.emit({ verb: 'cancel_seek', source: 'player', target: { kind: 'none' } });

    expect(onMeta).toHaveBeenCalledTimes(3);
    expect(queue.size()).toBe(0);                       // never entered the sim queue
    expect(state.eventLog.size()).toBe(eventsBefore);   // never entered the event log
  });

  it('a normal (non-meta) command still enqueues', () => {
    const onMeta = vi.fn();
    const { queue, bus } = makeBus(onMeta);
    bus.emit({ verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'n1' } });
    expect(onMeta).not.toHaveBeenCalled();
    expect(queue.size()).toBe(1);
  });
});
