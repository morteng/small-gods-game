import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { createState } from '@/core/state';
import { Scheduler } from '@/core/scheduler';
import { TimelineController } from '@/core/timeline';
import { initNpcProps, queryNpcs, REMAINS_KIND } from '@/world/npc-helpers';
import { killNpc } from '@/world/npc-lifecycle';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

describe('time-skip timeline boundary', () => {
  it('cannot scrub back across a committed skip', () => {
    const state = createState();
    const map = emptyMap();
    state.map = map;
    state.world = new World(map);
    const p = initNpcProps('victim', 'farmer', 5);
    p.lineageId = 'victim'; p.birthTick = -90 * TICKS_PER_YEAR; p.homePoiId = 'village';
    const e: Entity = { id: 'victim', kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> };
    state.world.addEntity(e);

    const scheduler = new Scheduler();
    const timeline = new TimelineController({ state, scheduler });
    timeline.onAfterLiveTick(); // baseline snapshot of the living world at tick 0

    // Simulate a skip: advance clock + kill the victim, then commit the boundary.
    const toTick = 50 * TICKS_PER_YEAR;
    killNpc(state.world, e, toTick, 'old_age', state.eventLog);
    state.clock.setNow(toTick);
    timeline.commitSkip();

    // Attempt to scrub back before the skip.
    timeline.jumpTo(0);

    // The victim must still be dead — pre-skip living state is unreachable.
    expect(queryNpcs(state.world).length).toBe(0);
    expect(state.world.registry.all().filter(x => x.kind === REMAINS_KIND).length).toBe(1);
    // Pre-skip events remain readable in the canonical log.
    expect(state.eventLog.since(0).some(a => a.event.type === 'npc_death')).toBe(true);
  });
});
