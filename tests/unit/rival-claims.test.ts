import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { CommandQueue } from '@/sim/command/command-queue';
import { CommandExecutorSystem } from '@/sim/command/command-system';
import { RivalSystem } from '@/sim/systems/rival-system';
import { createRng, type Rng } from '@/core/rng';
import {
  buildRivalSituation, updatePrayerLedger, prayerAge, eligibleClaimants,
  findClaimablePrayers, PRAYER_CLAIM_WINDOW_TICKS, PRAYER_CLAIM_WARNING_TICKS,
} from '@/sim/rival-claims';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { SystemContext } from '@/core/scheduler';

// ── scaffolding ──────────────────────────────────────────────────────────────
function tinyMap(): GameMap {
  const tiles = [] as GameMap['tiles'];
  for (let y = 0; y < 3; y++) {
    const row = [];
    for (let x = 0; x < 3; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row as never);
  }
  return { tiles, width: 3, height: 3, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function npc(id: string, poiId: string, patch: Partial<NpcProperties> = {}): Entity {
  const p = initNpcProps(id, 'farmer', id.charCodeAt(0)) as NpcProperties;
  p.homePoiId = poiId;
  Object.assign(p, patch);
  return { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
}
function P(e: Entity): NpcProperties { return e.properties as unknown as NpcProperties; }

function rival(id: string, power: number, settlements: string[]): Spirit {
  return {
    id, name: 'Sablethorn', sigil: '◆', color: '#a0f', isPlayer: false, power, manifestation: null,
    ai: {
      policy: 'coexist', cooldowns: {},
      personality: { aggression: 0.2, subtlety: 0.5, territoriality: 0.5, assertiveness: 0.3, jealousy: 0.3 },
      settlements, lastActionTick: 0, actionCooldown: 0,
    },
  };
}
function player(power = 0): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power, manifestation: null };
}
function ctx(world: World, spirits: Map<SpiritId, Spirit>, rng: Rng, now: number): SystemContext {
  return { world, spirits, log: new EventLog(new SimClock()), clock: new SimClock(), rng, dt: 2000, now };
}

// ── situation builder ────────────────────────────────────────────────────────
describe('buildRivalSituation', () => {
  it('counts player + rival followers per settlement and maps the rival belief', () => {
    const world = new World(tinyMap());
    world.addEntity(npc('a', 'poi1', { beliefs: { player: { faith: 0.8, understanding: 0.3, devotion: 0.2 } } }));
    world.addEntity(npc('b', 'poi1', { beliefs: { player: { faith: 0.05, understanding: 0, devotion: 0 }, 'rival-1': { faith: 0.5, understanding: 0.1, devotion: 0.1 } } }));
    world.addEntity(npc('c', 'poi2', { beliefs: { 'rival-1': { faith: 0.9, understanding: 0.2, devotion: 0.3 } } }));
    const spirits = new Map<SpiritId, Spirit>([['player', player(7)], ['rival-1', rival('rival-1', 10, ['poi1'])]]);

    const sit = buildRivalSituation(world, spirits, 'rival-1');
    expect(sit.playerPower).toBe(7);
    expect(sit.playerFollowersInSettlement).toEqual({ poi1: 1 }); // only 'a' clears the believer line
    expect(sit.rivalFollowersInSettlement).toEqual({ poi1: 1, poi2: 1 });
    expect(sit.npcBeliefs.get('b')?.faith).toBeCloseTo(0.5);
    expect(sit.npcBeliefs.get('c')?.faith).toBeCloseTo(0.9);
    expect(sit.npcBeliefs.has('a')).toBe(false); // 'a' holds no rival belief
    // No baseline / no `now` supplied ⇒ trend + pressure read empty.
    expect(sit.rivalFollowerDelta).toEqual({});
    expect(sit.prayerPressureInSettlement).toEqual({});
  });

  it('reports follower deltas against a baseline and prayer pressure past the warning line', () => {
    const world = new World(tinyMap());
    const now = PRAYER_CLAIM_WARNING_TICKS + 100;
    world.addEntity(npc('a', 'poi1', { beliefs: { 'rival-1': { faith: 0.8, understanding: 0.2, devotion: 0.2 } } }));
    // Aged plea (past the warning line) and a fresh one (below it).
    world.addEntity(npc('b', 'poi1', { activity: 'worship', prayerSince: 0 }));
    world.addEntity(npc('c', 'poi2', { activity: 'worship', prayerSince: now - 10 }));
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rival('rival-1', 10, ['poi1'])]]);

    const sit = buildRivalSituation(world, spirits, 'rival-1', {
      now,
      baseline: { poi1: 3, poi2: 0 },   // had 3 in poi1 a window ago, now 1
    });
    expect(sit.rivalFollowerDelta).toEqual({ poi1: -2 });   // zero-delta poi2 omitted
    expect(sit.prayerPressureInSettlement).toEqual({ poi1: 1 }); // c's plea is only 10 ticks old
  });
});

