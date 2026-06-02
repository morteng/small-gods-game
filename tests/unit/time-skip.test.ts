import { describe, it, expect } from 'vitest';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, queryNpcs, REMAINS_KIND } from '@/world/npc-helpers';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import { applySkip } from '@/sim/time-skip';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function addNpc(world: World, id: string, ageYears: number, poiId = 'village'): Entity {
  const p = initNpcProps(id, 'farmer', (id.charCodeAt(id.length - 1) * 977) | 0);
  p.lineageId = id;
  p.birthTick = -ageYears * TICKS_PER_YEAR;
  p.homePoiId = poiId;
  const e: Entity = { id, kind: 'npc', x: 3, y: 4, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function harness(seed: number) {
  const world = new World(emptyMap());
  const clock = new SimClock();
  const log = new EventLog(clock);
  return { world, clock, log, rng: createRng(seed) };
}

describe('applySkip', () => {
  it('advances the clock by exactly years * TICKS_PER_YEAR', () => {
    const h = harness(1);
    addNpc(h.world, 'a', 25); addNpc(h.world, 'b', 27);
    h.clock.setNow(1000);
    applySkip(h.world, h.clock, h.rng, h.log, 10);
    expect(h.clock.now()).toBe(1000 + 10 * TICKS_PER_YEAR);
  });

  it('converts the projected dead to remains and never deletes them', () => {
    const h = harness(2);
    addNpc(h.world, 'old1', 94); addNpc(h.world, 'old2', 94);
    const summary = applySkip(h.world, h.clock, h.rng, h.log, 3)!;
    const remains = h.world.registry.all().filter(e => e.kind === REMAINS_KIND);
    expect(remains.length).toBe(summary.deaths);
    expect(summary.deaths).toBe(2);
    expect(queryNpcs(h.world).length).toBe(0);
  });

  it('does not mutate surviving NPCs belief', () => {
    const h = harness(4);
    addNpc(h.world, 'm', 24); addNpc(h.world, 'f', 26);
    npcProps(h.world.registry.get('m')!).beliefs['player'] = { faith: 0.7, understanding: 0.5, devotion: 0.3 };
    const before = new Map(queryNpcs(h.world).map(e => [e.id, structuredClone(npcProps(e).beliefs)]));
    applySkip(h.world, h.clock, h.rng, h.log, 2);
    for (const e of queryNpcs(h.world)) {
      if (before.has(e.id)) expect(npcProps(e).beliefs).toEqual(before.get(e.id));
    }
  });

  it('emits exactly one era_skipped event with matching counts', () => {
    const h = harness(5);
    addNpc(h.world, 'm', 24); addNpc(h.world, 'f', 26);
    const events: string[] = [];
    h.log.subscribe(a => events.push(a.event.type));
    const summary = applySkip(h.world, h.clock, h.rng, h.log, 20)!;
    expect(events.filter(t => t === 'era_skipped')).toHaveLength(1);
    const living = queryNpcs(h.world).length;
    expect(summary.births).toBe(living - (2 - summary.deaths));
    const remains = h.world.registry.all().filter(e => e.kind === REMAINS_KIND).length;
    expect(summary.deaths).toBe(remains);
  });

  it('is deterministic: same seed -> identical world (full state, not just id:kind)', () => {
    const run = () => {
      const h = harness(99);
      addNpc(h.world, 'm', 24); addNpc(h.world, 'f', 26); addNpc(h.world, 'g', 40);
      applySkip(h.world, h.clock, h.rng, h.log, 30);
      // Hash the FULL post-skip state — ids, kinds, positions, and properties
      // (beliefs, birthTick, lineageId, parentIds) — so the assertion catches
      // any rng-order drift, not merely a changed set of id:kind pairs.
      return h.world.registry.all()
        .map(e => `${e.id}:${e.kind}:${e.x},${e.y}:${JSON.stringify(e.properties)}`)
        .sort().join('|');
    };
    expect(run()).toBe(run());
  });

  it('treats years <= 0 as a no-op (no event, no clock change)', () => {
    const h = harness(7);
    addNpc(h.world, 'm', 24);
    h.clock.setNow(500);
    const events: string[] = [];
    h.log.subscribe(a => events.push(a.event.type));
    expect(applySkip(h.world, h.clock, h.rng, h.log, 0)).toBeNull();
    expect(h.clock.now()).toBe(500);
    expect(events).toHaveLength(0);
  });
});

describe('era_skipped event', () => {
  it('round-trips through the event log with all summary fields', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const captured: SimEvent[] = [];
    log.subscribe(a => captured.push(a.event));
    log.append({
      type: 'era_skipped', fromTick: 0, toTick: 23040, years: 1,
      deaths: 2, births: 3, believersBefore: 5, believersAfter: 6,
    });
    expect(captured).toHaveLength(1);
    const e = captured[0];
    expect(e.type).toBe('era_skipped');
    if (e.type === 'era_skipped') {
      expect(e.years).toBe(1);
      expect(e.deaths).toBe(2);
      expect(e.believersAfter).toBe(6);
    }
  });
});
