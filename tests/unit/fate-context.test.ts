import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity, ActiveEvent } from '@/core/types';
import type { GameState } from '@/core/state';
import {
  buildFateContext, describeThreadsForFate, describeRivalsForFate, describeLordsForFate,
  describeArcsForFate, describeSettlementsForFate, type FateFocus,
} from '@/game/fate/fate-context';
import { FateArcStore } from '@/sim/fate/arc-store';
import { getArcShape, openArcFromShape } from '@/sim/fate/arc-library';
import { CausalSiteStore } from '@/world/causal-site';
import { EventLog } from '@/core/events';
import type { Spirit } from '@/core/spirit';
import { SettlementAggregateStore, type SettlementAggregate } from '@/sim/settlement-aggregates';
import { ContentionLedger } from '@/sim/rival-contention';
import { FateSettlementDigestBaseline } from '@/sim/fate/settlement-digest-baseline';

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 4; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 4; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 4, height: 4, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function resident(id: string): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.homePoiId = 'poi1';
  return { id, kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> };
}
function state(): GameState {
  const world = new World(map());
  world.addEntity(resident('r1'));
  const plotThreads = new PlotThreadStore();
  const t = plotThreads.open('trial', { kind: 'settlement', poiId: 'poi1' }, 0);
  plotThreads.advance(t.id, 'hardship', 1, 0);
  return {
    world, plotThreads, staging: new StagingBuffer(), clock: new SimClock(),
    worldSeed: { name: 'Test', pois: [{ id: 'poi1', name: 'Northvale' }] },
  } as unknown as GameState;
}

describe('describeThreadsForFate', () => {
  it('lists active settlement threads and collects their poiIds', () => {
    const { text, poiIds } = describeThreadsForFate(state());
    expect(text).toContain('trial');
    expect(text).toContain('poi1');
    expect(text).toContain('Northvale');
    expect([...poiIds]).toEqual(['poi1']);
  });
});

describe('describeThreadsForFate active events', () => {
  it("annotates a thread settlement's active event with type and severity", () => {
    const s = state();
    const ev: ActiveEvent = { type: 'drought', poiId: 'poi1', severity: 0.45, durationTicks: 100, ticksElapsed: 0 };
    s.world!.activeEvents.set('poi1', [ev]);
    const { text } = describeThreadsForFate(s);
    expect(text).toContain('drought');
    expect(text).toContain('0.45');
  });

  it('marks a thread settlement with no active event', () => {
    const { text } = describeThreadsForFate(state());
    expect(text.toLowerCase()).toContain('no active event');
  });
});

function rivalSpirit(): Spirit {
  return {
    id: 'rival-1', name: 'Sablethorn', sigil: '◆', color: '#000', isPlayer: false, power: 10,
    manifestation: null,
    ai: {
      policy: 'expand', cooldowns: {}, settlements: ['poi1'],
      personality: { aggression: 0.8, subtlety: 0.3, territoriality: 0.7, assertiveness: 0.5, jealousy: 0.4 },
    },
  };
}
function playerSpirit(): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 20, manifestation: null };
}
/** A state carrying a rival, a believer of each god, and a recent rival prayer-claim. */
function rivalState(): GameState {
  const world = new World(map());
  // Player believer at poi1.
  const believerP = resident('bp');
  (believerP.properties as unknown as { beliefs: Record<string, { faith: number; understanding: number; devotion: number }> })
    .beliefs.player.faith = 0.6;
  world.addEntity(believerP);
  // Rival believer at poi1 — its player faith is zeroed so it counts ONLY for the rival.
  const believerR = resident('br');
  const rp = believerR.properties as unknown as { beliefs: Record<string, { faith: number; understanding: number; devotion: number }> };
  rp.beliefs.player.faith = 0;
  rp.beliefs['rival-1'] = { faith: 0.5, understanding: 0.2, devotion: 0.2 };
  world.addEntity(believerR);

  const clock = new SimClock();
  const eventLog = new EventLog(clock);
  eventLog.append({ type: 'answer_prayer', spiritId: 'rival-1', npcId: 'br' });
  const spirits = new Map<string, Spirit>([['player', playerSpirit()], ['rival-1', rivalSpirit()]]);
  return {
    world, plotThreads: new PlotThreadStore(), staging: new StagingBuffer(), clock, eventLog, spirits,
    worldSeed: { name: 'Test', pois: [{ id: 'poi1', name: 'Northvale' }] },
  } as unknown as GameState;
}

