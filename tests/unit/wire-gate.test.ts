import { describe, it, expect } from 'vitest';
import { wireGateToRoad } from '@/world/wire-gate';
import type { Anchor } from '@/world/anchors';
import type { GameMap, Tile } from '@/core/types';

/** Road types recognised by building-placer and wire-gate */
const ROAD_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);

/** Build a small grass map (all walkable, all realized). */
function makeGrassMap(w: number, h: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    }
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
}

/**
 * Grass map (7×7) with a horizontal dirt_road at y=0.
 * Gate will be placed at (3, 4) facing north — 4 tiles away from the road.
 */
function makeGrassMapWithRoad(): GameMap {
  const map = makeGrassMap(7, 7);
  // Carve a road across row y=0
  for (let x = 0; x < 7; x++) {
    map.tiles[0][x].type = 'dirt_road';
    map.tiles[0][x].walkable = true;
  }
  return map;
}

function makeGrassMapNoRoad(): GameMap {
  return makeGrassMap(7, 7);
}

describe('wireGateToRoad', () => {
  it('carves a contiguous road/path from the gate to the nearest road', () => {
    const map = makeGrassMapWithRoad();
    // Gate at (3, 4), facing north (toward the road at y=0)
    const gate: Anchor = { kind: 'gate', x: 3, y: 4, facing: [0, -1], width: 1 };
    const ok = wireGateToRoad(gate, map);

    expect(ok).toBe(true);

    // At least one intermediate tile (not on the road row y=0, not the gate row y=4)
    // must have been carved to a road type + walkable.
    let carvedCount = 0;
    for (let y = 1; y <= 3; y++) {
      for (let x = 0; x < 7; x++) {
        const tile = map.tiles[y][x];
        if (ROAD_TYPES.has(tile.type) && tile.walkable) carvedCount++;
      }
    }
    expect(carvedCount).toBeGreaterThan(0);
  });

  it('the gate cell itself is marked walkable', () => {
    const map = makeGrassMapWithRoad();
    const gate: Anchor = { kind: 'gate', x: 3, y: 4, facing: [0, -1], width: 1 };
    wireGateToRoad(gate, map);

    const gateTile = map.tiles[4][3];
    expect(gateTile.walkable).toBe(true);
  });

  it('returns false when no road is within range', () => {
    const map = makeGrassMapNoRoad();
    const gate: Anchor = { kind: 'gate', x: 3, y: 3, facing: [0, 1], width: 1 };
    const ok = wireGateToRoad(gate, map, 4);
    expect(ok).toBe(false);
  });

  it('does not carve anything when no road found', () => {
    const map = makeGrassMapNoRoad();
    const gate: Anchor = { kind: 'gate', x: 3, y: 3, facing: [0, 1], width: 1 };
    wireGateToRoad(gate, map, 4);

    // All tiles should remain grass
    let carvedCount = 0;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        if (ROAD_TYPES.has(map.tiles[y][x].type)) carvedCount++;
      }
    }
    expect(carvedCount).toBe(0);
  });
});
