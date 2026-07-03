import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { LLMClient, MockLLMProvider, type LLMToolCall } from '@/llm/llm-client';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { GameState } from '@/core/state';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import type { FateFocus } from '@/game/fate/fate-context';
import type { Command } from '@/sim/command/types';

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 4; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 4; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 4, height: 4, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function makeState(): GameState {
  const world = new World(map());
  const p = initNpcProps('r1', 'farmer', 7); p.homePoiId = 'poi1';
  world.addEntity({ id: 'r1', kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> } as Entity);
  const plotThreads = new PlotThreadStore();
  const t = plotThreads.open('trial', { kind: 'settlement', poiId: 'poi1' }, 0);
  plotThreads.advance(t.id, 'hardship', 1, 0);
  return {
    world, plotThreads, staging: new StagingBuffer(), clock: new SimClock(),
    worldSeed: { name: 'T', pois: [{ id: 'poi1', name: 'Northvale' }] },
  } as unknown as GameState;
}
function canned(args: Record<string, unknown>): LLMToolCall[] {
  return [{ id: 'c0', name: 'arm_staged_beat', arguments: args }];
}
function clientArming(threadId = 1): LLMClient {
  return new LLMClient(new MockLLMProvider(0, {
    cannedToolCalls: canned({ subjectPoiId: 'poi1', threadId, hard: 'inject_npc', role: 'preacher', soft: 'A shadow at the gate.' }),
  }));
}
const focus = (): FateFocus => ({ event: { type: 'thread_advanced', threadId: 1, phase: 'turning', weight: 'climax' }, threadId: 1 });

describe('FateBrainService', () => {
  it('arms exactly one beat from a tool call and marks the thread staged', async () => {
    const state = makeState();
    const armed: unknown[] = [];
    const brain = new FateBrainService({
      getState: () => state, getCapableClient: () => clientArming(), isScrubbed: () => false,
      onArmed: (b) => armed.push(b), emitCommand: () => {},
    });
    await brain.deliberate(focus());
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(1);
    expect(armed).toHaveLength(1);
    expect(state.plotThreads.get(1)!.vars.staged).toBe(1);
  });

  it('no-ops when no capable client is configured', async () => {
    const state = makeState();
    const brain = new FateBrainService({ getState: () => state, getCapableClient: () => null, isScrubbed: () => false, emitCommand: () => {} });
    await brain.deliberate(focus());
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(0);
  });

  it('no-ops while scrubbing', async () => {
    const state = makeState();
    const brain = new FateBrainService({ getState: () => state, getCapableClient: () => clientArming(), isScrubbed: () => true, emitCommand: () => {} });
    await brain.deliberate(focus());
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(0);
  });

  it('arms nothing when the model returns no tool call', async () => {
    const state = makeState();
    const empty = new LLMClient(new MockLLMProvider(0, { cannedToolCalls: [] }));
    const brain = new FateBrainService({ getState: () => state, getCapableClient: () => empty, isScrubbed: () => false, emitCommand: () => {} });
    await brain.deliberate(focus());
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(0);
  });

  it('is single-flight: a concurrent deliberate while one is in flight no-ops', async () => {
    const state = makeState();
    const brain = new FateBrainService({ getState: () => state, getCapableClient: () => clientArming(), isScrubbed: () => false, emitCommand: () => {} });
    const a = brain.deliberate(focus());
    const b = brain.deliberate(focus());   // second call sees inFlight === true → no-op
    await Promise.all([a, b]);
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(1);
  });

  it('emits immediate commands via emitCommand', async () => {
    const state = makeState();
    const emitted: Array<Omit<Command, 'seq'>> = [];
    const brain = new FateBrainService({
      getState: () => state, getCapableClient: () => clientNudging(), isScrubbed: () => false,
      emitCommand: (c) => emitted.push(c),
    });
    await brain.deliberate(focus());
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ verb: 'nudge_severity', source: 'fate', payload: { delta: 0.3 } });
  });

  it('arms a beat carrying a storylet ref when it is in getValidStoryletIds', async () => {
    const state = makeState();
    const client = new LLMClient(new MockLLMProvider(0, {
      cannedToolCalls: canned({ subjectPoiId: 'poi1', threadId: 1, hard: 'none', storylet: 'parched-prayer' }),
    }));
    const brain = new FateBrainService({
      getState: () => state, getCapableClient: () => client, isScrubbed: () => false, emitCommand: () => {},
      getValidStoryletIds: () => new Set(['parched-prayer']),
    });
    await brain.deliberate(focus());
    const [beat] = state.staging.armedByTrigger('discovery');
    expect(beat.storylet).toBe('parched-prayer');
  });

  it('drops a storylet ref not in getValidStoryletIds, still arming the beat', async () => {
    const state = makeState();
    const client = new LLMClient(new MockLLMProvider(0, {
      cannedToolCalls: canned({ subjectPoiId: 'poi1', threadId: 1, hard: 'none', storylet: 'made-up' }),
    }));
    const brain = new FateBrainService({
      getState: () => state, getCapableClient: () => client, isScrubbed: () => false, emitCommand: () => {},
      getValidStoryletIds: () => new Set(['parched-prayer']),
    });
    await brain.deliberate(focus());
    const [beat] = state.staging.armedByTrigger('discovery');
    expect(beat.storylet).toBeUndefined();
  });
});

function clientNudging(): LLMClient {
  return new LLMClient(new MockLLMProvider(0, {
    cannedToolCalls: [{ id: 'c0', name: 'nudge_event_severity', arguments: { subjectPoiId: 'poi1', delta: 0.3 } }],
  }));
}
