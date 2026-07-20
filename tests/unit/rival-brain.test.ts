/**
 * WP-A (round 7) — the rival BRAIN: strategies must consume the RivalSituation
 * (not just rng+power), and Fate's `set_rival_stance` coaching must provably
 * alter subsequent behaviour (policy derives live from personality).
 */
import { describe, it, expect } from 'vitest';
import {
  decideRivalAction,
  expandStrategy,
  defendStrategy,
  undermineStrategy,
  coexistStrategy,
  strategyForPersonality,
  AMBITION_BANK,
  type RivalSpirit,
  type RivalPersonality,
} from '@/sim/rival-spirit';
import type { RivalSituation } from '@/sim/rival-claims';
import { PRAYER_CLAIM_WARNING_TICKS } from '@/sim/rival-claims';
import { executeCommand } from '@/sim/command/command-system';
import { RivalSystem } from '@/sim/systems/rival-system';
import { CommandQueue } from '@/sim/command/command-queue';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng, type Rng } from '@/core/rng';
import type { ApplyCtx, Command } from '@/sim/command/types';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { SystemContext } from '@/core/scheduler';

// ── scaffolding ──────────────────────────────────────────────────────────────
function situation(patch: Partial<RivalSituation> = {}): RivalSituation {
  return {
    playerPower: 5,
    playerFollowersInSettlement: {},
    rivalFollowersInSettlement: {},
    rivalFollowerDelta: {},
    prayerPressureInSettlement: {},
    opposingFollowersInSettlement: {},
    otherRivals: [],
    npcBeliefs: new Map(),
    ...patch,
  };
}

function rivalView(personality: Partial<RivalPersonality> = {}, patch: Partial<RivalSpirit> = {}): RivalSpirit {
  const pers: RivalPersonality = {
    aggression: 0.5, subtlety: 0.5, territoriality: 0.5, assertiveness: 0.5, jealousy: 0.5,
    ...personality,
  };
  return {
    id: 'rival-1' as SpiritId,
    name: 'Sablethorn',
    personality: pers,
    strategy: strategyForPersonality(pers),
    power: 20,
    maxPower: 20,
    followers: [],
    settlements: ['poi-a', 'poi-b'],
    color: '#a0f',
    createdTick: 0,
    lastActionTick: 0,
    actionCooldown: 0,
    ...patch,
  };
}

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

function rivalSpirit(personality: Partial<RivalPersonality> = {}, settlements = ['poi1']): Spirit {
  const pers: RivalPersonality = {
    aggression: 0.5, subtlety: 0.5, territoriality: 0.5, assertiveness: 0.5, jealousy: 0.5,
    ...personality,
  };
  return {
    id: 'rival-1', name: 'Sablethorn', sigil: '◆', color: '#a0f', isPlayer: false, power: 10, manifestation: null,
    ai: {
      policy: strategyForPersonality(pers), cooldowns: {},
      personality: pers, settlements, lastActionTick: 0, actionCooldown: 0,
    },
  };
}
function player(): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 0, manifestation: null };
}
function sysCtx(world: World, spirits: Map<SpiritId, Spirit>, rng: Rng, now = 10): SystemContext {
  return { world, spirits, log: new EventLog(new SimClock()), clock: new SimClock(), rng, dt: 2000, now };
}
function applyCtx(spirits: Map<SpiritId, Spirit>): ApplyCtx {
  return { world: new World(tinyMap()), spirits, log: new EventLog(new SimClock()), rng: createRng(1), now: 0 };
}
function stanceCmd(payload: Record<string, unknown>): Command {
  return { verb: 'set_rival_stance', source: 'fate', target: { kind: 'none' }, payload, seq: 0 };
}

/** Run N decisions off ONE seeded rng and tally action types (null ⇒ 'none'). */
function tally(rival: RivalSpirit, sit: RivalSituation, seed: number, n = 100): Record<string, number> {
  const rng = createRng(seed);
  const out: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const a = decideRivalAction(rival, 1, sit, () => rng.next());
    out[a?.type ?? 'none'] = (out[a?.type ?? 'none'] ?? 0) + 1;
  }
  return out;
}

