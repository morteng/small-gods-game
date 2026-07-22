/**
 * P2 slice 2 — workers + home↔work commute.
 *
 * Materialized working-age extras in a settlement WITH worker buildings get a
 * `workX/workY` commute target (index-driven, fold-stable, rng-free); the
 * NpcActivitySystem walks them there by day and home to sleep at night. A
 * workless hamlet leaves every extra working from home (no regression). The
 * job-slot list is a deterministic round-robin over worker capacity.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { World } from '@/world/world';
import { loadDefaultPacks } from '@/catalogue';
import { tickAtSolarHour } from '@/core/calendar';
import { createRng } from '@/core/rng';
import { workplaceSlots } from '@/sim/materialization';
import { settlementDraws } from '@/sim/population/settlement-demand';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { initNpcProps, npcProps, forEachNpc } from '@/world/npc-helpers';
import type { Entity } from '@/core/types';
import { makeHarness, grassMap, workplaces } from './materialization-harness';

const JOB_KINDS = ['smithy', 'market_stall', 'bakehouse'];

beforeAll(() => loadDefaultPacks()); // workplace presets classify from catalogue fields

function withJobs(souls = 40) {
  return makeHarness({ cottages: 10, souls, extraBuildings: workplaces('village', JOB_KINDS) });
}

describe('workplaceSlots — job-slot list', () => {
  it('is empty for a settlement with no worker buildings', () => {
    const map = grassMap([], 'village');
    expect(workplaceSlots(map, 'village', 64)).toEqual([]);
  });

  it('repeats each workplace by its worker capacity, round-robined across sites', () => {
    const map = grassMap(workplaces('village', JOB_KINDS), 'village');
    const draws = settlementDraws(map, 'village').filter(d => d.workers > 0);
    const totalCap = draws.reduce((a, d) => a + Math.round(d.workers), 0);
    const slots = workplaceSlots(map, 'village', 64);
    expect(slots.length).toBe(totalCap);
    // First N slots (N = number of sites) hit distinct buildings — round-robin.
    const firstRound = new Set(slots.slice(0, draws.length).map(s => s.buildingId));
    expect(firstRound.size).toBe(draws.length);
  });

  it('caps the list at `cap`', () => {
    const map = grassMap(workplaces('village', JOB_KINDS), 'village');
    expect(workplaceSlots(map, 'village', 2).length).toBe(2);
  });

  it('is deterministic', () => {
    const map = grassMap(workplaces('village', JOB_KINDS), 'village');
    const a = workplaceSlots(map, 'village', 64).map(s => s.buildingId);
    const b = workplaceSlots(map, 'village', 64).map(s => s.buildingId);
    expect(a).toEqual(b);
  });
});

describe('MaterializationSystem — worker commute assignment', () => {
  it('assigns workX/workY to some working-age extras when jobs exist', () => {
    const h = withJobs();
    h.materializeFully('village');
    let withWork = 0, total = 0;
    forEachNpc(h.world, (e) => {
      const p = npcProps(e);
      if (p.materializedTemp !== true) return;
      total++;
      if (p.workX !== undefined && p.workY !== undefined) withWork++;
    });
    expect(total).toBeGreaterThan(0);
    expect(withWork).toBeGreaterThan(0);
  });

  it('never assigns more workers than the settlement job capacity', () => {
    const h = withJobs();
    const cap = workplaceSlots(h.map, 'village', 1000).length;
    h.materializeFully('village');
    let withWork = 0;
    forEachNpc(h.world, (e) => {
      const p = npcProps(e);
      if (p.materializedTemp === true && p.workX !== undefined) withWork++;
    });
    expect(withWork).toBeLessThanOrEqual(cap);
  });

  it('only working-age roles (farmer/merchant) carry a workplace', () => {
    const h = withJobs();
    h.materializeFully('village');
    forEachNpc(h.world, (e) => {
      const p = npcProps(e);
      if (p.materializedTemp === true && p.workX !== undefined) {
        expect(['farmer', 'merchant']).toContain(p.role);
      }
    });
  });

  it('leaves every extra workless in a settlement with no jobs', () => {
    const h = makeHarness({ cottages: 12, souls: 40 }); // cottages only → workers:0
    h.materializeFully('village');
    forEachNpc(h.world, (e) => {
      const p = npcProps(e);
      if (p.materializedTemp === true) expect(p.workX).toBeUndefined();
    });
  });

  it('workplace tiles are on-map land tiles', () => {
    const h = withJobs();
    h.materializeFully('village');
    forEachNpc(h.world, (e) => {
      const p = npcProps(e);
      if (p.materializedTemp === true && p.workX !== undefined) {
        expect(p.workX).toBeGreaterThanOrEqual(0);
        expect(p.workX!).toBeLessThan(h.map.width);
        expect(p.workY!).toBeGreaterThanOrEqual(0);
        expect(p.workY!).toBeLessThan(h.map.height);
      }
    });
  });

  it('is deterministic — same seed reproduces the same work assignments', () => {
    const capture = () => {
      const h = withJobs();
      h.materializeFully('village');
      const out: Record<string, string> = {};
      forEachNpc(h.world, (e) => {
        const p = npcProps(e);
        if (p.materializedTemp === true) out[e.id] = `${p.workX ?? '-'},${p.workY ?? '-'}`;
      });
      return out;
    };
    expect(capture()).toEqual(capture());
  });

  it('folds workX-bearing extras back cleanly (conservation intact)', () => {
    const h = withJobs();
    const before = cohortTotal(h);
    h.materializeFully('village');
    h.foldFully();
    expect(cohortTotal(h)).toBeCloseTo(before, 6);
    expect(h.liveCount('village')).toBe(0);
  });
});

describe('NpcActivitySystem — commute to workplace', () => {
  it('a working NPC with workX heads to the workplace by day, home by night', () => {
    const map = grassMap([], 'village');
    const world = new World(map);
    const p = initNpcProps('w', 'farmer', 7);
    p.homeX = 6; p.homeY = 6; p.workX = 22; p.workY = 22;
    p.activityDuration = 0; p.needs = { safety: 0.9, prosperity: 0.9, community: 0.9, meaning: 0.9 };
    const e: Entity = { id: 'w', kind: 'npc', x: 6, y: 6, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);
    const sys = new NpcActivitySystem();

    // Daytime tick (noon) → work target near the workplace.
    sys.tick(ctx(world, tickAtSolarHour(12)));
    const day = npcProps(e);
    expect(day.activity).toBe('work');
    expect(Math.abs(day.activityTargetX! - 22)).toBeLessThanOrEqual(1);
    expect(Math.abs(day.activityTargetY! - 22)).toBeLessThanOrEqual(1);

    // Night tick → sleep at home.
    npcProps(e).activityDuration = 0;
    sys.tick(ctx(world, tickAtSolarHour(23)));
    const night = npcProps(e);
    expect(night.activity).toBe('sleep');
    expect(night.activityTargetX).toBe(6);
    expect(night.activityTargetY).toBe(6);
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────
function cohortTotal(h: ReturnType<typeof withJobs>): number {
  let t = 0;
  const sc = h.cohorts.get('village')!;
  for (const b of sc.bands) t += b.count;
  return t;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctx(world: World, tick: number): any {
  const clock = { now: () => tick, advance: () => {} };
  return { world, spirits: new Map(), log: { append() {} }, clock, rng: createRng(3), dt: 1000, now: tick };
}
