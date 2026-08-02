import { describe, it, expect } from 'vitest';
import { seedWorld } from '@/world/seed-world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import type { GameMap, Tile, WorldSeed } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import { identityOracle } from '@/world/oracle';

function emptyMap(w = 20, h = 20): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function minimalWorldSeed(): WorldSeed {
  return {
    name: 'TestWorld',
    size: { width: 20, height: 20 },
    biome: 'temperate',
    pois: [
      { id: 'village-1', type: 'village', position: { x: 10, y: 10 },
        npcs: [{ name: 'Alice', role: 'farmer' }] },
    ],
    connections: [],
    constraints: [],
  };
}

describe('seedWorld', () => {
  it('emits the canonical cradle event sequence', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const map = emptyMap();
    const world = new World(map);
    const spirits = new Map<SpiritId, Spirit>([['player', {
      id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700', isPlayer: true,
      power: 3, manifestation: null,
    }]]);
    const ws = minimalWorldSeed();

    seedWorld({ world, log, clock, spirits, rng: createRng(map.seed), worldSeed: ws, map, oracle: identityOracle });

    const types = log.since(0).map(a => a.event.type);
    expect(types).toContain('npc_spawn');
    expect(types).toContain('region_realized');
    expect(types).toContain('world_seeded');
    // world_seeded is last (chapter zero marker)
    expect(types[types.length - 1]).toBe('world_seeded');
  });

  it('realizes only the cradle bubble, not the whole map', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const map = emptyMap();
    const world = new World(map);
    const spirits = new Map<SpiritId, Spirit>([['player', {
      id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700', isPlayer: true, power: 3, manifestation: null,
    }]]);
    const ws = minimalWorldSeed();

    seedWorld({ world, log, clock, spirits, rng: createRng(map.seed), worldSeed: ws, map, oracle: identityOracle });

    const realized = map.tiles.flat().filter(t => t.state === 'realized').length;
    const total = map.width * map.height;
    expect(realized).toBeGreaterThan(0);
    expect(realized).toBeLessThan(total);
  });

  it('spawns a band of 6 NPCs at/near the configured POI', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const map = emptyMap();
    const world = new World(map);
    const spirits = new Map<SpiritId, Spirit>([['player', {
      id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700', isPlayer: true, power: 3, manifestation: null,
    }]]);
    const ws = minimalWorldSeed();

    seedWorld({ world, log, clock, spirits, rng: createRng(map.seed), worldSeed: ws, map, oracle: identityOracle });

    const npcs = world.query({ kind: 'npc' });
    expect(npcs.length).toBe(6);
    // All band members are placed within 3 tiles of the POI origin (10,10).
    for (const npc of npcs) {
      expect(Math.abs(npc.x - 10)).toBeLessThanOrEqual(3);
      expect(Math.abs(npc.y - 10)).toBeLessThanOrEqual(3);
    }
  });

  // ── the authored nobility ─────────────────────────────────────────────────
  // Without these, `world.lords` stays empty forever and the shipped M3 lord/tithe
  // economy never runs: nothing else in the codebase spawns a `role: 'noble'` entity.

  it('spawns every authored noble as a named entity, at its own settlement', () => {
    const { world } = seedFixture({
      pois: [
        { id: 'village-1', type: 'village', position: { x: 10, y: 10 },
          npcs: [{ name: 'Alice', role: 'farmer' }] },
        { id: 'keep', type: 'castle', position: { x: 4, y: 4 },
          npcs: [{ name: 'Lady Vane', role: 'noble' }, { name: 'Sgt Pike', role: 'soldier' }] },
      ],
    });

    const nobles = world.query({ kind: 'npc' })
      .filter((e) => (e.properties as { role?: string }).role === 'noble');
    expect(nobles.length).toBe(1);
    const p = nobles[0].properties as { name: string; homePoiId: string; lineageId: string };
    expect(p.name).toBe('Lady Vane');
    expect(p.homePoiId).toBe('keep');
    expect(p.lineageId).toBe(nobles[0].id);       // a noble founds his own house
    // Placed at his own settlement, not at the cradle.
    expect(Math.abs(nobles[0].x - 4)).toBeLessThanOrEqual(8);
    expect(Math.abs(nobles[0].y - 4)).toBeLessThanOrEqual(8);
    // The rest of the roster stays statistical — ONLY nobles are spawned.
    expect(world.query({ kind: 'npc' }).length).toBe(6 + 1);
  });

  it('seeds nobles deterministically and rng-free (two runs are identical)', () => {
    const pois: WorldSeed['pois'] = [
      { id: 'village-1', type: 'village', position: { x: 10, y: 10 },
        npcs: [{ name: 'Alice', role: 'farmer' }] },
      { id: 'keep', type: 'castle', position: { x: 4, y: 4 },
        npcs: [{ name: 'Lady Vane', role: 'noble' }] },
    ];
    const shape = () => seedFixture({ pois: structuredClone(pois) }).world
      .query({ kind: 'npc' })
      .filter((e) => (e.properties as { role?: string }).role === 'noble')
      .map((e) => `${e.id}@${e.x},${e.y}#${(e.properties as { birthTick: number }).birthTick}`)
      .sort();

    expect(shape()).toEqual(shape());
  });

  it('spawns no noble when no roster authors one', () => {
    const { world } = seedFixture({});
    expect(world.query({ kind: 'npc' }).length).toBe(6);
  });
});

/** One seeded world, with an optional WorldSeed override — the setup above, factored. */
function seedFixture(over: Partial<WorldSeed>) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const map = emptyMap();
  const world = new World(map);
  const spirits = new Map<SpiritId, Spirit>([['player', {
    id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700', isPlayer: true,
    power: 3, manifestation: null,
  }]]);
  const ws: WorldSeed = { ...minimalWorldSeed(), ...over };
  seedWorld({ world, log, clock, spirits, rng: createRng(map.seed), worldSeed: ws, map, oracle: identityOracle });
  return { world, log, clock, map, ws };
}