describe('describeRivalsForFate', () => {
  it('digests each rival with follower counts, settlements, disposition, and recent claims', () => {
    const { text, rivalIds } = describeRivalsForFate(rivalState());
    expect(text).toContain('Sablethorn');
    expect(text).toContain('rival-1');
    expect(text).toContain('aggression 0.80');
    expect(text).toContain('holds 1 settlement');
    expect(text).toContain('1 recent prayer claim');
    expect(text).toMatch(/1 follower\(s\) vs your 1/);   // one rival believer vs one player believer
    expect([...rivalIds]).toEqual(['rival-1']);
  });

  it('returns empty text + no ids when there are no rivals', () => {
    const s = state();                                   // no spirits map
    const { text, rivalIds } = describeRivalsForFate(s);
    expect(text).toBe('');
    expect(rivalIds.size).toBe(0);
  });
});

describe('describeLordsForFate (M3)', () => {
  function lordState(): GameState {
    const s = state();
    const lord = initNpcProps('Aldric', 'noble', 11);
    lord.homePoiId = 'poi1';
    s.world!.addEntity({ id: 'lord-1', kind: 'npc', x: 2, y: 2, properties: lord as unknown as Record<string, unknown> });
    s.world!.lords.set('poi1', { npcId: 'lord-1', lineageId: 'lord-1', tithe: 0.3, garrison: 2, unrest: 0.15, keepTier: 0 });
    return s;
  }

  it('digests each seated lord with tithe/unrest/garrison and collects the seat poiIds', () => {
    const { text, lordPoiIds } = describeLordsForFate(lordState());
    expect(text).toContain('Aldric');
    expect(text).toContain('Northvale');
    expect(text).toContain('tithe 0.30');
    expect(text).toContain('unrest 0.15');
    expect(text).toContain('garrison 2');
    expect(text).toContain('set_lord_stance');
    expect([...lordPoiIds]).toEqual(['poi1']);
  });

  it('returns empty text + no ids when no settlement holds a lord', () => {
    const { text, lordPoiIds } = describeLordsForFate(state());
    expect(text).toBe('');
    expect(lordPoiIds.size).toBe(0);
  });

  it('buildFateContext surfaces the lords digest and the validLordPoiIds drift-guard set', () => {
    const focus: FateFocus = { kind: 'pulse' };
    const { system, user, validLordPoiIds } = buildFateContext(lordState(), focus);
    expect(system).toContain('set_lord_stance');
    expect(user).toContain('Lords (mortal power');
    expect([...validLordPoiIds]).toEqual(['poi1']);
    // No seats ⇒ an empty guard set (every set_lord_stance call drops).
    expect(buildFateContext(state(), focus).validLordPoiIds.size).toBe(0);
  });
});

describe('describeArcsForFate — F4 ledger visibility', () => {
  it('shows an empty ledger as GATED with the shape\'s legal portent kinds', () => {
    const s = state();
    s.fateArcs = new FateArcStore();
    openArcFromShape(s.fateArcs, getArcShape('strongman_dies_abroad')!, { poiIds: ['poi1'], npcIds: [] }, 0);
    const text = describeArcsForFate(s);
    expect(text).toContain('portents: NONE (heavy beats gated');
    expect(text).toContain('dream, sky, beast');
  });

  it('shows planted + discovered counts once the ledger is non-empty', () => {
    const s = state();
    s.fateArcs = new FateArcStore();
    const arc = openArcFromShape(s.fateArcs, getArcShape('strongman_dies_abroad')!, { poiIds: ['poi1'], npcIds: [] }, 0);
    s.fateArcs.plantPortent(arc.id, { tick: 1, kind: 'dream', discovered: false, beatId: 4 });
    s.fateArcs.markPortentDiscovered(4);
    const text = describeArcsForFate(s);
    expect(text).toContain('portents: 1 planted (1 discovered)');
  });

  it('a shape with no portent vocabulary reads as omen-less (the_null_event)', () => {
    const s = state();
    s.fateArcs = new FateArcStore();
    openArcFromShape(s.fateArcs, getArcShape('the_null_event')!, { poiIds: [], npcIds: [] }, 0);
    expect(describeArcsForFate(s)).toContain('portents: none (this shape carries no omens)');
  });
});

