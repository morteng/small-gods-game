import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog, SilentEventLog, type SimEvent } from '@/core/events';
import { Scheduler } from '@/core/scheduler';
import { SystemStateRegistry } from '@/core/system-state';
import { createRng } from '@/core/rng';
import { GAME_HOUR_HZ } from '@/core/calendar';
import { initNpcProps, npcProps, queryNpcs } from '@/world/npc-helpers';
import { killNpc, birthNpc } from '@/world/npc-lifecycle';
import { BirthSystem } from '@/sim/systems/birth-system';
import { MortalitySystem } from '@/sim/systems/mortality-system';
import { CohortSystem } from '@/sim/systems/cohort-system';
import { cohortPopulation } from '@/sim/cohorts';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function addAdult(world: World, id: string, poiId: string, ageYears = 30): Entity {
  const p = initNpcProps(id, 'farmer', (id.charCodeAt(id.length - 1) * 977) | 0);
  p.lineageId = id;
  p.birthTick = -ageYears * TICKS_PER_YEAR;
  p.homePoiId = poiId;
  const e: Entity = { id, kind: 'npc', x: 2, y: 2, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function ctxFor(world: World, seed: number) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  return { world, spirits: new Map(), log, clock, rng: createRng(seed), dt: 1000, now: 0 };
}
/** Totals per bucket as the shadow ledger sees them. */
function ledgerTotals(sys: CohortSystem): Map<string, number> {
  const out = new Map<string, number>();
  for (const [poi, sc] of sys.cohortsByPoi()) out.set(poi, cohortPopulation(sc));
  return out;
}

describe('CohortSystem', () => {
  it('registers at the day-keyed lifecycle cadence and joins both seams', () => {
    const sys = new CohortSystem();
    expect(sys.name).toBe('cohorts');
    expect(sys.tickHz).toBe(GAME_HOUR_HZ);
    const scheduler = new Scheduler();
    const registry = new SystemStateRegistry();
    scheduler.register(sys);
    registry.register(sys); // SerializableSystem — snapshot/scrub restores the ledger
    expect(registry.size()).toBe(1);
  });

  it('initializes by census from the living named population', () => {
    const world = new World(emptyMap());
    addAdult(world, 'a', 'village', 30);
    addAdult(world, 'b', 'village', 8);
    addAdult(world, 'c', 'hamlet', 70);
    const sys = new CohortSystem();
    sys.tick(ctxFor(world, 1));
    expect(ledgerTotals(sys)).toEqual(new Map([['village', 2], ['hamlet', 1]]));
    expect(sys.ledgerCounters().violations).toBe(0);
  });

  it('conserves souls under births (BirthSystem shadowed live)', () => {
    const world = new World(emptyMap());
    addAdult(world, 'mum', 'village', 28);
    addAdult(world, 'dad', 'village', 31);
    const ctx = ctxFor(world, 5);
    const births = new Set<string>();
    ctx.log.subscribe((a: { event: SimEvent }) => { if (a.event.type === 'npc_birth') births.add(a.event.npcId); });
    const birthSys = new BirthSystem();
    const sys = new CohortSystem();
    sys.tick({ ...ctx, now: 0 }); // baseline census
    for (let t = 1; t <= 100_000 && births.size === 0; t++) {
      birthSys.tick({ ...ctx, now: t });
      sys.tick({ ...ctx, now: t });
    }
    expect(births.size).toBeGreaterThan(0); // non-vacuous
    expect(sys.ledgerCounters().births).toBe(births.size);
    expect(sys.ledgerCounters().violations).toBe(0);
    expect(ledgerTotals(sys).get('village')).toBe(queryNpcs(world).length);
  });

  it('conserves souls under deaths (killNpc leaves remains, ledgered as a death)', () => {
    const world = new World(emptyMap());
    addAdult(world, 'a', 'village', 30);
    addAdult(world, 'b', 'village', 40);
    const elder = addAdult(world, 'c', 'village', 90);
    const ctx = ctxFor(world, 7);
    const sys = new CohortSystem();
    sys.tick({ ...ctx, now: 0 });
    killNpc(world, elder, 100, 'old_age', ctx.log);
    sys.tick({ ...ctx, now: 200 });
    expect(sys.ledgerCounters().deaths).toBe(1);
    expect(sys.ledgerCounters().violations).toBe(0);
    expect(ledgerTotals(sys).get('village')).toBe(2);
  });

  it('ledgers a home-bucket change as migration, not a mint/vanish', () => {
    const world = new World(emptyMap());
    const a = addAdult(world, 'a', 'village', 30);
    addAdult(world, 'b', 'village', 40);
    const ctx = ctxFor(world, 3);
    const sys = new CohortSystem();
    sys.tick({ ...ctx, now: 0 });
    npcProps(a).homePoiId = 'hamlet';
    sys.tick({ ...ctx, now: 100 });
    expect(sys.ledgerCounters().migrations).toBe(1);
    expect(sys.ledgerCounters().violations).toBe(0);
    expect(ledgerTotals(sys)).toEqual(new Map([['village', 1], ['hamlet', 1]]));
  });

  it('trips the invariant when a soul appears outside the lifecycle seams', () => {
    const world = new World(emptyMap());
    addAdult(world, 'a', 'village', 30);
    const elder = addAdult(world, 'b', 'village', 85);
    const ctx = ctxFor(world, 9);
    const errors: string[] = [];
    ctx.log.subscribe((e: { event: SimEvent }) => {
      if (e.event.type === 'system_error') errors.push(e.event.message);
    });
    const sys = new CohortSystem();
    sys.tick({ ...ctx, now: 0 });
    killNpc(world, elder, 50, 'old_age', ctx.log); // real log traffic (explained)
    addAdult(world, 'minted', 'village', 25);      // NO event — souls from nowhere
    sys.tick({ ...ctx, now: 100 });
    expect(sys.ledgerCounters().violations).toBe(1);
    expect(errors.some(m => m.includes('conservation of souls'))).toBe(true);
    // Self-heals: the shadow re-adopts the census, so the NEXT check is clean.
    sys.tick({ ...ctx, now: 200 });
    expect(sys.ledgerCounters().violations).toBe(1);
  });

  it('stays silent during replay (SilentEventLog) — flows observed, not re-audited', () => {
    const world = new World(emptyMap());
    const mum = addAdult(world, 'mum', 'village', 28);
    const dad = addAdult(world, 'dad', 'village', 31);
    const ctx = ctxFor(world, 11);
    const sys = new CohortSystem();
    sys.tick({ ...ctx, now: 0 });
    // Replay path: lifecycle runs against a silent log (no events recorded).
    const silent = new SilentEventLog(ctx.clock);
    birthNpc(world, [mum, dad], 100, ctx.rng, silent);
    sys.tick({ ...ctx, log: silent, now: 200 });
    expect(sys.ledgerCounters().births).toBe(1);
    expect(sys.ledgerCounters().violations).toBe(0);
    expect(ledgerTotals(sys).get('village')).toBe(3);
  });

  it('is deterministic: same seed → byte-identical serialized ledger', () => {
    const run = () => {
      const world = new World(emptyMap());
      addAdult(world, 'mum', 'village', 28);
      addAdult(world, 'dad', 'village', 31);
      addAdult(world, 'elder1', 'village', 88);
      addAdult(world, 'elder2', 'hamlet', 92);
      const ctx = ctxFor(world, 123);
      const birthSys = new BirthSystem();
      const mortalitySys = new MortalitySystem();
      const sys = new CohortSystem();
      for (let t = 0; t < 20_000; t++) {
        mortalitySys.tick({ ...ctx, now: t });
        birthSys.tick({ ...ctx, now: t });
        sys.tick({ ...ctx, now: t });
      }
      return JSON.stringify(sys.serialize());
    };
    expect(run()).toBe(run());
  });

  it('round-trips through serialize/hydrate (the WP-D snapshot seam)', () => {
    const world = new World(emptyMap());
    addAdult(world, 'a', 'village', 30);
    const elder = addAdult(world, 'b', 'village', 90);
    const ctx = ctxFor(world, 13);
    const sys = new CohortSystem();
    sys.tick({ ...ctx, now: 0 });
    killNpc(world, elder, 50, 'old_age', ctx.log);
    sys.tick({ ...ctx, now: 100 });
    const dump = structuredClone(sys.serialize());

    const restored = new CohortSystem();
    restored.hydrate(dump);
    expect(JSON.stringify(restored.serialize())).toBe(JSON.stringify(dump));
    // A restored ledger diffs cleanly against the unchanged world.
    restored.tick({ ...ctx, now: 200 });
    expect(restored.ledgerCounters().violations).toBe(0);
    expect(restored.ledgerCounters().deaths).toBe(1); // counters carried across

    // Absent field (old save) → full reset, re-census on the next tick —
    // rebuild-on-load, no SAVE_VERSION bump.
    restored.hydrate(undefined);
    expect(restored.cohortsByPoi().size).toBe(0);
    expect(restored.ledgerCounters().deaths).toBe(0);
    restored.tick({ ...ctx, now: 300 });
    expect(ledgerTotals(restored).get('village')).toBe(1);
    expect(restored.ledgerCounters().violations).toBe(0);
  });
});