// ── 1. situations drive decisions ────────────────────────────────────────────
describe('strategies consume the RivalSituation', () => {
  it('expand presses the settlement where the OPPOSITION is WEAKEST (same rng, different situation ⇒ different target)', () => {
    // D5: expand now reads `opposingFollowersInSettlement` (all opposition),
    // not `playerFollowersInSettlement` alone — a real `buildRivalSituation`
    // keeps both in sync (the player's count folds into the opposing total).
    const rival = rivalView({ aggression: 0.9 });
    const weakInB = situation({
      playerFollowersInSettlement: { 'poi-a': 8, 'poi-b': 1 },
      opposingFollowersInSettlement: { 'poi-a': 8, 'poi-b': 1 },
    });
    const weakInA = situation({
      playerFollowersInSettlement: { 'poi-a': 1, 'poi-b': 8 },
      opposingFollowersInSettlement: { 'poi-a': 1, 'poi-b': 8 },
    });

    const a = expandStrategy(rival, weakInB, () => 0.1);
    const b = expandStrategy(rival, weakInA, () => 0.1);
    expect(a!.targetSettlementId).toBe('poi-b');
    expect(b!.targetSettlementId).toBe('poi-a');
  });

  it('expand counts ALL opposition, not just the player — a rival-only stronghold is pressed too', () => {
    // No player presence anywhere; a same-side rival dominates poi-z. The
    // known-empty poi-a should be preferred over poi-z (opposing count 0 < 9).
    const sit = situation({
      opposingFollowersInSettlement: { 'poi-z': 9 },
      otherRivals: [{ id: 'rival-2' as SpiritId, power: 5, followerTotal: 9, followersInSettlement: { 'poi-z': 9 } }],
    });
    const rivalWithTurf = rivalView({ aggression: 0.9 }, { settlements: ['poi-a', 'poi-z'] });
    const a = expandStrategy(rivalWithTurf, sit, () => 0.1);
    expect(a!.targetSettlementId).toBe('poi-a');
  });

  it('defend consolidates where it is LOSING ground, before any other concern', () => {
    const rival = rivalView({ aggression: 0.2, territoriality: 0.9 });
    const sit = situation({
      rivalFollowersInSettlement: { 'poi-a': 6, 'poi-b': 2 },
      rivalFollowerDelta: { 'poi-b': -3, 'poi-a': 1 },
      playerFollowersInSettlement: { 'poi-a': 5 },   // invaded, but bleeding matters more
    });
    const a = defendStrategy(rival, sit, () => 0.5);
    expect(a).not.toBeNull();
    expect(a!.type).toBe('proselytize');
    expect(a!.targetSettlementId).toBe('poi-b');
  });

  it('defend falls back to the most-invaded settlement when not losing ground', () => {
    const rival = rivalView({ aggression: 0.2, territoriality: 0.9 });
    const sit = situation({
      rivalFollowersInSettlement: { 'poi-a': 6, 'poi-b': 2 },
      playerFollowersInSettlement: { 'poi-b': 5, 'poi-a': 1 },
    });
    expect(defendStrategy(rival, sit, () => 0.5)!.targetSettlementId).toBe('poi-b');
  });

  it('undermine strikes the player STRONGHOLD, and stands down when the player holds nothing', () => {
    const rival = rivalView({ aggression: 0.6, subtlety: 0.2, jealousy: 0.9 });
    const strong = situation({ playerFollowersInSettlement: { 'poi-a': 2, 'poi-z': 9 } });
    const a = undermineStrategy(rival, strong, () => 0.1);
    expect(a!.type).toBe('discredit');
    expect(a!.targetSettlementId).toBe('poi-z');   // outside its own turf — jealousy travels
    expect(undermineStrategy(rival, situation(), () => 0.1)).toBeNull();
  });

  it('D5: undermine strikes the DOMINANT OTHER rival, not the player, when it dwarfs the player', () => {
    const rival = rivalView({ aggression: 0.6, subtlety: 0.2, jealousy: 0.9 });
    const sit = situation({
      playerFollowersInSettlement: { 'poi-a': 2 },
      otherRivals: [
        { id: 'rival-2' as SpiritId, power: 15, followerTotal: 20, followersInSettlement: { 'poi-x': 12, 'poi-y': 8 } },
      ],
    });
    const a = undermineStrategy(rival, sit, () => 0.1);
    expect(a!.type).toBe('discredit');
    expect(a!.targetSpiritId).toBe('rival-2');
    expect(a!.targetSettlementId).toBe('poi-x');   // rival-2's OWN strongest settlement
  });

  it('D5: a tie between the player and another rival keeps the player as victim (deterministic tie-break)', () => {
    const rival = rivalView({ aggression: 0.6, subtlety: 0.2, jealousy: 0.9 });
    const sit = situation({
      playerFollowersInSettlement: { 'poi-a': 10 },
      otherRivals: [
        { id: 'rival-2' as SpiritId, power: 15, followerTotal: 10, followersInSettlement: { 'poi-x': 10 } },
      ],
    });
    const a = undermineStrategy(rival, sit, () => 0.1);
    expect(a!.targetSpiritId).toBe('player');
    expect(a!.targetSettlementId).toBe('poi-a');
  });

  it('D5: picks the strongest of SEVERAL other rivals, id-sorted tie-break preserved', () => {
    const rival = rivalView({ aggression: 0.6, subtlety: 0.2, jealousy: 0.9 });
    const sit = situation({
      otherRivals: [
        { id: 'rival-2' as SpiritId, power: 5, followerTotal: 4, followersInSettlement: { 'poi-p': 4 } },
        { id: 'rival-3' as SpiritId, power: 5, followerTotal: 9, followersInSettlement: { 'poi-q': 9 } },
      ],
    });
    const a = undermineStrategy(rival, sit, () => 0.1);
    expect(a!.targetSpiritId).toBe('rival-3');
    expect(a!.targetSettlementId).toBe('poi-q');
  });

  it('coexist ministers where unanswered-prayer pressure is highest on its own turf', () => {
    const rival = rivalView({ aggression: 0.2, territoriality: 0.3 });
    const pressed = situation({ prayerPressureInSettlement: { 'poi-b': 4, 'poi-a': 1, 'poi-z': 9 } });
    const a = coexistStrategy(rival, pressed, () => 0.1);
    expect(a!.type).toBe('whisper');
    expect(a!.targetSettlementId).toBe('poi-b');   // poi-z is not its turf

    // No pressure anywhere ⇒ only the rare fallback word (rng 0.2 > 0.15 ⇒ nothing).
    expect(coexistStrategy(rival, situation(), () => 0.2)).toBeNull();
  });

  it('D3: wealth pressure raises the miracle chance ONLY above the ambition bank', () => {
    // Same personality, same target, same constant rng — the ONLY variable is
    // banked power. At the bank exactly, wealth pressure is 0 (0.2+0.5·0.5=0.45
    // < 0.5 ⇒ whisper). Well above it, the pressure term pushes past 0.5 ⇒ miracle.
    const sit = situation({ opposingFollowersInSettlement: { 'poi-a': 5 } });
    const rng = () => 0.5;
    const atBank = rivalView({ aggression: 0.5, assertiveness: 0.5 }, { power: AMBITION_BANK, settlements: ['poi-a'] });
    const wellAboveBank = rivalView({ aggression: 0.5, assertiveness: 0.5 }, { power: AMBITION_BANK * 2, settlements: ['poi-a'] });
    expect(expandStrategy(atBank, sit, rng)!.type).toBe('whisper');
    expect(expandStrategy(wellAboveBank, sit, rng)!.type).toBe('miracle');
  });

  it('D3: save-for-miracle holds the whisper ONLY when aggressive, half-to-full bank, AND the target is contested', () => {
    const contested = situation({
      opposingFollowersInSettlement: { 'poi-a': 5 },
      rivalFollowersInSettlement: { 'poi-a': 1 },   // opposition (5) > own (1) ⇒ contested
    });
    const notContested = situation({
      opposingFollowersInSettlement: { 'poi-a': 1 },
      rivalFollowersInSettlement: { 'poi-a': 5 },   // own (5) ≥ opposition (1) ⇒ not contested
    });
    const inBandPower = AMBITION_BANK / 2; // [bank/2, bank) — inside the save band

    // All conditions true + a losing coin flip ⇒ hold (null).
    const aggressive = rivalView({ aggression: 0.7 }, { power: inBandPower, settlements: ['poi-a'] });
    expect(expandStrategy(aggressive, contested, () => 0.4)).toBeNull();

    // Same setup, winning coin flip ⇒ falls through to a real action. The coin
    // flip is the FIRST rng() draw (high ⇒ doesn't hold); a low draw after that
    // still needs to clear the (unaffordable-miracle-so-)whisper roll.
    let calls = 0;
    const winThenAct = () => (calls++ === 0 ? 0.9 : 0.1);
    expect(expandStrategy(aggressive, contested, winThenAct)).not.toBeNull();

    // Not aggressive enough (≤ 0.6) ⇒ never holds.
    const mild = rivalView({ aggression: 0.5 }, { power: inBandPower, settlements: ['poi-a'] });
    expect(expandStrategy(mild, contested, () => 0.1)).not.toBeNull();

    // Not contested ⇒ never holds.
    expect(expandStrategy(aggressive, notContested, () => 0.1)).not.toBeNull();

    // Power outside [bank/2, bank) — just under, and exactly at the bank ⇒ never holds.
    const tooPoor = rivalView({ aggression: 0.7 }, { power: inBandPower - 1, settlements: ['poi-a'] });
    expect(expandStrategy(tooPoor, contested, () => 0.1)).not.toBeNull();
    const atBankExactly = rivalView({ aggression: 0.7 }, { power: AMBITION_BANK, settlements: ['poi-a'] });
    expect(expandStrategy(atBankExactly, contested, () => 0.1)).not.toBeNull();
  });

  it('two materially different situations produce different decisions from the SAME rng seed', () => {
    const rival = rivalView({ aggression: 0.9 }, { power: 20 });
    const sitA = situation({
      playerFollowersInSettlement: { 'poi-a': 9, 'poi-b': 0 },
      opposingFollowersInSettlement: { 'poi-a': 9, 'poi-b': 0 },
    });
    const sitB = situation({
      playerFollowersInSettlement: { 'poi-a': 0, 'poi-b': 9 },
      opposingFollowersInSettlement: { 'poi-a': 0, 'poi-b': 9 },
    });
    const seedRng = () => {
      const rng = createRng(4242);
      return () => rng.next();
    };
    const a = decideRivalAction(rival, 1, sitA, seedRng());
    const b = decideRivalAction(rival, 1, sitB, seedRng());
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.targetSettlementId).not.toBe(b!.targetSettlementId);
  });

  it('is deterministic: same seed + same situation ⇒ identical decision sequence', () => {
    const rival = rivalView({ aggression: 0.9 });
    const sit = situation({ playerFollowersInSettlement: { 'poi-a': 3 } });
    expect(tally(rival, sit, 77)).toEqual(tally(rival, sit, 77));
  });
});