describe('describeArcsForFate — F5 weaving visibility', () => {
  it('lists the levers that advance the UNMET goals, plus the pressure/budget tally', () => {
    const s = state();
    s.fateArcs = new FateArcStore();
    openArcFromShape(s.fateArcs, getArcShape('strongman_dies_abroad')!, { poiIds: ['poi1'], npcIds: [] }, 0);
    const text = describeArcsForFate(s);
    // settlement_in_crisis (unmet) → the three levers that plausibly move it, as TOOL names.
    expect(text).toContain('advance via nudge_event_severity, force_next_event, set_lord_stance');
    expect(text).toContain('pressure: 0 applied, budget 4 left');
  });

  it('an inject-shaped goal points at arm_staged_beat (a stranger rides a beat, not a lever)', () => {
    const s = state();
    s.fateArcs = new FateArcStore();
    openArcFromShape(s.fateArcs, getArcShape('martyr_by_accident')!, { poiIds: ['poi1'], npcIds: [] }, 0);
    expect(describeArcsForFate(s)).toContain('advance via arm_staged_beat');
  });

  it('a spent arc reads SPENT — no levers offered', () => {
    const s = state();
    s.fateArcs = new FateArcStore();
    const arc = openArcFromShape(s.fateArcs, getArcShape('strongman_dies_abroad')!, { poiIds: ['poi1'], npcIds: [] }, 0);
    arc.pressureBudget = 0;
    const text = describeArcsForFate(s);
    expect(text).toContain('(SPENT — no more pressure; land or fold)');
    expect(text).not.toContain('advance via');
  });
});

function believerSpirit(): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 20, manifestation: null };
}

function agg(overrides: Partial<SettlementAggregate> & { poiId: string }): SettlementAggregate {
  return {
    population: { named: 0, statistical: 0 },
    believers: {},
    needPressure: { safety: 0, prosperity: 0, community: 0, meaning: 0 },
    prayerPressure: 0,
    ...overrides,
  };
}

/** A state carrying a real `SettlementAggregateStore` + a real (empty)
 *  `ContentionLedger` + `FateSettlementDigestBaseline`, the substrate
 *  `describeSettlementsForFate` reads. Two settlements: `poi1` "Northvale"
 *  (Phase 1's aggregate shape) and `poi2` "Ashfen" not otherwise referenced. */
function settlementState(records: SettlementAggregate[], computedTick = 1000): GameState {
  const s = state();
  s.worldSeed = { name: 'Test', pois: [{ id: 'poi1', name: 'Northvale' }, { id: 'poi2', name: 'Ashfen' }] } as unknown as GameState['worldSeed'];
  s.spirits = new Map([['player', believerSpirit()]]);
  s.settlementAggregates = new SettlementAggregateStore();
  s.settlementAggregates.replace(new Map(records.map((r) => [r.poiId, r])), computedTick);
  s.contention = new ContentionLedger();
  s.fateSettlementDigestBaseline = new FateSettlementDigestBaseline();
  return s;
}

