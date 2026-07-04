import { describe, it, expect } from 'vitest';
import { bumpTilesRev } from '@/core/tile-rev';
import { packColorFieldMemo } from '@/render/gpu/terrain-field';
import { TrampleGrid, TRAMPLE } from '@/sim/trample';
import type { GameMap, Tile } from '@/core/types';

function makeMap(w = 8, h = 8): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

describe('tilesRev — runtime tile mutations must repaint the terrain color field', () => {
  it('memoises across frames on a static map (same array reference)', () => {
    const map = makeMap();
    const a = packColorFieldMemo(map);
    const b = packColorFieldMemo(map);
    expect(b).toBe(a);
  });

  it('a bare tile.type mutation WITHOUT a rev bump is invisible (the memo contract)', () => {
    const map = makeMap();
    const a = packColorFieldMemo(map);
    map.tiles[2][3].type = 'dirt';
    const b = packColorFieldMemo(map);
    expect(b).toBe(a); // documents why every runtime mutator MUST bump
  });

  it('bumpTilesRev invalidates the memo and the new colors reflect the mutation', () => {
    const map = makeMap();
    const a = packColorFieldMemo(map);
    const idx = 2 * map.width + 3;
    const grassColor = a[idx];
    map.tiles[2][3].type = 'dirt';
    bumpTilesRev(map);
    const b = packColorFieldMemo(map);
    expect(b).not.toBe(a);
    expect(b[idx]).not.toBe(grassColor);
  });

  it('TrampleGrid.promoteDecay bumps the rev when it promotes a trail', () => {
    const map = makeMap();
    const grid = new TrampleGrid(map.width, map.height);
    const before = map.tilesRev ?? 0;
    grid.deposit(3, 2, TRAMPLE.PROMOTE_HI); // straight to the promotion threshold
    grid.promoteDecay(map);
    expect(map.tiles[2][3].type).toBe('dirt');
    expect(map.tilesRev ?? 0).toBeGreaterThan(before);
  });

  it('TrampleGrid.promoteDecay does NOT bump when nothing promotes or reverts', () => {
    const map = makeMap();
    const grid = new TrampleGrid(map.width, map.height);
    grid.deposit(3, 2, 10); // well below PROMOTE_HI
    const before = map.tilesRev ?? 0;
    grid.promoteDecay(map);
    expect(map.tilesRev ?? 0).toBe(before);
  });

  it('TrampleGrid.reconcileTiles bumps when a restore changes tiles', () => {
    const map = makeMap();
    const live = new TrampleGrid(map.width, map.height);
    live.deposit(3, 2, TRAMPLE.PROMOTE_HI);
    live.promoteDecay(map); // carves dirt at (3,2)
    const restored = new TrampleGrid(map.width, map.height); // empty grid = pre-trail state
    const before = map.tilesRev ?? 0;
    restored.reconcileTiles(map, live); // must revert the dirt
    expect(map.tiles[2][3].type).toBe('grass');
    expect(map.tilesRev ?? 0).toBeGreaterThan(before);
  });
});