// ── 2. the stance lever actually moves behaviour ─────────────────────────────
describe('set_rival_stance changes subsequent behaviour', () => {
  it('recomputes ai.policy from the mutated personality (and caps the delta at ±0.2)', () => {
    const rival = rivalSpirit({ aggression: 0.75, subtlety: 0.6, territoriality: 0.75 });
    expect(rival.ai!.policy).toBe('expand');

    const res = executeCommand(stanceCmd({ rivalId: 'rival-1', aggression: -0.9 }), applyCtx(new Map([['rival-1', rival]])));
    expect(res.status).toBe('applied');
    expect(rival.ai!.personality!.aggression).toBe(0.55);   // capped: 0.75 − 0.2, not −0.9
    expect(rival.ai!.policy).toBe('defend');                // 0.55 ≤ 0.7, territoriality 0.75 > 0.7
  });

  it('a stance change alters the action distribution over N decisions', () => {
    const rival = rivalSpirit({ aggression: 0.75, subtlety: 0.6, territoriality: 0.75 });
    const sit = situation({
      playerFollowersInSettlement: { 'poi-a': 4 },
      rivalFollowersInSettlement: { 'poi-a': 2 },
    });

    const viewOf = (s: Spirit): RivalSpirit => rivalView(s.ai!.personality!, { power: s.power });

    const before = tally(viewOf(rival), sit, 99);
    executeCommand(stanceCmd({ rivalId: 'rival-1', aggression: -0.2 }), applyCtx(new Map([['rival-1', rival]])));
    const after = tally(viewOf(rival), sit, 99);

    // expand's vocabulary (miracle/whisper) gives way to defend's (proselytize).
    expect((before.miracle ?? 0) + (before.whisper ?? 0)).toBeGreaterThan(0);
    expect(before.proselytize ?? 0).toBe(0);
    expect(after.proselytize ?? 0).toBeGreaterThan(0);
    expect((after.miracle ?? 0) + (after.whisper ?? 0)).toBe(0);
    expect(after).not.toEqual(before);
  });

  it('decideRivalAction reads personality LIVE — even a stale cached strategy field is ignored', () => {
    const rival = rivalView({ aggression: 0.9 }, { strategy: 'coexist' });   // cache lies
    const a = decideRivalAction(rival, 1, situation(), () => 0.1);
    expect(a!.type).toBe('miracle');   // expand behaviour, from the personality
  });
});