describe('describeSettlementsForFate (interaction scaling P5, S5.1)', () => {
  it('returns empty text + no ids when the sweep has never run', () => {
    const { text, poiIds } = describeSettlementsForFate(state());
    expect(text).toBe('');
    expect(poiIds.size).toBe(0);
  });

  it('pins the exact digest line for a seeded settlement (golden — prompt-cache stability)', () => {
    const s = settlementState([
      agg({
        poiId: 'poi1',
        population: { named: 5, statistical: 20 },
        believers: { player: { count: 4, durable: 2, meanFaith: 0.62 } },
        needPressure: { safety: 0.1, prosperity: 0.2, community: 0.15, meaning: 0.05 },
        prayerPressure: 1,
        populationTrend: 3,
      }),
    ]);
    const { text, poiIds } = describeSettlementsForFate(s);
    expect(text).toBe(
      'Settlements (the mean field):\n' +
      '- "Northvale" (poi1): 25 soul(s) (+3 growing); dominant belief: You (4 believer(s)); ' +
      'worst need: prosperity (0.20); 1 plea(s) at risk; flux 0.0/day in, 0.0/day out.',
    );
    expect([...poiIds]).toEqual(['poi1']);
  });

  it('skips an empty settlement (no population) and returns "" when nothing is left to say', () => {
    const s = settlementState([agg({ poiId: 'poi1' })]);
    const { text, poiIds } = describeSettlementsForFate(s);
    expect(text).toBe('');
    expect(poiIds.size).toBe(0);
  });

  it('no populationTrend field (no baseline) ⇒ no trend clause at all', () => {
    const s = settlementState([
      agg({ poiId: 'poi1', population: { named: 1, statistical: 0 } }),
    ]);
    const { text } = describeSettlementsForFate(s);
    expect(text).toContain('1 soul(s); dominant belief: none');
    expect(text).not.toContain('growing');
    expect(text).not.toContain('shrinking');
    expect(text).not.toContain('steady');
  });

  it('belief trend: no prior digest ⇒ no trend; a later digest with a moved meanFaith reports it', () => {
    const s = settlementState([
      agg({
        poiId: 'poi1', population: { named: 1, statistical: 0 },
        believers: { player: { count: 1, durable: 0, meanFaith: 0.5 } },
      }),
    ]);
    const first = describeSettlementsForFate(s);
    expect(first.text).toContain('dominant belief: You (1 believer(s))'); // no trend yet
    expect(first.text).not.toContain('rising');

    // Same call site, later digest: meanFaith moved up — the store now holds a
    // baseline from the FIRST call, so the SECOND call can report a trend.
    s.settlementAggregates.replace(new Map([['poi1', agg({
      poiId: 'poi1', population: { named: 1, statistical: 0 },
      believers: { player: { count: 1, durable: 0, meanFaith: 0.58 } },
    })]]), 2000);
    const second = describeSettlementsForFate(s);
    expect(second.text).toContain('rising (+0.08)');
  });

  it('worst need is the argmax, fixed axis order tie-breaks (safety before prosperity)', () => {
    const s = settlementState([
      agg({
        poiId: 'poi1', population: { named: 1, statistical: 0 },
        needPressure: { safety: 0.4, prosperity: 0.4, community: 0.1, meaning: 0.1 },
      }),
    ]);
    const { text } = describeSettlementsForFate(s);
    expect(text).toContain('worst need: safety (0.40)');
  });

  it('a settlement in distress (high prayer pressure + a collapsing need axis) surfaces plainly', () => {
    const s = settlementState([
      agg({
        poiId: 'poi1', population: { named: 12, statistical: 40 },
        needPressure: { safety: 0.1, prosperity: 0.85, community: 0.2, meaning: 0.1 },
        prayerPressure: 6,
      }),
    ]);
    const { text } = describeSettlementsForFate(s);
    expect(text).toContain('worst need: prosperity (0.85)');
    expect(text).toContain('6 plea(s) at risk');
  });

  it('reports a non-calm contention state, and stays silent when calm', () => {
    const s = settlementState([agg({ poiId: 'poi1', population: { named: 1, statistical: 0 } })]);
    expect(describeSettlementsForFate(s).text).not.toContain('CONTESTED');

    // Drive poi1 to `tension` (near-even, populous believer census) — one `step`
    // clears heat past TENSION_ON but stays below SCHISM_ON, the hysteresis
    // ladder's "at most one rung per step" rule (mirrors snapshot.test.ts).
    const census = new Map([['poi1', new Map([['player', 30], ['rival-1', 28]])]]);
    s.contention.step(census, new Map(), 0);
    expect(s.contention.stateOf('poi1')).toBe('tension');
    expect(describeSettlementsForFate(s).text).toContain('CONTESTED (tension)');
  });

  it('is bounded by MAX_SETTLEMENTS_IN_DIGEST, sorted by poiId, deterministic', () => {
    const records = Array.from({ length: 15 }, (_, i) =>
      agg({ poiId: `poi-${String(i).padStart(2, '0')}`, population: { named: 1, statistical: 0 } }));
    const s = state();
    s.worldSeed = { name: 'Test', pois: [] } as unknown as GameState['worldSeed'];
    s.settlementAggregates = new SettlementAggregateStore();
    s.settlementAggregates.replace(new Map(records.map((r) => [r.poiId, r])), 1);
    s.contention = new ContentionLedger();
    s.fateSettlementDigestBaseline = new FateSettlementDigestBaseline();

    const { text, poiIds } = describeSettlementsForFate(s);
    const lines = text.split('\n').slice(1); // drop the header line
    expect(lines.length).toBe(12);
    expect(poiIds.size).toBe(12);
    expect(lines[0]).toContain('poi-00');
    expect(lines[11]).toContain('poi-11');

    // Two runs over identical state are byte-identical (prompt-cache friendliness).
    expect(describeSettlementsForFate(s).text).toBe(text);
  });

  it('never crashes on a malformed contention ledger (wrapped in try/catch)', () => {
    const s = settlementState([agg({ poiId: 'poi1', population: { named: 1, statistical: 0 } })]);
    s.contention = { stateOf: () => { throw new Error('boom'); } } as unknown as ContentionLedger;
    expect(() => describeSettlementsForFate(s)).not.toThrow();
    expect(describeSettlementsForFate(s).text).toBe('');
  });
});

