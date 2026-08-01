/**
 * The meaning economy (interaction-scaling S2c).
 *
 * The defect these pin: `meaning` eroded on a 250-real-second clock and nothing
 * mortal restored it, so every soul crossed its worship line within ~35 seconds
 * and prayed FOREVER — measured at 99.04% of all NPC-time in `worship`, with
 * `socialize` firing zero times in a game-hour. Because a praying mortal cannot
 * work, sleep or socialize, the other three needs then collapsed behind it, and
 * `COMFORT_THRESHOLD` (every need > 0.6) became unreachable, which killed
 * VISION §4's counter-loop — "comfort kills belief" — outright.
 *
 * Both halves of that loop are asserted here: mortals can get off their knees on
 * their own (the communal rite), and they can NEVER reach contentment that way
 * (the ceiling) — so a god is still the only road to secularization.
 */
import { describe, it, expect } from 'vitest';
import {
  NpcActivitySystem, standingPlea, prayerSubject, WORSHIP_THRESHOLDS,
  PLEA_SETTLE_MARGIN, MORTAL_MEANING_CEILING, RITE_MEANING_RESTORE,
} from '@/sim/systems/npc-activity-system';
import { tickNpcEntity, MEANING_DECAY, SAFETY_DECAY, PROSPERITY_DECAY, COMMUNITY_DECAY, FIRES_PER_DAY } from '@/sim/npc-sim';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { SilentEventLog } from '@/core/events';
import { tickAtSolarHour } from '@/core/calendar';
import type { Entity, GameMap, Tile, NpcProperties } from '@/core/types';

const VX = 30, VY = 30;

/** A map whose `village` plan puts the well (the gathering tile the venue-bound
 *  errands walk to) at (VX,VY) — what `marketAnchorTile` resolves. */
function mapWithVenue(w = 60, h = 60): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map = { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null,
    stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap & { settlementPlans: unknown[] };
  map.settlementPlans = [{
    poiId: 'village', center: { x: VX, y: VY }, nodes: [], edges: [], slots: [], lots: [],
    wards: [], market: [], civics: [{ type: 'well', x: VX, y: VY, w: 1, h: 1 }],
  }] as never;
  return map;
}

/** A villager standing at (x,y). Needs are stated, never inherited from the
 *  seeded jitter, so every assertion below is about the mechanism. */