// ── claim-window state machine ─────────────────────────────────────────────────
describe('prayer claim ledger', () => {
  it('stamps prayerSince on first observation and clears it when the plea lifts', () => {
    const world = new World(tinyMap());
    const e = npc('a', 'poi1', { activity: 'worship' });
    world.addEntity(e);

    updatePrayerLedger(world, 100);
    expect(P(e).prayerSince).toBe(100);

    updatePrayerLedger(world, 130);          // still worshipping → unchanged
    expect(P(e).prayerSince).toBe(100);
    expect(prayerAge(P(e), 130)).toBe(30);

    P(e).activity = 'idle';                  // plea lifts
    updatePrayerLedger(world, 140);
    expect(P(e).prayerSince).toBeUndefined();
    expect(prayerAge(P(e), 140)).toBe(0);
  });

  it('a prayer is claimable only after the window, by a present + funded rival', () => {
    const world = new World(tinyMap());
    const e = npc('a', 'poi1', { activity: 'worship', prayerSince: 0 });
    world.addEntity(e);
    const spirits = new Map<SpiritId, Spirit>([
      ['player', player()],
      ['rival-1', rival('rival-1', 10, ['poi1'])],   // present + funded
      ['rival-2', rival('rival-2', 10, ['poi2'])],   // funded but NOT present
    ]);
    const rng = createRng(1);

    // Before the window: nothing claimable.
    expect(findClaimablePrayers(world, spirits, PRAYER_CLAIM_WINDOW_TICKS - 1, rng)).toEqual([]);
    // Eligibility excludes the absent rival.
    expect(eligibleClaimants(e, spirits)).toEqual(['rival-1']);
    // At/after the window: rival-1 claims it.
    const claims = findClaimablePrayers(world, spirits, PRAYER_CLAIM_WINDOW_TICKS, rng);
    expect(claims).toEqual([{ npcId: 'a', rivalId: 'rival-1', poiId: 'poi1' }]);
  });

  it('an unfunded present rival cannot claim', () => {
    const world = new World(tinyMap());
    world.addEntity(npc('a', 'poi1', { activity: 'worship', prayerSince: 0 }));
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rival('rival-1', 0, ['poi1'])]]);
    expect(findClaimablePrayers(world, spirits, PRAYER_CLAIM_WINDOW_TICKS + 50, createRng(1))).toEqual([]);
  });

  it('is deterministic when multiple rivals are eligible (same seed ⇒ same claimant)', () => {
    const build = () => {
      const world = new World(tinyMap());
      world.addEntity(npc('a', 'poi1', { activity: 'worship', prayerSince: 0 }));
      const spirits = new Map<SpiritId, Spirit>([
        ['player', player()],
        ['rival-1', rival('rival-1', 10, ['poi1'])],
        ['rival-2', rival('rival-2', 10, ['poi1'])],
      ]);
      return findClaimablePrayers(world, spirits, PRAYER_CLAIM_WINDOW_TICKS, createRng(42));
    };
    expect(build()).toEqual(build());
    expect(['rival-1', 'rival-2']).toContain(build()[0].rivalId);
  });
});

// ── the headline: a claimed prayer shifts belief toward the rival ──────────────
describe('rival claims an unanswered prayer (end-to-end through the command queue)', () => {
  it('routes an answer_prayer command that raises the NPC faith in the rival and lifts the plea', () => {
    const world = new World(tinyMap());
    const e = npc('a', 'poi1', { activity: 'worship', prayerSince: 0 });
    world.addEntity(e);
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rival('rival-1', 10, ['poi1'])]]);
    const queue = new CommandQueue();
    const rng = createRng(1);

    // A decision tick well past the claim window.
    const now = PRAYER_CLAIM_WINDOW_TICKS + 10;
    new RivalSystem(queue).tick(ctx(world, spirits, rng, now));
    // The claim command is emitted (the rival may ALSO take a baseline action — fine).
    expect(queue.size()).toBeGreaterThanOrEqual(1);

    // Execute the queued command through the SAME executor the player uses.
    const log = new EventLog(new SimClock());
    new CommandExecutorSystem(queue).tick({ world, spirits, log, clock: new SimClock(), rng, dt: 16, now } as SystemContext);

    expect(P(e).beliefs['rival-1']).toBeDefined();
    expect(P(e).beliefs['rival-1'].faith).toBeGreaterThan(0); // belief shifted toward the rival
    expect(P(e).activity).toBe('idle');                        // answerPrayer lifted the plea
    expect(spirits.get('rival-1')!.power).toBeLessThan(10);    // the rival paid for it
    expect(log.since(0).some(a => a.event.type === 'answer_prayer' && a.event.spiritId === 'rival-1')).toBe(true);
  });

  it('does not claim a fresh prayer (below the window)', () => {
    const world = new World(tinyMap());
    world.addEntity(npc('a', 'poi1', { activity: 'worship' }));
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rival('rival-1', 10, ['poi1'])]]);
    const queue = new CommandQueue();
    // First tick stamps prayerSince = now; age is 0, so no claim yet.
    new RivalSystem(queue).tick(ctx(world, spirits, createRng(1), 5));
    const claimCmds = queue.drain().filter(c => c.verb === 'answer_prayer');
    expect(claimCmds).toEqual([]);
  });
});
