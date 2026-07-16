import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity, ActiveEvent } from '@/core/types';
import type { GameState } from '@/core/state';
import { buildFateContext, describeThreadsForFate, describeRivalsForFate, describeLordsForFate, describeArcsForFate, type FateFocus } from '@/game/fate/fate-context';
import { FateArcStore } from '@/sim/fate/arc-store';
import { getArcShape, openArcFromShape } from '@/sim/fate/arc-library';
import { CausalSiteStore } from '@/world/causal-site';
import { EventLog } from '@/core/events';
import type { Spirit } from '@/core/spirit';

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

describe('buildFateContext', () => {
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
});
