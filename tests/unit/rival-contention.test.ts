import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { buildRivalSituation } from '@/sim/rival-claims';
import { emptySettlementCohorts, addSoul, type SettlementCohorts } from '@/sim/cohorts';
import {
  censusBelieversByPoi, contentionIndex, nextContentionState,
  ContentionLedger, stateRank,
  SCHISM_ON, SCHISM_OFF, WAR_ON, WAR_OFF, TENSION_ON, TENSION_OFF,
  HOLY_WAR_CLAIM_MULT, type PoiBelieverCounts,
} from '@/sim/rival-contention';
import type { Entity, GameMap, NpcProperties, SpiritBelief } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

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
function npc(id: string, poiId: string, beliefs: Record<SpiritId, SpiritBelief>): Entity {
  const p = initNpcProps(id, 'farmer', id.charCodeAt(0)) as NpcProperties;
  p.homePoiId = poiId;
  p.beliefs = beliefs;
  return { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
}
function believer(faith: number): SpiritBelief { return { faith, understanding: 0.1, devotion: 0.1 }; }
function rivalSpirit(id: string): Spirit {
  return {
    id, name: id, sigil: '◆', color: '#a0f', isPlayer: false, power: 10, manifestation: null,
    ai: { policy: 'coexist', cooldowns: {}, personality: { aggression: 0.2, subtlety: 0.5, territoriality: 0.5, assertiveness: 0.3, jealousy: 0.3 }, settlements: [], lastActionTick: 0, actionCooldown: 0 },
  };
}
function player(): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 10, manifestation: null };
}
function counts(entries: Record<string, number>): PoiBelieverCounts {
  return new Map(Object.entries(entries));
}

// ── contentionIndex ──────────────────────────────────────────────────────────
describe('contentionIndex', () => {
  it('is high when two gods are near-even AND populous', () => {
    const nearEven = contentionIndex(counts({ a: 30, b: 28 }));
    const lopsided = contentionIndex(counts({ a: 50, b: 2 }));
    expect(nearEven).toBeGreaterThan(50);
    expect(lopsided).toBeLessThan(5);
    expect(nearEven).toBeGreaterThan(lopsided);
  });

  it('rises with total at fixed parity, and with parity at fixed total', () => {
    // Same parity (perfect), bigger congregation → bigger index.
    expect(contentionIndex(counts({ a: 20, b: 20 }))).toBeGreaterThan(contentionIndex(counts({ a: 10, b: 10 })));
    // Same total (40), more even → bigger index.
    expect(contentionIndex(counts({ a: 20, b: 20 }))).toBeGreaterThan(contentionIndex(counts({ a: 35, b: 5 })));
  });

  it('is 0 with only one god present, or none', () => {
    expect(contentionIndex(counts({ a: 5 }))).toBe(0);
    expect(contentionIndex(new Map())).toBe(0);
    expect(contentionIndex(counts({ a: 0, b: 0 }))).toBe(0);
  });

  it('uses the top TWO counts only (a third small cult does not inflate it)', () => {
    // top-2 are 30 & 28 regardless of the third; index reads those two.
    expect(contentionIndex(counts({ a: 30, b: 28, c: 1 }))).toBeCloseTo(contentionIndex(counts({ a: 30, b: 28 })), 6);
  });
});

