/**
 * P2 MaterializationSystem — extras inherit the shipped schedule for FREE.
 * A materialized resident at night sleeps toward home; a working role in daytime
 * heads to work — proving NpcActivitySystem drives them with no bespoke code.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefaultPacks } from '@/catalogue';
import { createRng } from '@/core/rng';
import type { SimClock } from '@/core/clock';
import { tickAtSolarHour } from '@/core/calendar';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { makeHarness } from './materialization-harness';

beforeAll(() => loadDefaultPacks());

function runActivity(h: ReturnType<typeof makeHarness>, hour: number): void {
  const tick = tickAtSolarHour(hour);
  const clock = { now: () => tick } as unknown as SimClock;
  new NpcActivitySystem().tick({ world: h.world, spirits: new Map(), log: h.log, clock, rng: createRng(3), dt: 1000, now: tick });
}

describe('MaterializationSystem schedule inheritance', () => {
  it('a materialized resident sleeps toward home at night', () => {
    const h = makeHarness({ cottages: 12, souls: 40 });
    h.materializeFully('village');
    runActivity(h, 23);
    const extra = queryNpcs(h.world).find(e => npcProps(e).materializedTemp === true)!;
    const p = npcProps(extra);
    expect(p.activity).toBe('sleep');
    expect(p.activityTargetX).toBe(p.homeX);
    expect(p.activityTargetY).toBe(p.homeY);
  });

  it('a working-role extra heads to work in daytime', () => {
    const h = makeHarness({ cottages: 12, souls: 40 });
    h.materializeFully('village');
    runActivity(h, 12);
    const worker = queryNpcs(h.world).find(e => {
      const p = npcProps(e);
      return p.materializedTemp === true && (p.role === 'farmer' || p.role === 'merchant');
    })!;
    const p = npcProps(worker);
    expect(p.activity).toBe('work');
    expect(Math.abs((p.activityTargetX ?? 0) - p.homeX)).toBeLessThanOrEqual(2);
  });
});