function villager(world: World, id: string, x: number, y: number, needs: Partial<NpcProperties['needs']> = {}): Entity {
  const p = initNpcProps(id, 'farmer', 11);
  p.homeX = VX; p.homeY = VY; p.homePoiId = 'village';
  p.needs = { safety: 0.9, prosperity: 0.9, community: 0.9, meaning: 0.9, ...needs };
  const e: Entity = { id, kind: 'npc', x, y, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

/** The system with its map wired (`World` does not re-expose the map, and a
 *  null mapGetter degrades to the no-venue fallback where every mortal is
 *  trivially "at" its venue — which would silently void the arrival test). */
function sysFor(map: GameMap): NpcActivitySystem {
  return new NpcActivitySystem(() => map);
}

function ctx(world: World, seed = 5) {
  const tick = tickAtSolarHour(12); // midday — never the night branch
  return {
    world, spirits: new Map(), log: new SilentEventLog(null as never),
    clock: { now: () => tick, advance: () => {} } as never,
    rng: createRng(seed), dt: 1000, now: tick,
  } as never;
}

describe('need erosion is denominated per DAY (1:1 realtime)', () => {
  it('a full measure of meaning erodes in about a day, not four minutes', () => {
    // The pre-R8 constant (0.004/fire x a 240-fire day) meant ~1.0/day. Under the
    // honest 24h day the same literal emptied `meaning` in 250 REAL seconds.
    expect(MEANING_DECAY * FIRES_PER_DAY).toBeCloseTo(1.0, 6);
    expect(1 / MEANING_DECAY).toBeGreaterThan(20 * 3600); // > 20 real hours to empty
  });

  it('every need erodes on a human timescale', () => {
    for (const d of [MEANING_DECAY, SAFETY_DECAY, PROSPERITY_DECAY, COMMUNITY_DECAY]) {
      expect(d * FIRES_PER_DAY).toBeLessThanOrEqual(1.0);   // at most a full measure a day
      expect(d).toBeGreaterThan(0);
    }
  });
});

describe('the communal rite (the mortal channel for meaning)', () => {
  it('lifts a praying mortal at the shrine', () => {
    const map = mapWithVenue();
    const world = new World(map);
    const e = villager(world, 'a', VX, VY, { meaning: 0.29 });
    npcProps(e).activity = 'worship';
    npcProps(e).activityDuration = 0;

    sysFor(map).tick(ctx(world));

    expect(npcProps(e).needs.meaning).toBeCloseTo(0.29 + RITE_MEANING_RESTORE, 8);
  });

  it('is EARNED — no rite for a mortal that never reached the green', () => {
    const map = mapWithVenue();
    const world = new World(map);
    const e = villager(world, 'a', 2, 2, { meaning: 0.29 });   // across town
    npcProps(e).activity = 'worship';
    npcProps(e).activityDuration = 0;

    sysFor(map).tick(ctx(world));

    expect(npcProps(e).needs.meaning).toBe(0.29);
  });

  it('outruns the erosion, which is what sets the worship duty cycle', () => {
    // duty = decay/rite: a mortal in a spiritual crisis spends about a quarter of
    // its day at the shrine. Change this ratio to change the congregation.
    expect(RITE_MEANING_RESTORE / MEANING_DECAY).toBeCloseTo(4, 6);
  });

  it('can never carry a mortal to contentment — gods own the top of the range', () => {
    const map = mapWithVenue();
    const world = new World(map);
    const e = villager(world, 'a', VX, VY, { meaning: MORTAL_MEANING_CEILING - RITE_MEANING_RESTORE / 2 });
    npcProps(e).activity = 'worship';
    npcProps(e).activityDuration = 0;
    const sys = sysFor(map);

    for (let i = 0; i < 50; i++) sys.tick(ctx(world));

    expect(npcProps(e).needs.meaning).toBe(MORTAL_MEANING_CEILING);
    expect(MORTAL_MEANING_CEILING).toBeLessThan(0.6);  // < COMFORT_THRESHOLD (npc-sim)
  });
});

describe('a plea is a state, not a threshold sample', () => {
  it('stands after the need has crossed back over the worship line', () => {
    const p = initNpcProps('a', 'farmer', 3);
    p.needs = { safety: 0.9, prosperity: 0.9, community: 0.9, meaning: 0.35 };
    p.activity = 'worship';
    p.prayerNeed = 'meaning';

    // A bare threshold has already let go here — the plea has not.
    expect(prayerSubject(p.needs)).toBeNull();
    expect(standingPlea(p)).toBe('meaning');
  });

  it('settles once the need has recovered PLEA_SETTLE_MARGIN past the line', () => {
    const p = initNpcProps('a', 'farmer', 3);
    p.needs = { safety: 0.9, prosperity: 0.9, community: 0.9, meaning: WORSHIP_THRESHOLDS.meaning + PLEA_SETTLE_MARGIN };
    p.activity = 'worship';
    p.prayerNeed = 'meaning';

    expect(standingPlea(p)).toBeNull();
  });

  it('a need the mortal can serve itself never becomes a plea (tenet 9)', () => {
    // S2c: without this gate a material plea is a one-way door — praying
    // pre-empts the errand that would end it. A farmer with a workable farm
    // WORKS, however hungry; only futile work (M0.c, a lord taking everything)
    // sends it to its knees over bread.
    const p = initNpcProps('a', 'farmer', 3);
    p.needs = { safety: 0.9, prosperity: 0.05, community: 0.9, meaning: 0.9 };

    expect(prayerSubject(p.needs)).toBe('prosperity');
    expect(prayerSubject(p.needs, new Set(['prosperity']))).toBeNull();
  });

  it('a fresh, more urgent need pre-empts a standing plea', () => {
    const p = initNpcProps('a', 'farmer', 3);
    p.needs = { safety: 0.05, prosperity: 0.9, community: 0.9, meaning: 0.35 };
    p.activity = 'worship';
    p.prayerNeed = 'meaning';

    expect(standingPlea(p)).toBe('safety');   // raiders interrupt a mourner
  });

  it('does not stand for a mortal that was not praying', () => {
    const p = initNpcProps('a', 'farmer', 3);
    p.needs = { safety: 0.9, prosperity: 0.9, community: 0.9, meaning: 0.35 };
    p.activity = 'work';
    p.prayerNeed = 'meaning';   // stale stamp

    expect(standingPlea(p)).toBeNull();
  });

  it('is what lets a god push a mortal past the comfort line', () => {
    // ANSWER_PRAYER_NEED_BOOST is 0.3. Against a bare threshold a god could only
    // ever answer a mortal sitting at exactly 0.3, landing it at exactly
    // COMFORT_THRESHOLD and never above — so "comfort kills belief" could not
    // fire at all. Answering partway through a standing plea over-serves.
    expect(WORSHIP_THRESHOLDS.meaning + PLEA_SETTLE_MARGIN + 0.3).toBeGreaterThan(0.6);
  });
});

describe('the settlement gets off its knees', () => {
  it('a godless mortal prays, is lifted by the rite, and returns to life', () => {
    const map = mapWithVenue();
    const world = new World(map);
    const e = villager(world, 'a', VX, VY, { meaning: 0.31 });
    const sys = sysFor(map);
    const c = ctx(world);

    let prayed = false;
    let released = -1;
    // Two real hours is ample: the plea opens within minutes and the rite settles
    // it in well under an hour of shrine-time at this ceiling.
    for (let s = 0; s < 2 * 3600; s++) {
      sys.tick(c);
      tickNpcEntity(e);
      const p = npcProps(e);
      if (p.activity === 'worship') prayed = true;
      else if (prayed && released < 0) released = s;
    }

    expect(prayed).toBe(true);                       // the need did drive a prayer
    expect(released).toBeGreaterThan(0);             // and the mortal got back up
    expect(npcProps(e).needs.meaning).toBeGreaterThan(WORSHIP_THRESHOLDS.meaning);
    expect(npcProps(e).needs.meaning).toBeLessThanOrEqual(MORTAL_MEANING_CEILING);
  });

  it('and a god who answers is still the only way past the ceiling', () => {
    const world = new World(mapWithVenue());
    const e = villager(world, 'a', VX, VY, { meaning: 0.45 });
    const p = npcProps(e);
    p.activity = 'worship';
    p.prayerNeed = 'meaning';
    p.activityDuration = 0;

    // What `answerPrayer` does to the need (src/sim/divine-actions.ts).
    p.needs.meaning = Math.min(1, p.needs.meaning + 0.3);

    expect(p.needs.meaning).toBeGreaterThan(MORTAL_MEANING_CEILING);
    expect(p.needs.meaning).toBeGreaterThan(0.6);   // over the comfort line
  });
});
