import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { EventLog, type AppendedEvent } from '@/core/events';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { CommandQueue } from '@/sim/command/command-queue';
import { executeCommand } from '@/sim/command/command-system';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { DiscoveryQueue } from '@/sim/threads/discovery-queue';
import { StagingActivationSystem } from '@/sim/threads/systems/staging-activation-system';
import { LLMClient, MockLLMProvider, type LLMToolCall } from '@/llm/llm-client';
import { initNpcProps, npcProps, queryNpcs } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity, NpcProperties } from '@/core/types';
import type { GameState } from '@/core/state';
import type { SystemContext } from '@/core/scheduler';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import type { FateFocus } from '@/game/fate/fate-context';
import { FATE_ROLE_MAP } from '@/sim/command/authoring-verbs';

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 6; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 6; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 6, height: 6, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function canned(): LLMToolCall[] {
  return [{ id: 'c0', name: 'arm_staged_beat',
            arguments: { subjectPoiId: 'poi1', threadId: 1, hard: 'inject_npc', role: 'preacher', soft: 'A figure waits.' } }];
}

describe('Fate brain integration (prep → discover → materialize)', () => {
  it('brain arms an inject_npc beat; discovering the settlement materializes the stranger', async () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const fired: AppendedEvent[] = [];
    log.subscribe(e => { if (e.event.type === 'beat_fired') fired.push(e); });

    const world = new World(map());
    const r = initNpcProps('r1', 'farmer', 7); r.homePoiId = 'poi1'; r.homeX = 3; r.homeY = 3;
    world.addEntity({ id: 'r1', kind: 'npc', x: 3, y: 3, properties: r as unknown as Record<string, unknown> } as Entity);

    const plotThreads = new PlotThreadStore();
    const t = plotThreads.open('trial', { kind: 'settlement', poiId: 'poi1' }, 0);
    plotThreads.advance(t.id, 'hardship', 1, 0);
    const staging = new StagingBuffer();

    const state = {
      world, plotThreads, staging, clock,
      worldSeed: { name: 'T', pois: [{ id: 'poi1', name: 'Northvale' }] },
    } as unknown as GameState;

    // 1. Brain deliberates → arms one beat.
    const brain = new FateBrainService({
      getState: () => state,
      getCapableClient: () => new LLMClient(new MockLLMProvider(0, { cannedToolCalls: canned() })),
      isScrubbed: () => false,
      emitCommand: () => {},
    });
    const focus: FateFocus = { event: { type: 'thread_advanced', threadId: 1, phase: 'turning', weight: 'climax' }, threadId: 1 };
    await brain.deliberate(focus);
    expect(staging.armedByTrigger('discovery')).toHaveLength(1);

    // 2. Discover the settlement → activation fires the beat onto the command queue.
    const discovery = new DiscoveryQueue();
    const queue = new CommandQueue();
    const sys = new StagingActivationSystem(discovery, queue, () => staging, () => plotThreads);
    discovery.push({ subject: { kind: 'settlement', poiId: 'poi1' } });
    const ctx: SystemContext = { world, spirits: new Map(), log, clock, rng: createRng(1), dt: 2000, now: 20 };
    sys.tick(ctx);
    expect(fired).toHaveLength(1);

    // 3. Executor drains the queue → the stranger materializes.
    const before = queryNpcs(world).length;
    for (const cmd of queue.drain()) {
      executeCommand(cmd, { world, spirits: new Map(), log, rng: createRng(2), now: 20 });
    }
    const npcs = queryNpcs(world);
    expect(npcs.length).toBe(before + 1);
    const stranger = npcs.find(e => e.id !== 'r1')!;
    const p = npcProps(stranger) as NpcProperties & { fateRole?: string };
    expect(p.role).toBe(FATE_ROLE_MAP.preacher);
    expect(p.fateRole).toBe('preacher');
    expect(p.beliefs.player.faith).toBe(0);
  });
});
