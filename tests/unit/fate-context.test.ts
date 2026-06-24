import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity, ActiveEvent } from '@/core/types';
import type { GameState } from '@/core/state';
import { buildFateContext, describeThreadsForFate, type FateFocus } from '@/game/fate/fate-context';
import { CausalSiteStore } from '@/world/causal-site';

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

describe('buildFateContext', () => {
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
