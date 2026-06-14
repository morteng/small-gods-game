import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '@/world/world';
import { WorldRenderGraph } from '@/render/graph/world-render-graph';
import type { GameMap, RenderContext, Entity, NpcInstance } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

/** Minimal RenderContext carrying only what WorldRenderGraph reads. */
function rcOf(
  world: World,
  npcs: NpcInstance[] = [],
  deco: Array<{ tileX: number; tileY: number; assetId: string }> = [],
): RenderContext {
  return {
    map: world.tiles, world, npcs, generatedDecorations: deco, visualMap: null,
  } as unknown as RenderContext;
}

const REGION = { x: 0, y: 0, w: 32, h: 32 };

/** A building entity = anything carrying a `properties.blueprint` (blueprintOf truthy). */
function buildingStub(id: string, x: number, y: number, w: number, h: number): Entity {
  return { id, kind: 'cottage', x, y,
    properties: { blueprint: { rb: { parts: [], footprint: { w, h } } } } } as unknown as Entity;
}

describe('R0 — WorldRenderGraph projection', () => {
  it('partitions world entities exactly as the draw list does', () => {
    const world = new World(emptyMap());
    world.addEntity(buildingStub('b1', 5, 5, 2, 3));
    world.addEntity({ id: 'w1', kind: 'wall_run', x: 6, y: 5 });          // barrier by kind
    world.addEntity({ id: 'f1', kind: 'fence', x: 6, y: 6, tags: ['barrier'] }); // barrier by tag
    world.addEntity({ id: 't1', kind: 'oak_tree', x: 7, y: 7 });          // vegetation by entity-kind
    world.addEntity({ id: 'r1', kind: 'rock_unknown_xyz', x: 8, y: 8 });  // not drawable → skipped

    const npcs = [{ id: 'n1', tileX: 3, tileY: 3 }] as unknown as NpcInstance[];
    const deco = [{ tileX: 9, tileY: 9, assetId: 'a' }];

    const g = new WorldRenderGraph(rcOf(world, npcs, deco));
    const byId = new Map([...g.nodes(REGION)].map((n) => [n.id, n]));

    expect(byId.get('b1')?.category).toBe('building');
    expect(byId.get('b1')?.footprint).toEqual({ w: 2, h: 3 });
    expect(byId.get('w1')?.category).toBe('barrier');
    expect(byId.get('f1')?.category).toBe('barrier');
    expect(byId.get('t1')?.category).toBe('vegetation');
    expect(byId.get('n1')?.category).toBe('npc');
    expect(byId.get('deco:9,9')?.category).toBe('decoration');

    // the non-drawable entity is omitted (parity: the entity pass ignores it)
    expect(byId.has('r1')).toBe(false);
    // and nothing leaked an extra node
    expect(byId.size).toBe(6);
  });

  it('nodes carry a usable ref + world tile position', () => {
    const world = new World(emptyMap());
    world.addEntity({ id: 't1', kind: 'oak_tree', x: 7, y: 7 });
    const g = new WorldRenderGraph(rcOf(world));
    const n = [...g.nodes(REGION)][0];
    expect(n.ref).toMatchObject({ id: 't1', kind: 'oak_tree' });
    expect([n.x, n.y, n.z]).toEqual([7, 7, 0]);
  });

  it('exposes bounds, seed-deterministic terrain height (R1), and a light view', () => {
    const g = new WorldRenderGraph(rcOf(new World(emptyMap())));
    expect(g.bounds).toEqual({ w: 32, h: 32 });
    // R1: heightAt is now the world heightfield in metres (finite, varies by tile).
    expect(Number.isFinite(g.terrain.heightAt(0, 0))).toBe(true);
    expect(g.light.bands).toBeGreaterThanOrEqual(1);
    expect(g.light.sunDir).toHaveLength(3);
    expect(g.light.body).toBe('sun');
    expect([...g.edges(REGION)]).toEqual([]);
  });

  it('the RenderGraph interface imports nothing from world/sim/catalogue (seam purity)', () => {
    const src = readFileSync('src/render/graph/render-graph.ts', 'utf8');
    expect(src).not.toMatch(/from '@\/world/);
    expect(src).not.toMatch(/from '@\/sim/);
    expect(src).not.toMatch(/from '@\/catalogue/);
  });
});
