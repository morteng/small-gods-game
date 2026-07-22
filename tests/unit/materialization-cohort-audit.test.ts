/**
 * P2 MaterializationSystem — CohortSystem audit stays green across a
 * materialize+fold cycle (the audit relaxation lands with the system); focus
 * null (headless replay) materializes nothing; and materialized extras are
 * excluded from BirthSystem/MortalitySystem subject-picking (no lifecycle
 * distortion, focus-independent rng).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefaultPacks } from '@/catalogue';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng, type Rng } from '@/core/rng';
import { CohortSystem } from '@/sim/systems/cohort-system';
import { BirthSystem } from '@/sim/systems/birth-system';
import { MortalitySystem } from '@/sim/systems/mortality-system';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import { initNpcProps } from '@/world/npc-helpers';
import type { Entity } from '@/core/types';
import { makeHarness, addNamed } from './materialization-harness';

beforeAll(() => loadDefaultPacks());

function countingRng(seed: number): { rng: Rng; calls: () => number } {
  const base = createRng(seed);
  let n = 0;
  const rng: Rng = {
    next() { n++; return base.next(); },
    nextInt(m) { return base.nextInt(m); },
    pick(a) { return base.pick(a); },
    getState() { return base.getState(); },
  };
  return { rng, calls: () => n };
}

function addFertile(world: World, id: string, poiId: string, materialized: boolean): Entity {
  const p = initNpcProps(id, 'farmer', (id.charCodeAt(0) * 71) | 0);
  p.homePoiId = poiId;
  p.homeX = 6; p.homeY = 6;
  p.birthTick = -30 * TICKS_PER_YEAR;   // fertile adult
  p.lineageId = id;
  if (materialized) p.materializedTemp = true;
  const e: Entity = { id, kind: 'npc', x: 6, y: 6, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

describe('MaterializationSystem × CohortSystem audit', () => {
  it('a materialize+fold cycle logs zero conservation violations', () => {
    const h = makeHarness({ cottages: 12, souls: 40 });
    addNamed(h.world, 'named-a', 'village', 30);
    addNamed(h.world, 'named-b', 'village', 40);

    const cohortSys = new CohortSystem(() => h.cohorts);
    const violations = () => {
      let v = 0;
      for (const e of h.log.since(0)) if (e.event.type === 'system_error') v++;
      return v;
    };
    const tickCohorts = (now: number) =>
      cohortSys.tick({ world: h.world, spirits: new Map(), log: h.log, clock: h.clock, rng: createRng(9), dt: 1000, now });

    tickCohorts(0);                     // baseline census + statBaseline
    h.materializeFully('village');      // draws souls → souls_materialized + named entities
    tickCohorts(1_000_000);             // audit the materialize window
    expect(violations()).toBe(0);

    h.foldFully();                      // banks souls back → souls_folded
    tickCohorts(2_000_000);             // audit the fold window
    expect(violations()).toBe(0);
    // Cohort whole again.
    let pop = 0; for (const b of h.cohorts.get('village')!.bands) pop += b.count;
    expect(pop).toBe(40);
  });

  it('focus null (headless replay) materializes nothing', () => {
    const h = makeHarness({ cottages: 12, souls: 40 });
    for (let i = 0; i < 20; i++) h.tick(h.now + 100);   // never focus
    expect(h.liveCount('village')).toBe(0);
    expect(queryNpcs(h.world).length).toBe(0);
  });

  it('BirthSystem excludes materialized extras from parenting (focus-independent rng)', () => {
    const world = new World({ tiles: [], width: 8, height: 8, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as never);
    addFertile(world, 'n1', 'v', false);
    addFertile(world, 'n2', 'v', false);
    addFertile(world, 'n3', 'v', false);
    addFertile(world, 'n4', 'v', false);            // 4 named ⇒ 2 fertile pairs ⇒ 2 draws
    for (let i = 0; i < 10; i++) addFertile(world, `m${i}`, 'v', true);   // extras: must NOT add draws

    const { rng, calls } = countingRng(1);
    const clock = new SimClock(); const log = new EventLog(clock);
    new BirthSystem().tick({ world, spirits: new Map(), log, clock, rng, dt: 1000, now: 1000 });
    expect(calls()).toBe(2);            // exactly the named pairs — extras excluded
  });

  it('MortalitySystem excludes materialized extras from death candidates', () => {
    const world = new World({ tiles: [], width: 8, height: 8, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as never);
    for (let i = 0; i < 5; i++) addFertile(world, `n${i}`, 'v', false);   // 5 named candidates
    for (let i = 0; i < 10; i++) addFertile(world, `m${i}`, 'v', true);   // excluded

    const { rng, calls } = countingRng(2);
    const clock = new SimClock(); const log = new EventLog(clock);
    new MortalitySystem().tick({ world, spirits: new Map(), log, clock, rng, dt: 1000, now: 1000 });
    expect(calls()).toBe(5);            // one draw per NAMED living soul only
  });
});
