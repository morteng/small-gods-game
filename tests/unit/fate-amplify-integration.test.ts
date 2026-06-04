import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { EventLog } from '@/core/events';
import { LLMClient, MockLLMProvider, type LLMToolCall } from '@/llm/llm-client';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { CommandQueue } from '@/sim/command/command-queue';
import { executeCommand } from '@/sim/command/command-system';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import type { FateFocus } from '@/game/fate/fate-context';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { GameState } from '@/core/state';
import type { ApplyCtx as CmdApplyCtx } from '@/sim/command/types';
import type { SystemContext } from '@/core/scheduler';

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 2; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 2; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 2, height: 2, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function makeState(world: World): GameState {
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
const focus = (): FateFocus => ({ event: { type: 'thread_advanced', threadId: 1, phase: 'turning', weight: 'climax' }, threadId: 1 });
function clientWith(calls: LLMToolCall[]): LLMClient {
  return new LLMClient(new MockLLMProvider(0, { cannedToolCalls: calls }));
}
function drain(queue: CommandQueue, ctx: CmdApplyCtx) {
  for (const cmd of queue.drain()) executeCommand(cmd, ctx);
}

describe('Fate amplify levers — integration', () => {
  it('brain force_next_event → roller materializes that event', async () => {
    const world = new World(map()); const state = makeState(world);
    const queue = new CommandQueue(); const log = new EventLog(new SimClock());
    const brain = new FateBrainService({
      getState: () => state, isScrubbed: () => false,
      getCapableClient: () => clientWith([{ id: 'c0', name: 'force_next_event', arguments: { subjectPoiId: 'poi1', eventType: 'plague' } }]),
      emitCommand: (c) => queue.emit(c),
    });
    await brain.deliberate(focus());

    const applyCtx: CmdApplyCtx = { world, spirits: new Map(), log, rng: createRng(1), now: 0 };
    drain(queue, applyCtx);
    expect(world.forcedEvents.get('poi1')).toBe('plague');

    const sys = new SettlementEventSystem();
    sys.tick({ world, clock: state.clock, rng: createRng(1), log, spirits: new Map(), now: 0, dt: 1 } as unknown as SystemContext);
    expect(world.activeEvents.get('poi1')![0].type).toBe('plague');
    expect(world.forcedEvents.has('poi1')).toBe(false);
  });

  it('brain nudge_event_severity → active event severity rises', async () => {
    const world = new World(map()); const state = makeState(world);
    world.activeEvents.set('poi1', [{ type: 'drought', poiId: 'poi1', severity: 0.4, durationTicks: 100, ticksElapsed: 0 }]);
    const queue = new CommandQueue(); const log = new EventLog(new SimClock());
    const brain = new FateBrainService({
      getState: () => state, isScrubbed: () => false,
      getCapableClient: () => clientWith([{ id: 'c0', name: 'nudge_event_severity', arguments: { subjectPoiId: 'poi1', delta: 0.3 } }]),
      emitCommand: (c) => queue.emit(c),
    });
    await brain.deliberate(focus());
    drain(queue, { world, spirits: new Map(), log, rng: createRng(1), now: 0 });
    expect(world.activeEvents.get('poi1')![0].severity).toBeCloseTo(0.7, 5);
  });
});