// ── censusBelieversByPoi mirrors buildRivalSituation ─────────────────────────
describe('censusBelieversByPoi', () => {
  it('counts named believers per (poi, spirit) identically to buildRivalSituation', () => {
    const world = new World(tinyMap());
    world.addEntity(npc('a', 'poi1', { player: believer(0.8), 'rival-1': believer(0.05) }));
    world.addEntity(npc('b', 'poi1', { player: believer(0.5), 'rival-1': believer(0.9) }));
    world.addEntity(npc('c', 'poi2', { 'rival-1': believer(0.7) }));
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rivalSpirit('rival-1')]]);

    const census = censusBelieversByPoi(world, spirits);
    const sit = buildRivalSituation(world, spirits, 'rival-1');

    expect(census.get('poi1')!.get('player')).toBe(sit.playerFollowersInSettlement['poi1']);   // 2
    expect(census.get('poi1')!.get('rival-1')).toBe(sit.rivalFollowersInSettlement['poi1']);    // 1 (b only; a below line)
    expect(census.get('poi2')!.get('rival-1')).toBe(sit.rivalFollowersInSettlement['poi2']);    // 1
  });

  it('folds the statistical cohort tier with the same walk as buildRivalSituation', () => {
    const world = new World(tinyMap());
    world.addEntity(npc('a', 'poi1', { player: believer(0.8) }));
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rivalSpirit('rival-1')]]);

    const sc: SettlementCohorts = emptySettlementCohorts('poi1');
    for (let i = 0; i < 5; i++) addSoul(sc, { age: 30, beliefs: { player: believer(0.5) }, needs: { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 } });
    for (let i = 0; i < 4; i++) addSoul(sc, { age: 30, beliefs: { 'rival-1': believer(0.5) }, needs: { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 } });
    const cohorts = new Map([['poi1', sc]]);

    const census = censusBelieversByPoi(world, spirits, cohorts);
    const sit = buildRivalSituation(world, spirits, 'rival-1', { cohorts });

    expect(census.get('poi1')!.get('player')).toBe(sit.playerFollowersInSettlement['poi1']);   // 1 named + 5 stat = 6
    expect(census.get('poi1')!.get('rival-1')).toBe(sit.rivalFollowersInSettlement['poi1']);    // 0 named + 4 stat = 4
  });
});

// ── hysteresis ladder (pure) ─────────────────────────────────────────────────
describe('nextContentionState hysteresis', () => {
  it('climbs only at the ON threshold and moves at most one rung', () => {
    expect(nextContentionState('tension', SCHISM_ON)).toBe('schism');
    expect(nextContentionState('tension', SCHISM_ON - 0.01)).toBe('tension');
    // A huge heat from calm still only steps ONE rung.
    expect(nextContentionState('calm', 1000)).toBe('tension');
  });

  it('does NOT drop until heat falls below the lower OFF threshold', () => {
    // At exactly OFF it holds (drop is strict `< OFF`); between OFF and ON it is sticky.
    expect(nextContentionState('schism', SCHISM_OFF)).toBe('schism');
    expect(nextContentionState('schism', (SCHISM_OFF + SCHISM_ON) / 2)).toBe('schism');
    expect(nextContentionState('schism', SCHISM_OFF - 0.01)).toBe('tension');
    // War holds down to WAR_OFF, then drops ONE rung to schism.
    expect(nextContentionState('holy_war', WAR_OFF)).toBe('holy_war');
    expect(nextContentionState('holy_war', WAR_OFF - 0.01)).toBe('schism');
  });

  it('ON is strictly above OFF at every rung (no flicker band collapse)', () => {
    expect(TENSION_ON).toBeGreaterThan(TENSION_OFF);
    expect(SCHISM_ON).toBeGreaterThan(SCHISM_OFF);
    expect(WAR_ON).toBeGreaterThan(WAR_OFF);
  });
});

