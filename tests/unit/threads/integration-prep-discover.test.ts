import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps, queryNpcs, npcProps } from '@/world/npc-helpers';
import { EventLog, type AppendedEvent } from '@/core/events';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { CommandQueue } from '@/sim/command/command-queue';
import { executeCommand } from '@/sim/command/command-system';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { DiscoveryQueue } from '@/sim/threads/discovery-queue';
import { PlotThreadSystem } from '@/sim/threads/systems/plot-thread-system';
import { StagingActivationSystem } from '@/sim/threads/systems/staging-activation-system';
import type { SystemContext } from '@/core/scheduler';
import type { GameMap, Tile } from '@/core/types';

function makeMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 8; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 8; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 8, height: 8, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

describe('integration: prep → discover → materialize', () => {
  it('a settlement trial stages a stranger, discovered later, who materializes', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const captured: AppendedEvent[] = [];
    log.subscribe(e => captured.push(e));
    const world = new World(makeMap());
    // A resident so author_spawn_npc can resolve `near: 'p1'`.
    const residentProps = { ...initNpcProps('Resident', 'farmer', 1), homePoiId: 'p1' };
    world.addEntity({ id: 'resident', kind: 'npc', x: 4, y: 4,
      properties: residentProps as unknown as Record<string, unknown> });

    const threads = new PlotThreadStore();
    const staging = new StagingBuffer();
    const discovery = new DiscoveryQueue();
    const queue = new CommandQueue();

    const plotSys = new PlotThreadSystem(() => threads, () => staging);
    const actSys = new StagingActivationSystem(discovery, queue, () => staging, () => threads);

    const ctx = (now: number): SystemContext => ({
      world, spirits: new Map(), log, clock, rng: createRng(7), dt: 2000, now,
    });

    // Drive a trial to 'hardship': onset then a more-severe drought.
    log.append({ type: 'settlement_begin', poiId: 'p1', eventType: 'drought', severity: 0.3, durationTicks: 100 });
    log.append({ type: 'settlement_begin', poiId: 'p1', eventType: 'drought', severity: 0.8, durationTicks: 100 });
    plotSys.tick(ctx(10));

    // The stub producer has armed a discovery beat on the settlement.
    const armed = staging.armedFor({ kind: 'settlement', poiId: 'p1' });
    expect(armed).toHaveLength(1);
    expect(armed[0].hard[0].verb).toBe('author_spawn_npc');

    const npcsBefore = queryNpcs(world).length;

    // The player discovers the settlement → activation fires the beat.
    discovery.push({ subject: { kind: 'settlement', poiId: 'p1' } });
    actSys.tick(ctx(12));

    expect(captured.some(e => e.event.type === 'beat_fired')).toBe(true);

    // The fired hard command materializes the stranger when the executor drains.
    for (const cmd of queue.drain()) {
      executeCommand(cmd, { world, spirits: new Map(), log, rng: createRng(7), now: 12 });
    }

    const npcsAfter = queryNpcs(world);
    expect(npcsAfter.length).toBe(npcsBefore + 1);
    expect(npcsAfter.some(e => npcProps(e).role === 'beggar')).toBe(true);
  });
});
