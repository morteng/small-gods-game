import { describe, it, expect, beforeEach } from 'vitest';
import { createGameQuery } from '@/game/game-query';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameState } from '@/core/state';
import type { GameMap, Tile, NpcProperties } from '@/core/types';

function miniMap(w = 8, h = 8): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    tiles[y] = [];
    for (let x = 0; x < w; x++) tiles[y][x] = { type: 'grass', x, y, walkable: true, state: 'realized' };
  }
  return { tiles, width: w, height: h, villages: [{ x: 2, y: 2, name: 'Hollow', type: 'village', wards: [{ name: 'Mill Ward', type: 'craft' }] }], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function npc(id: string, name: string, x: number, y: number, patch: Partial<NpcProperties>): any {
  const props = { ...initNpcProps(name, 'farmer', id.charCodeAt(0)), ...patch };
  return { id, kind: 'npc', x, y, tags: [], properties: props };
}

function setup(): GameState {
  const state = createState();
  const map = miniMap();
  state.map = map;
  state.world = new World(map);
  state.worldSeed = {
    name: 'Testland', era: 'medieval',
    pois: [{ id: 'poi1', type: 'village', name: 'Hollow', importance: 'high', position: { x: 2, y: 2 } }],
  } as any;
  state.world.addEntity({ id: 'c1', kind: 'cottage', x: 2, y: 3, tags: ['building'], properties: {} } as any);
  state.world.addEntity({ id: 't1', kind: 'tree', x: 6, y: 6, tags: ['vegetation'], properties: {} } as any);
  // A durable believer (faith>0.3 && devotion>0.4), home in poi1.
  state.world.addEntity(npc('n1', 'Ada', 1, 1, {
    beliefs: { player: { faith: 0.8, understanding: 0.5, devotion: 0.6 } },
    homePoiId: 'poi1', lineageId: 'n1',
  }));
  // A non-believer (low faith).
  state.world.addEntity(npc('n2', 'Bo', 2, 2, {
    beliefs: { player: { faith: 0.05, understanding: 0.1, devotion: 0.05 } },
    homePoiId: 'poi1', lineageId: 'n2',
  }));
  return state;
}

describe('game-query', () => {
  let state: GameState;
  let q: ReturnType<typeof createGameQuery>;
  beforeEach(() => { state = setup(); q = createGameQuery({ state, rate: () => 1 }); });

  it('worldSummary reports name, map, era, and counts by kind', () => {
    const s = q.worldSummary();
    expect(s.name).toBe('Testland');
    expect(s.era).toBe('medieval');
    expect(s.map).toEqual({ w: 8, h: 8 });
    expect(s.npcs).toBe(2);
    expect(s.buildings).toBe(1);
    expect(s.vegetation).toBe(1);
    expect(s.byKind.npc).toBe(2);
    expect(typeof s.calendar).toBe('string');
  });

  it('npcs returns compact views; npc returns detail with beliefs/needs', () => {
    const list = q.npcs();
    expect(list.map(n => n.id).sort()).toEqual(['n1', 'n2']);
    const ada = list.find(n => n.id === 'n1')!;
    expect(ada.name).toBe('Ada');
    expect(ada.faith).toBeCloseTo(0.8);

    const detail = q.npc('n1')!;
    expect(detail.beliefs.player.devotion).toBeCloseTo(0.6);
    expect(detail.needs).toHaveProperty('safety');
    expect(detail.personality).toHaveProperty('piety');
    expect(detail.ageYears).toBeGreaterThanOrEqual(0);
    expect(q.npc('nope')).toBeNull();
  });

  it('beliefState counts durable believers and aggregates their faith', () => {
    const b = q.beliefState();
    expect(b.spiritId).toBe('player');
    expect(b.believers).toBe(1);          // only Ada is durable
    expect(b.faith).toBeCloseTo(0.8);     // mean over the single believer
    expect(b.power).toBe(10);             // player stipend from createState
    expect(b.regenPerTick).toBeGreaterThan(0);
  });

  it('settlement resolves a POI to a compact view with ward names', () => {
    const s = q.settlement('poi1')!;
    expect(s.name).toBe('Hollow');
    expect(s.importance).toBe('high');
    expect(s.npcCount).toBe(2);
    expect(s.wards).toEqual([{ name: 'Mill Ward', type: 'craft' }]);
    expect(q.settlement('absent')).toBeNull();
  });

  it('events delegates to EventLog.since', () => {
    const all = q.events();              // since 0
    expect(all).toEqual(state.eventLog.since(0));
    const sinceFirst = q.events(all[0].id);
    expect(sinceFirst).toEqual(state.eventLog.since(all[0].id));
  });

  it('timeline reports rate / tick / scrub state', () => {
    const t = q.timeline();
    expect(t.rate).toBe(1);
    expect(t.scrubbed).toBe(false);
    expect(t.currentTick).toBe(state.clock.now());
    expect(t.commits).toBe(0);
  });

  it('spirits lists each spirit with a durable-believer count', () => {
    const list = q.spirits();
    const player = list.find(s => s.id === 'player')!;
    expect(player.isPlayer).toBe(true);
    expect(player.believers).toBe(1);
  });

  it('every DTO is JSON-serializable (no live World/Entity refs)', () => {
    const blob = {
      summary: q.worldSummary(),
      npcs: q.npcs(),
      npc: q.npc('n1'),
      belief: q.beliefState(),
      settlement: q.settlement('poi1'),
      timeline: q.timeline(),
      spirits: q.spirits(),
      events: q.events(),
    };
    const round = JSON.parse(JSON.stringify(blob));
    expect(round.npc.id).toBe('n1');
    expect(round.summary.npcs).toBe(2);
  });

  it('screenshot is empty headless (no canvas)', () => {
    expect(q.screenshot()).toBe('');
  });
});