// ── 3. the live system feeds the brain real data ─────────────────────────────
describe('RivalSystem wires situations into decisions', () => {
  it('a coexist rival whispers to a soul in the settlement under prayer pressure', () => {
    const world = new World(tinyMap());
    world.addEntity(npc('calm', 'poi1'));
    // Pleas aged past the WARNING line (pressure) but inside the CLAIM window,
    // so this exercises the strategy path, not the claim path.
    const w1 = npc('w1', 'poi2', { activity: 'worship', prayerSince: 0 });
    world.addEntity(w1);
    world.addEntity(npc('w2', 'poi2', { activity: 'worship', prayerSince: 0 }));
    const rival = rivalSpirit({ aggression: 0.2, territoriality: 0.3 }, ['poi1', 'poi2']);
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rival]]);

    const queue = new CommandQueue();
    const forceAct: Rng = { next: () => 0.1, nextInt: () => 0 } as unknown as Rng;
    // Plea age (now − prayerSince) past the warning line, inside the claim window.
    new RivalSystem(queue).tick(sysCtx(world, spirits, forceAct, PRAYER_CLAIM_WARNING_TICKS + 100));

    const cmds = queue.drain();
    expect(cmds).toHaveLength(1);
    expect(cmds[0].verb).toBe('whisper');
    const target = cmds[0].target as { kind: string; npcId: string };
    expect(target.kind).toBe('npc');
    expect(['w1', 'w2']).toContain(target.npcId);   // resolved INSIDE the pressed settlement
    expect(P(w1).homePoiId).toBe('poi2');
  });

  it('refreshes the follower-trend baseline at cooldown cadence', () => {
    const world = new World(tinyMap());
    world.addEntity(npc('a', 'poi1', { beliefs: { 'rival-1': { faith: 0.8, understanding: 0.2, devotion: 0.2 } } }));
    const rival = rivalSpirit({}, ['poi1']);
    rival.ai!.actionCooldown = 50;
    rival.ai!.lastActionTick = -100;
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rival]]);

    new RivalSystem(new CommandQueue()).tick(sysCtx(world, spirits, createRng(1), 10));
    expect(rival.ai!.followerBaseline).toEqual({ poi1: 1 });
    expect(rival.ai!.baselineTick).toBe(10);
  });

  it('does not pay the situation sweep (or touch the baseline) for a rival on cooldown', () => {
    const world = new World(tinyMap());
    world.addEntity(npc('a', 'poi1'));
    const rival = rivalSpirit({}, ['poi1']);
    rival.ai!.actionCooldown = 100;
    rival.ai!.lastActionTick = 5;
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rival]]);

    const queue = new CommandQueue();
    new RivalSystem(queue).tick(sysCtx(world, spirits, createRng(1), 10));
    expect(queue.size()).toBe(0);
    expect(rival.ai!.followerBaseline).toBeUndefined();
  });
});
