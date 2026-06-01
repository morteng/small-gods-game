import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, queryNpcs } from '@/world/npc-helpers';
import { projectTurnover } from '@/sim/turnover';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function pop(world: World, n: number, ageYears: number): Entity[] {
  const out: Entity[] = [];
  for (let i = 0; i < n; i++) {
    const id = `n${i}`;
    const p = initNpcProps(id, 'farmer', (i * 2654435761) | 0);
    p.lineageId = id;
    p.birthTick = -ageYears * TICKS_PER_YEAR;
    p.homePoiId = 'village';
    const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);
    out.push(e);
  }
  return out;
}

describe('projectTurnover', () => {
  it('is deterministic for a given seed', () => {
    const run = () => {
      const world = new World(emptyMap());
      const npcs = pop(world, 10, 40);
      const r = projectTurnover(npcs, 100, 0, createRng(7));
      return { d: r.deaths.length, b: r.births.length };
    };
    expect(run()).toEqual(run());
  });

  it('eventually kills off an aged cohort over a century', () => {
    const world = new World(emptyMap());
    const npcs = pop(world, 12, 60); // all 60 -> all should die within 100y (max age 95)
    const { deaths } = projectTurnover(npcs, 100, 0, createRng(1));
    expect(deaths.length).toBe(12);
    for (const d of deaths) {
      expect(d.deathYearOffset).toBeGreaterThanOrEqual(0);
      expect(d.deathYearOffset).toBeLessThan(100);
    }
  });

  it('synthesized children carry their parents homePoiId', () => {
    const world = new World(emptyMap());
    const mk = (id: string) => {
      const p = initNpcProps(id, 'farmer', (id.charCodeAt(0) * 31) | 0);
      p.lineageId = id; p.birthTick = -30 * TICKS_PER_YEAR; p.homePoiId = 'village';
      world.addEntity({ id, kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> });
    };
    mk('mum'); mk('dad');
    const { births } = projectTurnover(queryNpcs(world), 20, 0, createRng(7));
    expect(births.length).toBeGreaterThan(0);
    expect(births.every(b => b.homePoiId === 'village')).toBe(true);
  });

  it('synthesizes children with valid lineage and diluted belief', () => {
    const world = new World(emptyMap());
    const npcs = pop(world, 6, 25); // young fertile adults -> expect some births
    for (const e of npcs) npcProps(e).beliefs['player'] = { faith: 0.8, understanding: 0.6, devotion: 0.2 };
    const { births } = projectTurnover(npcs, 30, 0, createRng(3));
    expect(births.length).toBeGreaterThan(0);
    const founderIds = new Set(npcs.map(e => e.id));
    for (const c of births) {
      expect(c.parentIds.length).toBeGreaterThanOrEqual(1);
      expect(typeof c.lineageId).toBe('string');
      expect(c.beliefs['player'].faith).toBeLessThan(0.8); // diluted
      expect(c.birthYearOffset).toBeGreaterThanOrEqual(0);
      expect(c.birthYearOffset).toBeLessThan(30);
      if (c.birthYearOffset === 0) expect([...c.parentIds].every(id => founderIds.has(id))).toBe(true);
    }
  });
});
