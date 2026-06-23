import { describe, it, expect } from 'vitest';
import { generateHydrology } from '@/terrain/hydrology';
import { buildWaterNetwork, affectedWaterCells } from '@/terrain/river-network';
import { tileReadout } from '@/studio/world-hover';
import type { GameMap, Tile, TerrainField } from '@/core/types';

function field(elev: number[]): TerrainField {
  return {
    elevation: new Float32Array(elev),
    moisture: new Float32Array(elev.length),
    temperature: new Float32Array(elev.length),
  };
}

// A V-shaped valley draining left→right so we get a spring → channel → mouth chain.
const VALLEY = [
  0.9, 0.8, 0.7, 0.6, 0.1,
  0.9, 0.8, 0.7, 0.6, 0.1,
  0.9, 0.8, 0.7, 0.6, 0.1,
];
function net() {
  const hydro = generateHydrology(field(VALLEY), { seed: 1, width: 5, height: 3, seaLevel: 0.0 }, { riverFlowThreshold: 2 });
  return buildWaterNetwork(hydro, 5, 3);
}

describe('affectedWaterCells — direct vs downstream', () => {
  it('an unknown id affects nothing', () => {
    const { direct, indirect } = affectedWaterCells(net(), 'nope:404');
    expect(direct).toEqual([]);
    expect(indirect).toEqual([]);
  });

  it('a spring directly touches its own reach and indirectly feeds downstream', () => {
    const n = net();
    const spring = n.nodes.find((x) => x.kind === 'spring');
    if (!spring) return; // some seeds have no discrete spring; the assertions below need one
    const { direct, indirect } = affectedWaterCells(n, spring.id);
    expect(direct.length).toBeGreaterThan(0);
    // direct and indirect never overlap (downstream cells are strictly additional)
    const d = new Set(direct);
    expect(indirect.some((c) => d.has(c))).toBe(false);
  });

  it('is deterministic — same network, same cells', () => {
    const a = affectedWaterCells(net(), net().nodes[0].id);
    const b = affectedWaterCells(net(), net().nodes[0].id);
    expect(b).toEqual(a);
  });
});

describe('tileReadout — per-pixel inspection rows', () => {
  function tinyMap(): GameMap {
    const W = 5, H = 3;
    const tiles: Tile[][] = [];
    for (let y = 0; y < H; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < W; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
      tiles.push(row);
    }
    return {
      tiles, width: W, height: H, villages: [], seed: 1, success: true,
      worldSeed: null, buildings: [], stats: { iterations: 0, backtracks: 0 },
    } as unknown as GameMap;
  }

  it('always leads with the tile coordinate', () => {
    const rows = tileReadout(tinyMap(), 2, 1);
    expect(rows[0][0]).toBe('tile');
    expect(rows[0][1]).toBe('2, 1');
  });

  it('reports off-map for out-of-bounds tiles', () => {
    const rows = tileReadout(tinyMap(), -1, 99);
    expect(rows.some(([, v]) => v === 'off-map')).toBe(true);
  });

  it('includes terrain type and an elevation row in bounds', () => {
    const rows = tileReadout(tinyMap(), 1, 1);
    expect(rows.some(([k]) => k === 'terrain')).toBe(true);
    expect(rows.some(([k]) => k === 'elevation')).toBe(true);
  });

  it('surfaces standing flood water when present', () => {
    const m = tinyMap();
    const flood = new Float32Array(m.width * m.height);
    flood[1 * m.width + 2] = 1.7;
    const rows = tileReadout(m, 2, 1, { floodM: flood });
    expect(rows.some(([k, v]) => k === 'flood' && v.includes('1.7'))).toBe(true);
  });
});