// ── ledger.step: heat integration + escalation ───────────────────────────────
describe('ContentionLedger.step', () => {
  it('climbs calm→tension→schism→holy_war one rung per step for a near-even populous poi', () => {
    const ledger = new ContentionLedger();
    const census = new Map([['poi1', counts({ player: 30, 'rival-1': 28 })]]);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const transitions = ledger.step(census, new Map(), i);
      expect(transitions.length).toBe(1);
      expect(stateRank(transitions[0].to) - stateRank(transitions[0].from)).toBe(1); // exactly one rung
      seen.push(transitions[0].to);
    }
    expect(seen).toEqual(['tension', 'schism', 'holy_war']);
    expect(ledger.stateOf('poi1')).toBe('holy_war');
  });

  it('eases back down one rung at a time when a rivalry collapses, never skipping', () => {
    const ledger = new ContentionLedger();
    const hot = new Map([['poi1', counts({ player: 30, 'rival-1': 28 })]]);
    for (let i = 0; i < 3; i++) ledger.step(hot, new Map(), i);
    expect(ledger.stateOf('poi1')).toBe('holy_war');

    // One god collapses (drops below the believer line) — index falls to 0, heat bleeds.
    const collapsed = new Map([['poi1', counts({ player: 30 })]]);
    const eased: string[] = [];
    let prev = 'holy_war';
    for (let i = 0; i < 60 && ledger.stateOf('poi1') !== 'calm'; i++) {
      for (const t of ledger.step(collapsed, new Map(), 100 + i)) {
        expect(stateRank(t.from) - stateRank(t.to)).toBe(1);   // strictly one rung down
        eased.push(t.to);
        prev = t.to;
      }
    }
    void prev;
    expect(eased).toEqual(['schism', 'tension', 'calm']);
    expect(ledger.stateOf('poi1')).toBe('calm');
  });

  it('claimMultiplier is < 1 ONLY in holy_war', () => {
    const ledger = new ContentionLedger();
    const census = new Map([['poi1', counts({ player: 30, 'rival-1': 28 })]]);
    expect(ledger.claimMultiplier('poi1')).toBe(1);              // calm
    ledger.step(census, new Map(), 0);
    expect(ledger.stateOf('poi1')).toBe('tension');
    expect(ledger.claimMultiplier('poi1')).toBe(1);              // tension
    ledger.step(census, new Map(), 1);
    expect(ledger.stateOf('poi1')).toBe('schism');
    expect(ledger.claimMultiplier('poi1')).toBe(1);              // schism — still no teeth
    ledger.step(census, new Map(), 2);
    expect(ledger.stateOf('poi1')).toBe('holy_war');
    expect(ledger.claimMultiplier('poi1')).toBe(HOLY_WAR_CLAIM_MULT);
    expect(HOLY_WAR_CLAIM_MULT).toBeLessThan(1);
    expect(ledger.claimMultiplier('unknown-poi')).toBe(1);       // untracked poi is never at war
  });

  it('records belligerents as the id-sorted top-2 on a count tie', () => {
    const ledger = new ContentionLedger();
    // Equal counts → deterministic id-ascending order for the pair.
    const census = new Map([['poi1', counts({ 'rival-z': 20, 'rival-a': 20 })]]);
    ledger.step(census, new Map(), 0);
    expect(ledger.entry('poi1')!.rivals).toEqual(['rival-a', 'rival-z']);
  });

  it('a per-step dispute bump adds heat', () => {
    const base = new ContentionLedger();
    const bumped = new ContentionLedger();
    const census = new Map([['poi1', counts({ player: 10, 'rival-1': 10 })]]);
    base.step(census, new Map(), 0);
    bumped.step(census, new Map([['poi1', 3]]), 0);
    expect(bumped.entry('poi1')!.heat).toBeGreaterThan(base.entry('poi1')!.heat);
  });
});

// ── serialize → hydrate round-trip ───────────────────────────────────────────
describe('ContentionLedger serialize/hydrate', () => {
  it('round-trips to an identical ledger (serialize → fromSnapshot)', () => {
    const ledger = new ContentionLedger();
    const census = new Map([
      ['poi1', counts({ player: 30, 'rival-1': 28 })],
      ['poi2', counts({ player: 12, 'rival-1': 11 })],
    ]);
    for (let i = 0; i < 3; i++) ledger.step(census, new Map(), i);

    const snap = ledger.serialize();
    const restored = ContentionLedger.fromSnapshot(snap);
    expect(restored.all()).toEqual(ledger.all());

    // hydrate onto an existing instance is equivalent and does not alias the snapshot.
    const other = new ContentionLedger();
    other.hydrate(snap);
    expect(other.all()).toEqual(ledger.all());
    snap.entries[0].heat = -999;                       // mutate the snapshot after hydrate
    expect(other.all()[0].heat).not.toBe(-999);        // the live store is unaffected
  });
});
