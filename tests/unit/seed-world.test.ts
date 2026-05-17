import { describe, it, expect } from 'vitest';
import { seedWorld } from '@/world/seed-world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { World } from '@/world/world';
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

    seedWorld({ world, log, clock, spirits, worldSeed: ws, map, oracle: identityOracle });

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

    seedWorld({ world, log, clock, spirits, worldSeed: ws, map, oracle: identityOracle });

    const realized = map.tiles.flat().filter(t => t.state === 'realized').length;
    const total = map.width * map.height;
    expect(realized).toBeGreaterThan(0);
    expect(realized).toBeLessThan(total);
  });

  it('spawns the seed NPC at the configured POI', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const map = emptyMap();
    const world = new World(map);
    const spirits = new Map<SpiritId, Spirit>([['player', {
      id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700', isPlayer: true, power: 3, manifestation: null,
    }]]);
    const ws = minimalWorldSeed();

    seedWorld({ world, log, clock, spirits, worldSeed: ws, map, oracle: identityOracle });

    const npcs = world.query({ kind: 'npc' });
    expect(npcs.length).toBe(1);
    expect(Math.abs(npcs[0].x - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(npcs[0].y - 10)).toBeLessThanOrEqual(1);
  });
});
