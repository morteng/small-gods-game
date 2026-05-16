import { describe, it, expect } from 'vitest';
import { tickNpcMovement } from '@/sim/npc-movement';
import type { GameMap, NpcInstance, Tile } from '@/core/types';

function buildMap(rows: string[][]): GameMap {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({
    type, x, y, walkable: type !== 'water',
  })));
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function makeNpc(overrides: Partial<NpcInstance>): NpcInstance {
  return {
    id: 'n1', name: 'n1', role: 'farmer', seed: 42,
    tileX: 1, tileY: 1, direction: 'down', frame: 0, frameTimer: 0,
    ...overrides,
  };
}

const grass = (w: number, h: number) => Array.from({ length: h }, () => Array<string>(w).fill('grass'));

describe('tickNpcMovement', () => {
  it('does not move before its cooldown elapses', () => {
    const map = buildMap(grass(5, 5));
    const npc = makeNpc({ tileX: 2, tileY: 2, moveCooldown: 5000 });
    tickNpcMovement([npc], map, 16);
    expect(npc.tileX).toBe(2);
    expect(npc.tileY).toBe(2);
  });

  it('moves to a walkable neighbour once its cooldown reaches zero', () => {
    const map = buildMap(grass(5, 5));
    const npc = makeNpc({ tileX: 2, tileY: 2, moveCooldown: 5 });
    tickNpcMovement([npc], map, 100);
    const movedX = Math.abs(npc.tileX - 2) === 1 && npc.tileY === 2;
    const movedY = Math.abs(npc.tileY - 2) === 1 && npc.tileX === 2;
    expect(movedX || movedY).toBe(true);
  });

  it('refuses to step onto a non-walkable tile (water)', () => {
    const rows = grass(5, 5);
    // Surround (2,2) with water
    rows[1][2] = 'water'; rows[3][2] = 'water'; rows[2][1] = 'water'; rows[2][3] = 'water';
    const map = buildMap(rows);
    const npc = makeNpc({ tileX: 2, tileY: 2, moveCooldown: 0 });
    tickNpcMovement([npc], map, 16);
    expect(npc.tileX).toBe(2);
    expect(npc.tileY).toBe(2);
  });

  it('kicks frame off idle when it moves', () => {
    const map = buildMap(grass(5, 5));
    const npc = makeNpc({ tileX: 2, tileY: 2, frame: 0, moveCooldown: 0 });
    tickNpcMovement([npc], map, 16);
    if (npc.tileX !== 2 || npc.tileY !== 2) {
      expect(npc.frame).toBeGreaterThan(0);
    }
  });

  it('stays in bounds at the map edge', () => {
    const map = buildMap(grass(5, 5));
    // Many ticks at corner; never escape to -1 or 5.
    const npc = makeNpc({ tileX: 0, tileY: 0, moveCooldown: 0 });
    for (let i = 0; i < 50; i++) {
      npc.moveCooldown = 0;
      tickNpcMovement([npc], map, 16);
      expect(npc.tileX).toBeGreaterThanOrEqual(0);
      expect(npc.tileY).toBeGreaterThanOrEqual(0);
      expect(npc.tileX).toBeLessThan(5);
      expect(npc.tileY).toBeLessThan(5);
    }
  });
});
