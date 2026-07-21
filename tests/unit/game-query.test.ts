import { describe, it, expect, beforeEach } from 'vitest';
import { createGameQuery, RECENT_STRIP_HORIZON_TICKS } from '@/game/game-query';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { TICKS_PER_DAY } from '@/core/calendar';
import type { GameState } from '@/core/state';
import type { GameMap, Tile, NpcProperties } from '@/core/types';
import type { LordState } from '@/sim/lord';

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
    domains: { player: { storm: 0.1 } }, // she half-suspects the angry-sky (below smite's unlock)
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

  // ── P3.8: the target-first inspector ──
  describe('inspect', () => {
    it('reads an NPC: state bars, domain-belief feedback, and the full vocabulary', () => {
      const v = q.inspect({ kind: 'npc', npcId: 'n1' })!;
      expect(v.kind).toBe('npc');
      expect(v.title).toBe('Ada');
      expect(v.subtitle).toContain('farmer');
      // belief scalars ride the state bars
      expect(v.state.find(b => b.label === 'Faith')!.value).toBeCloseTo(0.8);
      expect(v.state.some(b => b.label === 'Meaning')).toBe(true);
      // domain-belief feedback: what SHE believes YOU command
      const storm = v.domains.find(d => d.label === 'Storm & Lightning')!;
      expect(storm.value).toBeCloseTo(0.1);
      // the full vocabulary: whisper open, smite present but belief-locked
      const whisper = v.affordances.find(a => a.verb === 'whisper')!;
      const smite = v.affordances.find(a => a.verb === 'smite')!;
      expect(whisper.unlocked).toBe(true);
      expect(smite.unlocked).toBe(false); // conviction below the storm threshold
    });

    it('reads a settlement: place verbs + the congregation-scale conviction', () => {
      const v = q.inspect({ kind: 'settlement', poiId: 'poi1' })!;
      expect(v.kind).toBe('settlement');
      expect(v.title).toBe('Hollow');
      expect(v.subtitle).toContain('souls');
      expect(v.affordances.some(a => a.verb === 'omen')).toBe(true);
      // aggregate conviction is the settlement's loop feedback (weighted, so < 0.1)
      const storm = v.domains.find(d => d.label === 'Storm & Lightning')!;
      expect(storm.value).toBeGreaterThan(0);
      expect(storm.value).toBeLessThan(0.1);
    });

    it('returns null for an unresolvable target and is JSON-serializable', () => {
      expect(q.inspect({ kind: 'npc', npcId: 'nope' })).toBeNull();
      expect(q.inspect({ kind: 'settlement', poiId: 'absent' })).toBeNull();
      expect(q.inspect({ kind: 'none' })).toBeNull();
      const round = JSON.parse(JSON.stringify(q.inspect({ kind: 'npc', npcId: 'n1' })));
      expect(round.title).toBe('Ada');
    });

    // ── UI v2 W2 (D5): the settlement inspector's grown payload ──
    describe('settlement v2 (W2 D5)', () => {
      it('reports wards (same source as settlement()) and population', () => {
        const v = q.inspect({ kind: 'settlement', poiId: 'poi1' })!;
        expect(v.wards).toEqual([{ name: 'Mill Ward', type: 'craft' }]);
        expect(v.population).toBe(2); // n1 + n2, both homed at poi1
      });

      it('housing capacity sums standing dwellings at the poi; 0 with none', () => {
        // The base fixture's 'c1' cottage has no blueprint (bare test entity) —
        // contributes no capacity, so the settlement starts at 0.
        const bare = q.inspect({ kind: 'settlement', poiId: 'poi1' })!;
        expect(bare.housing).toBe(0);

        state.world!.addEntity({
          id: 'dwelling1', kind: 'cottage', x: 4, y: 4, tags: ['building'],
          properties: {
            poiId: 'poi1',
            blueprint: {
              rb: { preset: 'cottage', category: 'residential' },
              collision: { footprint: { w: 1, h: 1 }, blocked: [], doorCells: [] },
              anchors: [],
            },
          },
        } as any);
        const withDwelling = q.inspect({ kind: 'settlement', poiId: 'poi1' })!;
        expect(withDwelling.housing).toBe(5); // DWELLING_CAPACITY.cottage
      });

      it('a settlement with no lord reports no peace field', () => {
        const v = q.inspect({ kind: 'settlement', poiId: 'poi1' })!;
        expect(v.peace).toBeUndefined();
      });

      it('a seated lord with no proclaimed peace reports oath "none"', () => {
        state.world!.lords.set('poi1', {
          npcId: 'n1', lineageId: 'n1', tithe: 0.1, garrison: 0, unrest: 0, keepTier: 0,
        } as LordState);
        const v = q.inspect({ kind: 'settlement', poiId: 'poi1' })!;
        expect(v.peace).toEqual({ lordName: 'Ada', oath: 'none' });
      });

      it('an unexpired Peace of God reports "sworn" with fiction days to expiry', () => {
        state.clock.setNow(1000);
        state.world!.lords.set('poi1', {
          npcId: 'n1', lineageId: 'n1', tithe: 0.05, garrison: 1, unrest: 0, keepTier: 0,
          peace: { spiritId: 'player', untilTick: 1000 + 3 * TICKS_PER_DAY, titheCap: 0.05, sworn: ['n1'] },
        } as LordState);
        const v = q.inspect({ kind: 'settlement', poiId: 'poi1' })!;
        expect(v.peace?.lordName).toBe('Ada');
        expect(v.peace?.oath).toBe('sworn');
        expect(v.peace?.expiryDays).toBeCloseTo(3, 5);
      });

      it('an expired Peace of God reports "lapsed" with fiction days since lapse', () => {
        state.clock.setNow(1000);
        state.world!.lords.set('poi1', {
          npcId: 'n1', lineageId: 'n1', tithe: 0.1, garrison: 1, unrest: 0, keepTier: 0,
          peace: { spiritId: 'player', untilTick: 1000 - 2 * TICKS_PER_DAY, titheCap: 0.05, sworn: ['n1'] },
        } as LordState);
        const v = q.inspect({ kind: 'settlement', poiId: 'poi1' })!;
        expect(v.peace?.oath).toBe('lapsed');
        expect(v.peace?.expiryDays).toBeCloseTo(2, 5);
      });

      it('the RECENT strip coalesces last-day births/deaths/growth/road events for THIS settlement', () => {
        state.clock.setNow(1000);
        state.eventLog.append({ type: 'npc_birth', npcId: 'n1', parentIds: [], lineageId: 'n1' });
        state.eventLog.append({ type: 'npc_death', npcId: 'n2', lineageId: 'n2', cause: 'old_age' });
        state.eventLog.append({ type: 'settlement_grown', poiId: 'poi1', entityId: 'dwelling2', preset: 'cottage', lotId: 'lot1' });
        state.eventLog.append({ type: 'road_promoted', edgeId: 'e1', from: 'path', to: 'road', fromPoiId: 'poi1', toPoiId: 'poi9' });
        state.eventLog.append({ type: 'road_adopted', edgeId: 'e2', x: 3, y: 3, lengthT: 1, fromPoiId: 'poi9', toPoiId: 'poi1' });

        const v = q.inspect({ kind: 'settlement', poiId: 'poi1' })!;
        expect(v.recent).toEqual(expect.arrayContaining([
          { label: 'BORN', count: 1 },
          { label: 'PASSED', count: 1 },
          { label: 'NEW ROOFS', count: 1 },
          { label: 'ROAD RAISED', count: 1 },
          { label: 'PATH WORN', count: 1 },
        ]));
        expect(v.recent).toHaveLength(5);
      });

      it('excludes events older than the RECENT horizon and events at a different settlement', () => {
        state.clock.setNow(1000);
        state.eventLog.append({ type: 'npc_birth', npcId: 'n1', parentIds: [], lineageId: 'n1' }); // too old, below
        state.clock.setNow(1000 + RECENT_STRIP_HORIZON_TICKS + 1);
        state.world!.addEntity(npc('n3', 'Cel', 5, 5, { homePoiId: 'otherpoi' }));
        state.eventLog.append({ type: 'npc_birth', npcId: 'n3', parentIds: [], lineageId: 'n3' }); // different poi

        const v = q.inspect({ kind: 'settlement', poiId: 'poi1' })!;
        expect(v.recent).toEqual([]);
      });

      it('a building click threads a highlighted buildingRow; an npc target never carries one', () => {
        state.world!.addEntity({
          id: 'b1', kind: 'cottage', x: 3, y: 2, tags: ['building'],
          properties: {
            blueprint: {
              rb: { preset: 'cottage', category: 'residential' },
              collision: { footprint: { w: 1, h: 1 }, blocked: [], doorCells: [] },
              anchors: [],
            },
          },
        } as any);
        const v = q.inspect({ kind: 'settlement', poiId: 'poi1' }, 'player', { buildingId: 'b1' })!;
        expect(v.buildingRow).toEqual({ name: 'a one-room peasant cottage', type: 'residential' });

        // Absent when no buildingId is supplied, or it doesn't resolve.
        const noBuilding = q.inspect({ kind: 'settlement', poiId: 'poi1' })!;
        expect(noBuilding.buildingRow).toBeUndefined();
        const missing = q.inspect({ kind: 'settlement', poiId: 'poi1' }, 'player', { buildingId: 'nope' })!;
        expect(missing.buildingRow).toBeUndefined();

        const npcView = q.inspect({ kind: 'npc', npcId: 'n1' })!;
        expect(npcView.buildingRow).toBeUndefined();
      });

      it('the whole enriched payload is JSON-serializable', () => {
        state.world!.lords.set('poi1', {
          npcId: 'n1', lineageId: 'n1', tithe: 0.1, garrison: 1, unrest: 0, keepTier: 0,
          peace: { spiritId: 'player', untilTick: state.clock.now() + TICKS_PER_DAY, titheCap: 0.05, sworn: ['n1'] },
        } as LordState);
        state.eventLog.append({ type: 'npc_birth', npcId: 'n1', parentIds: [], lineageId: 'n1' });
        const v = q.inspect({ kind: 'settlement', poiId: 'poi1' }, 'player', { buildingId: 'c1' });
        const round = JSON.parse(JSON.stringify(v));
        expect(round.wards).toEqual([{ name: 'Mill Ward', type: 'craft' }]);
        expect(round.peace.oath).toBe('sworn');
        expect(round.recent).toEqual([{ label: 'BORN', count: 1 }]);
      });
    });

    // ── UI v2 W3 (D6): the npc inspector's soul deepening ──
    describe('npc soul deepening (W3 D6)', () => {
      beforeEach(() => {
        // A third living actor (a rival, high trust) + a dead soul (kind →
        // 'remains' on death — nothing is ever deleted, so a relationship can
        // outlive its subject) + a dangling relationship pointing at nothing.
        state.world!.addEntity(npc('n3', 'Cade', 3, 3, { homePoiId: 'poi1', lineageId: 'n3' }));
        state.world!.addEntity({
          id: 'n4', kind: 'remains', x: 4, y: 4, tags: [],
          properties: initNpcProps('Dead Edda', 'farmer', 4),
        } as any);
        const ada = state.world!.registry.get('n1')!;
        (ada.properties as any).relationships = [
          { npcId: 'n2', type: 'friend', trust: 0.4 },
          { npcId: 'n3', type: 'rival', trust: 0.9 },
          { npcId: 'n4', type: 'family', trust: 0.99 }, // dead — must be skipped
          { npcId: 'ghost', type: 'friend', trust: 0.5 }, // missing — must be skipped
        ];
      });

      it('reads the status hint from npcStatusHint (Ada: faith 0.8, devotion 0.6 → devoted)', () => {
        const v = q.inspect({ kind: 'npc', npcId: 'n1' })!;
        expect(v.statusHint).toBe('devoted');
      });

      it('reads a non-believer\'s status hint too (Bo: faith 0.05 → faith fading)', () => {
        const v = q.inspect({ kind: 'npc', npcId: 'n2' })!;
        expect(v.statusHint).toBe('faith fading');
      });

      it('resolves relationships sorted by trust desc, skipping the dead and the missing', () => {
        const v = q.inspect({ kind: 'npc', npcId: 'n1' })!;
        expect(v.relationships).toEqual([
          { name: 'Cade', type: 'rival', trust: 0.9 },
          { name: 'Bo', type: 'friend', trust: 0.4 },
        ]);
      });

      it('caps at 8 ties, tiebreaking equal trust by name ascending', () => {
        const ada = state.world!.registry.get('n1')!;
        const rels: { npcId: string; type: string; trust: number }[] = [];
        const names = ['Zeno', 'Anna', 'Milo', 'Bex', 'Cato', 'Dara', 'Eno', 'Fara', 'Gus', 'Hela'];
        names.forEach((name, i) => {
          const id = `tie${i}`;
          state.world!.addEntity(npc(id, name, 5, 5, { homePoiId: 'poi1', lineageId: id }));
          rels.push({ npcId: id, type: 'friend', trust: 0.5 }); // all equal trust
        });
        (ada.properties as any).relationships = rels;
        const v = q.inspect({ kind: 'npc', npcId: 'n1' })!;
        expect(v.relationships).toHaveLength(8);
        expect(v.relationships!.map(r => r.name)).toEqual(
          [...names].sort().slice(0, 8),
        );
        expect(v.relationships!.every(r => r.trust === 0.5)).toBe(true);
      });

      it('has no npc-only fields on a settlement inspect, and round-trips through JSON', () => {
        const settlement = q.inspect({ kind: 'settlement', poiId: 'poi1' })!;
        expect(settlement.statusHint).toBeUndefined();
        expect(settlement.relationships).toBeUndefined();

        const v = q.inspect({ kind: 'npc', npcId: 'n1' })!;
        const round = JSON.parse(JSON.stringify(v));
        expect(round.statusHint).toBe('devoted');
        expect(round.relationships).toEqual([
          { name: 'Cade', type: 'rival', trust: 0.9 },
          { name: 'Bo', type: 'friend', trust: 0.4 },
        ]);
      });
    });
  });
});
