import { describe, it, expect } from 'vitest';
import { seedSocialGraph, trustWeightedBeliefConnections } from '@/sim/social-graph';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import type { GameMap, Tile, Entity } from '@/core/types';

function makeMap(w = 20, h = 20): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function makeNpc(world: World, id: string, role: 'farmer' | 'priest' | 'merchant' | 'elder', homePoi?: string, homeBldg?: string): Entity {
  const props = initNpcProps(id, role, id.charCodeAt(0) * 37);
  props.homePoiId = homePoi;
  props.homeBuildingId = homeBldg;
  const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

describe('seedSocialGraph', () => {
  it('leaves a single NPC with empty relationships', () => {
    const map = makeMap();
    const world = new World(map);
    makeNpc(world, 'n1', 'farmer', 'village_1', 'house_1');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);
    expect(npcProps(all[0]).relationships).toEqual([]);
  });

  it('creates relationships between two NPCs in the same building', () => {
    const map = makeMap();
    const world = new World(map);
    makeNpc(world, 'n1', 'farmer', 'village_1', 'house_1');
    makeNpc(world, 'n2', 'priest', 'village_1', 'house_1');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);
    const p1 = npcProps(all[0]);
    const p2 = npcProps(all[1]);
    expect(p1.relationships.length).toBe(1);
    expect(p2.relationships.length).toBe(1);
    expect(p1.relationships[0].npcId).toBe('n2');
    expect(p2.relationships[0].npcId).toBe('n1');
    expect(p1.relationships[0].trust).toBeGreaterThanOrEqual(0.5);
    // Relationship type should be family, lover, or friend (not rival for similar personalities)
    expect(['family', 'lover', 'friend']).toContain(p1.relationships[0].type);
  });

  it('creates relationships between NPCs in different buildings of the same POI', () => {
    const map = makeMap();
    const world = new World(map);
    makeNpc(world, 'n1', 'farmer', 'village_1', 'house_1');
    makeNpc(world, 'n2', 'merchant', 'village_1', 'shop_1');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 99);
    const p1 = npcProps(all[0]);
    const p2 = npcProps(all[1]);
    expect(p1.relationships.length).toBe(1);
    expect(p2.relationships.length).toBe(1);
    // Cross-building relationships can be friend or rival
    expect(['friend', 'rival']).toContain(p1.relationships[0].type);
    expect(p1.relationships[0].trust).toBeGreaterThanOrEqual(0.2);
  });

  it('does not create relationships across different POIs', () => {
    const map = makeMap();
    const world = new World(map);
    makeNpc(world, 'n1', 'farmer', 'village_1', 'house_1');
    makeNpc(world, 'n2', 'farmer', 'village_2', 'house_2');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);
    expect(npcProps(all[0]).relationships).toEqual([]);
    expect(npcProps(all[1]).relationships).toEqual([]);
  });

  it('is idempotent — second call does not double relationships', () => {
    const map = makeMap();
    const world = new World(map);
    makeNpc(world, 'n1', 'farmer', 'village_1', 'house_1');
    makeNpc(world, 'n2', 'priest', 'village_1', 'house_1');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);
    seedSocialGraph(all, 42);
    const p1 = npcProps(all[0]);
    expect(p1.relationships.length).toBe(1);
  });

  it('handles orphan NPCs (no POI) gracefully — skipped', () => {
    const map = makeMap();
    const world = new World(map);
    makeNpc(world, 'n1', 'farmer');
    makeNpc(world, 'n2', 'priest');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);
    // Both are '__orphan' group, so they ARE grouped together
    expect(npcProps(all[0]).relationships.length).toBe(1);
  });

  it('three NPCs in one building get pairwise relationships', () => {
    const map = makeMap();
    const world = new World(map);
    makeNpc(world, 'n1', 'farmer', 'village_1', 'house_1');
    makeNpc(world, 'n2', 'priest', 'village_1', 'house_1');
    makeNpc(world, 'n3', 'elder', 'village_1', 'house_1');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);
    for (const e of all) {
      expect(npcProps(e).relationships.length).toBe(2); // each connected to the other two
    }
  });

  it('is deterministic — same seed produces same relationships', () => {
    const make = () => {
      const map = makeMap();
      const world = new World(map);
      makeNpc(world, 'a', 'farmer', 'village_1', 'house_1');
      makeNpc(world, 'b', 'priest', 'village_1', 'house_1');
      const all = [...world.query({ kind: 'npc' })];
      seedSocialGraph(all, 777);
      return all.map(e => ({ id: e.id, rels: npcProps(e).relationships }));
    };
    const r1 = make();
    const r2 = make();
    expect(r1).toEqual(r2);
  });
});

describe('trustWeightedBeliefConnections', () => {
  it('returns 0 when the NPC has no relationships', () => {
    const map = makeMap();
    const world = new World(map);
    const e = makeNpc(world, 'n1', 'farmer', 'village_1', 'house_1');
    const allMap = new Map([['n1', e]]);
    expect(trustWeightedBeliefConnections(e, allMap, 'player')).toBe(0);
  });

  it('sums trust × faith across believing connections', () => {
    const map = makeMap();
    const world = new World(map);
    const a = makeNpc(world, 'a', 'farmer', 'village_1', 'house_1');
    const b = makeNpc(world, 'b', 'priest', 'village_1', 'house_1');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);
    const allMap = new Map([['a', a], ['b', b]]);
    // Give NPC b some faith in the player
    npcProps(b).beliefs['player'].faith = 0.8;
    const result = trustWeightedBeliefConnections(a, allMap, 'player');
    expect(result).toBeGreaterThan(0);
    // trust >= 0.5 × faith 0.8 = at least 0.4
    expect(result).toBeGreaterThanOrEqual(0.4);
  });

  it('ignores connections with faith <= 0.3', () => {
    const map = makeMap();
    const world = new World(map);
    const a = makeNpc(world, 'a', 'farmer', 'village_1', 'house_1');
    const b = makeNpc(world, 'b', 'priest', 'village_1', 'house_1');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);
    const allMap = new Map([['a', a], ['b', b]]);
    npcProps(b).beliefs['player'].faith = 0.2; // below threshold
    expect(trustWeightedBeliefConnections(a, allMap, 'player')).toBe(0);
  });
});