describe('buildFateContext', () => {
  it('the charter states the weaving discipline (F5)', () => {
    const { system } = buildFateContext(state(), { kind: 'pulse' });
    expect(system).toContain('WEAVING');
    expect(system).toContain('advance_arc');
    expect(system).toContain('servedArcs');
  });

  it('the charter states the portents-first discipline (F4)', () => {
    const focus: FateFocus = { kind: 'pulse' };
    const { system } = buildFateContext(state(), focus);
    expect(system).toContain('PORTENTS FIRST');
    expect(system).toContain('plant_portent');
  });

  it('produces a system charter and a user block with world + threads + the event, and valid poiIds', () => {
    const focus: FateFocus = { event: { type: 'thread_advanced', threadId: 1, phase: 'turning', weight: 'climax' }, threadId: 1 };
    const { system, user, validPoiIds } = buildFateContext(state(), focus);
    expect(system.toLowerCase()).toContain('fate');
    expect(system).toContain('subjectPoiId');
    expect(user).toContain('Northvale');     // from buildWorldSummary / threads
    expect(user).toContain('trial');         // active thread
    expect(user).toContain('climax');        // the triggering event
    expect([...validPoiIds]).toEqual(['poi1']);
  });

  it('splices the dramatic-tempo digest line into the user prompt without touching the valid-id sets', () => {
    const s = state();
    const focus: FateFocus = { kind: 'pulse' };
    const before = buildFateContext(s, focus);
    expect(before.user).toContain('Dramatic tempo');   // the pacing digest is present
    // The tempo line changes nothing about the drift-guard id sets.
    expect([...before.validPoiIds]).toEqual(['poi1']);
    expect(before.validRivalIds.size).toBe(0);
    expect(before.validLordPoiIds.size).toBe(0);
  });

  it('W-I: surfaces an active causal site as an addressable subject (in user text + valid ids)', () => {
    const s = state();
    // A live site, hydrated directly (footprint cells irrelevant for the context).
    const store = new CausalSiteStore(4, 4, new Set(), []);
    store.hydrate({ nextId: 1, sites: [{
      id: 'causal:flood:0000', kind: 'flood', name: 'The Drowned Reach of Northvale',
      x: 2, y: 2, cells: [5, 6], bornTick: 0, lifeTicks: 30, ageTicks: 0, intensity: 0.7, cause: 'player',
    }] });
    s.causalSites = store;

    const focus: FateFocus = { event: { type: 'site_born', siteId: 'causal:flood:0000', kind: 'flood', name: 'The Drowned Reach of Northvale', x: 2, y: 2, depthM: 1.4, cells: 2 } };
    const { user, validPoiIds } = buildFateContext(s, focus);
    expect(validPoiIds.has('causal:flood:0000')).toBe(true);
    expect(user).toContain('The Drowned Reach of Northvale');
    expect(user).toContain('causal site');
    expect(user.toLowerCase()).toContain('transient');   // the triggering site_born description
  });

  it('S5.1/S5.3: a settlement in distress surfaces in the built context, and its poiId ' +
     'joins validPoiIds even with no open thread there', () => {
    const s = settlementState([
      agg({
        poiId: 'poi2', population: { named: 8, statistical: 30 },
        needPressure: { safety: 0.1, prosperity: 0.9, community: 0.2, meaning: 0.1 },
        prayerPressure: 7,
      }),
    ]);
    const { user, validPoiIds } = buildFateContext(s, { kind: 'pulse' });
    expect(user).toContain('Settlements (the mean field):');
    expect(user).toContain('"Ashfen" (poi2)');
    expect(user).toContain('worst need: prosperity (0.90)');
    expect(user).toContain('7 plea(s) at risk');
    expect(validPoiIds.has('poi2')).toBe(true);      // no thread named poi2 — the digest alone grants it
  });

  it('S5.2: the roster is dropped from the Fate prompt in favour of the mean-field digest', () => {
    // `state()`'s world carries one named NPC ('r1') — well under buildWorldSummary's
    // own 30-cap, so a "Roster:" line would appear here if `roster: false` weren't passed.
    const { user } = buildFateContext(state(), { kind: 'pulse' });
    expect(user).not.toContain('Roster:');
  });
});
