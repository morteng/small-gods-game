import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed, Tile } from '@/core/types';

const ROAD_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);

function makeSeed(overrides: Partial<WorldSeed> = {}): WorldSeed {
  return {
    name: 'test',
    size: { width: 32, height: 32 },
    biome: 'temperate',
    pois: [
      { id: 'a', type: 'village', name: 'A', position: { x: 5,  y: 16 } },
      { id: 'b', type: 'village', name: 'B', position: { x: 26, y: 16 } },
    ],
    connections: [
      { from: 'a', to: 'b', type: 'road', style: 'dirt' },
    ],
    constraints: [],
    ...overrides,
  };
}

/** BFS flood from start over ROAD_TYPES tiles. Returns the set of "x,y" keys. */
function floodConnected(tiles: Tile[][], start: { x: number; y: number }): Set<string> {
  const width = tiles[0]?.length ?? 0;
  const height = tiles.length;
  const visited = new Set<string>();
  const queue: Array<{ x: number; y: number }> = [start];
  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const t = tiles[y]?.[x];
    if (!t) continue;
    if (!ROAD_TYPES.has(t.type)) continue;
    visited.add(key);
    queue.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
  }
  return visited;
}

/** Find the nearest road-type tile to (cx,cy) within a search radius. */
function findNearestRoad(
  tiles: Tile[][],
  cx: number,
  cy: number,
  maxRadius = 6,
): { x: number; y: number } | null {
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        const t = tiles[y]?.[x];
        if (t && ROAD_TYPES.has(t.type)) return { x, y };
      }
    }
  }
  return null;
}

describe('carveConnections (walker-based)', () => {
  it('produces a connected road component reaching both POIs', async () => {
    // Use a water-seed-free configuration so the road is a single component
    // crossing from A to B with no water-induced gaps.
    const { map } = await generateWithNoise(32, 32, 1, makeSeed());

    const seedNearA = findNearestRoad(map.tiles, 5, 16);
    expect(seedNearA).not.toBeNull();
    const connected = floodConnected(map.tiles, seedNearA!);
    const nearB = [...connected].some(k => {
      const [x, y] = k.split(',').map(Number);
      return Math.abs(x - 26) <= 3 && Math.abs(y - 16) <= 3;
    });
    expect(nearB).toBe(true);
  });

  it('places bridges over water with autoBridge=true (default for non-river)', async () => {
    // Seed 3 with POI B at x=42 puts shallow water on the path → bridges expected.
    const { map } = await generateWithNoise(48, 32, 3, makeSeed({
      size: { width: 48, height: 32 },
      pois: [
        { id: 'a', type: 'village', name: 'A', position: { x: 5,  y: 16 } },
        { id: 'b', type: 'village', name: 'B', position: { x: 42, y: 16 } },
      ],
    }));
    let bridges = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 48; x++) {
        if (map.tiles[y]?.[x]?.type === 'bridge') bridges++;
      }
    }
    expect(bridges).toBeGreaterThan(0);
  });

  it('does not place bridges when autoBridge=false', async () => {
    const { map } = await generateWithNoise(48, 32, 3, makeSeed({
      size: { width: 48, height: 32 },
      pois: [
        { id: 'a', type: 'village', name: 'A', position: { x: 5,  y: 16 } },
        { id: 'b', type: 'village', name: 'B', position: { x: 42, y: 16 } },
      ],
      connections: [{ from: 'a', to: 'b', type: 'road', style: 'dirt', autoBridge: false }],
    }));
    let bridges = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) {
      if (map.tiles[y]?.[x]?.type === 'bridge') bridges++;
    }
    expect(bridges).toBe(0);
  });
});
