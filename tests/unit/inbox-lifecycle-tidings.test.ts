// W4 (D8): lifecycle tidings — closing the "no tidings" dead ends the W0
// scouting report flagged (births/deaths/growth/road events had NO inbox
// surface). Three generators, all event-log-windowed + auto-expiring +
// coalesced-per-settlement, mirroring `inbox-rival-dispute.test.ts`'s idiom:
// synthetic events are injected straight into the log rather than driving the
// real lifecycle/growth/road systems — the generator's contract is the event.

import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import {
  createGameQuery, LIFECYCLE_TIDING_HORIZON_TICKS,
} from '@/game/game-query';
import { createState } from '@/core/state';
import type { Entity, GameMap, NpcProperties } from '@/core/types';

function makeWorld(): World {
  return new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
}

function addNpc(world: World, id: string, poiId?: string): Entity {
  const props = initNpcProps('Pip', 'farmer', 7) as NpcProperties;
  if (poiId) props.homePoiId = poiId;
  const e = { id, kind: 'npc', x: 2, y: 3, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}

function build() {
  const world = makeWorld();
  const state = createState();
  state.world = world;
  state.worldSeed = {
    name: 'w', size: { width: 10, height: 10 }, biome: 'temperate',
    pois: [
      { id: 'vale', type: 'village', name: 'Vale', position: { x: 5, y: 4 } },
      { id: 'ford', type: 'village', name: 'Ford', position: { x: 8, y: 8 } },
    ],
    connections: [], constraints: [],
  } as unknown as typeof state.worldSeed;
  return { world, state };
}

describe('divineInbox — lifecycle tidings (W4/D8)', () => {
  describe('births + deaths', () => {
    it('coalesces births/deaths at one settlement into one item, "N souls born, M passed"', () => {
      const { world, state } = build();
      addNpc(world, 'a', 'vale');
      addNpc(world, 'b', 'vale');
      addNpc(world, 'c', 'vale');
      addNpc(world, 'd', 'vale');
      state.clock.setNow(100);
      state.eventLog.append({ type: 'npc_birth', npcId: 'a', parentIds: [], lineageId: 'a' });
      state.eventLog.append({ type: 'npc_birth', npcId: 'b', parentIds: [], lineageId: 'b' });
      state.eventLog.append({ type: 'npc_birth', npcId: 'c', parentIds: [], lineageId: 'c' });
      state.eventLog.append({ type: 'npc_death', npcId: 'd', lineageId: 'd', cause: 'old age' });
      state.clock.setNow(110);

      const inbox = createGameQuery({ state }).divineInbox();
      const item = inbox.find((i) => i.id === 'lifecycle:vale');
      expect(item).toBeDefined();
      expect(item!.kind).toBe('tiding');
      expect(item!.title).toContain('3 souls born, 1 passed');
      expect(item!.title).toContain('Vale');
      expect(item!.target).toEqual({ kind: 'settlement', poiId: 'vale' });
      expect(item!.anchor).toEqual({ x: 5, y: 4 });
    });

    it('keeps different settlements as separate items', () => {
      const { world, state } = build();
      addNpc(world, 'a', 'vale');
      addNpc(world, 'b', 'ford');
      state.clock.setNow(100);
      state.eventLog.append({ type: 'npc_birth', npcId: 'a', parentIds: [], lineageId: 'a' });
      state.eventLog.append({ type: 'npc_birth', npcId: 'b', parentIds: [], lineageId: 'b' });
      state.clock.setNow(110);

      const inbox = createGameQuery({ state }).divineInbox();
      const ids = inbox.filter((i) => i.id.startsWith('lifecycle:')).map((i) => i.id).sort();
      expect(ids).toEqual(['lifecycle:ford', 'lifecycle:vale']);
    });

    it('a birth-only bucket reads "N souls born" with no dangling ", 0 passed"', () => {
      const { world, state } = build();
      addNpc(world, 'a', 'vale');
      state.clock.setNow(100);
      state.eventLog.append({ type: 'npc_birth', npcId: 'a', parentIds: [], lineageId: 'a' });
      state.clock.setNow(110);

      const item = createGameQuery({ state }).divineInbox().find((i) => i.id === 'lifecycle:vale');
      expect(item!.title).toContain('1 soul born');
      expect(item!.title).not.toContain('passed');
    });

    it('auto-expires: events older than the horizon produce no item', () => {
      const { world, state } = build();
      addNpc(world, 'a', 'vale');
      state.clock.setNow(100);
      state.eventLog.append({ type: 'npc_birth', npcId: 'a', parentIds: [], lineageId: 'a' });
      state.clock.setNow(100 + LIFECYCLE_TIDING_HORIZON_TICKS + 1);

      const inbox = createGameQuery({ state }).divineInbox();
      expect(inbox.find((i) => i.id === 'lifecycle:vale')).toBeUndefined();
    });

    it('a soul with no resolvable home is silently uncounted (never crashes, never orphan-buckets)', () => {
      const { world, state } = build();
      addNpc(world, 'a'); // no homePoiId
      state.clock.setNow(100);
      state.eventLog.append({ type: 'npc_birth', npcId: 'a', parentIds: [], lineageId: 'a' });
      state.clock.setNow(110);

      const inbox = createGameQuery({ state }).divineInbox();
      expect(inbox.some((i) => i.id.startsWith('lifecycle:'))).toBe(false);
    });
  });

  describe('road adoption/promotion', () => {
    it('names the other endpoint when every event in the bucket agrees on it', () => {
      const { state } = build();
      state.clock.setNow(100);
      state.eventLog.append({ type: 'road_promoted', edgeId: 'e1', from: 'path', to: 'road', fromPoiId: 'vale', toPoiId: 'ford' });
      state.clock.setNow(110);

      const inbox = createGameQuery({ state }).divineInbox();
      const item = inbox.find((i) => i.id === 'roads:vale');
      expect(item).toBeDefined();
      expect(item!.title).toBe('The path to Ford has become a road');
      expect(item!.target).toEqual({ kind: 'settlement', poiId: 'vale' });
    });

    it('coalesces per BOTH endpoint settlements from a single event', () => {
      const { state } = build();
      state.clock.setNow(100);
      state.eventLog.append({ type: 'road_adopted', edgeId: 'e1', x: 1, y: 1, lengthT: 1, fromPoiId: 'vale', toPoiId: 'ford' });
      state.clock.setNow(110);

      const inbox = createGameQuery({ state }).divineInbox();
      expect(inbox.find((i) => i.id === 'roads:vale')!.title).toContain('Ford');
      expect(inbox.find((i) => i.id === 'roads:ford')!.title).toContain('Vale');
    });

    it('auto-expires past the horizon', () => {
      const { state } = build();
      state.clock.setNow(100);
      state.eventLog.append({ type: 'road_promoted', edgeId: 'e1', from: 'path', to: 'road', fromPoiId: 'vale', toPoiId: 'ford' });
      state.clock.setNow(100 + LIFECYCLE_TIDING_HORIZON_TICKS + 1);

      const inbox = createGameQuery({ state }).divineInbox();
      expect(inbox.find((i) => i.id === 'roads:vale')).toBeUndefined();
    });
  });

  describe('settlement growth', () => {
    it('surfaces "X raises new roofs" for settlement_grown / settlement_upgraded', () => {
      const { state } = build();
      state.clock.setNow(100);
      state.eventLog.append({ type: 'settlement_grown', poiId: 'vale', entityId: 'b1', preset: 'cottage', lotId: 'l1' });
      state.clock.setNow(110);

      const inbox = createGameQuery({ state }).divineInbox();
      const item = inbox.find((i) => i.id === 'growth:vale');
      expect(item).toBeDefined();
      expect(item!.title).toBe('Vale raises new roofs');
      expect(item!.anchor).toEqual({ x: 5, y: 4 });
    });

    it('coalesces multiple growth events at one settlement into one item', () => {
      const { state } = build();
      state.clock.setNow(100);
      state.eventLog.append({ type: 'settlement_grown', poiId: 'vale', entityId: 'b1', preset: 'cottage', lotId: 'l1' });
      state.eventLog.append({ type: 'settlement_upgraded', poiId: 'vale', entityId: 'b2', from: 'cottage', to: 'house', lotId: 'l2' });
      state.clock.setNow(110);

      const items = createGameQuery({ state }).divineInbox().filter((i) => i.id === 'growth:vale');
      expect(items).toHaveLength(1);
      expect(items[0].detail).toContain('2 new roofs');
    });

    it('auto-expires past the horizon', () => {
      const { state } = build();
      state.clock.setNow(100);
      state.eventLog.append({ type: 'settlement_grown', poiId: 'vale', entityId: 'b1', preset: 'cottage', lotId: 'l1' });
      state.clock.setNow(100 + LIFECYCLE_TIDING_HORIZON_TICKS + 1);

      const inbox = createGameQuery({ state }).divineInbox();
      expect(inbox.find((i) => i.id === 'growth:vale')).toBeUndefined();
    });
  });

  describe('salience ordering: low, below threats and dispute tidings', () => {
    it('never outranks a threat', () => {
      const { world, state } = build();
      const apostate = addNpc(world, 'apostate', 'vale');
      (apostate.properties as unknown as NpcProperties).beliefs['rival'] = { faith: 0.6, understanding: 0, devotion: 0 };
      state.spirits.set('rival', { id: 'rival', name: 'Rival', sigil: '×', color: '#000', isPlayer: false, power: 50, manifestation: null });
      addNpc(world, 'baby', 'vale');
      state.clock.setNow(100);
      state.eventLog.append({ type: 'npc_birth', npcId: 'baby', parentIds: [], lineageId: 'baby' });

      const inbox = createGameQuery({ state }).divineInbox();
      const threatIdx = inbox.findIndex((i) => i.kind === 'threat');
      const lifecycleIdx = inbox.findIndex((i) => i.id === 'lifecycle:vale');
      expect(threatIdx).toBeGreaterThanOrEqual(0);
      expect(lifecycleIdx).toBeGreaterThan(threatIdx);
    });

    it('never outranks a rival_dispute tiding', () => {
      const { world, state } = build();
      addNpc(world, 'baby', 'vale');
      state.clock.setNow(100);
      state.eventLog.append({ type: 'npc_birth', npcId: 'baby', parentIds: [], lineageId: 'baby' });
      state.eventLog.append({ type: 'rival_dispute', spiritId: 'rival1', data: { otherRivalId: 'rival2', poiId: 'vale' } });

      const inbox = createGameQuery({ state }).divineInbox();
      const disputeIdx = inbox.findIndex((i) => i.id === 'dispute:vale');
      const lifecycleIdx = inbox.findIndex((i) => i.id === 'lifecycle:vale');
      expect(disputeIdx).toBeGreaterThanOrEqual(0);
      expect(lifecycleIdx).toBeGreaterThan(disputeIdx);
    });
  });
});
