import { describe, it, expect } from 'vitest';
import { placeDecorations } from '@/map/decoration-placer';
import type { GameMap, Tile } from '@/core/types';

/** Build a minimal GameMap with a single tile type */
function makeMap(tileType: string, width = 10, height = 10): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) {
      row.push({ type: tileType, x, y, walkable: true });
    }
    tiles.push(row);
  }
  return {
    tiles,
    width,
    height,
    villages: [],
    seed: 42,
    success: true,
    worldSeed: null,
    stats: { iterations: 0, backtracks: 0 },
    buildings: [],
  };
}

describe('placeDecorations', () => {
  it('is deterministic — same map+seed produces identical decorations', () => {
    const map = makeMap('forest');
    const a = placeDecorations(map, 12345);
    const b = placeDecorations(map, 12345);
    expect(a).toEqual(b);
  });

  it('different seeds produce different decoration layouts', () => {
    const map = makeMap('dense_forest');
    const a = placeDecorations(map, 1);
    const b = placeDecorations(map, 999999);
    // Very unlikely to be identical with different seeds
    const aIds = a.map(d => `${d.tileX},${d.tileY}`).join('|');
    const bIds = b.map(d => `${d.tileX},${d.tileY}`).join('|');
    expect(aIds).not.toBe(bIds);
  });

  it('only forest-type tiles produce tree decorations', () => {
    const map = makeMap('grass');
    const decos = placeDecorations(map, 42);
    expect(decos).toHaveLength(0);
  });

  it('water tiles produce no decorations', () => {
    const map = makeMap('water');
    const decos = placeDecorations(map, 42);
    expect(decos).toHaveLength(0);
  });

  it('dead_forest tiles produce only dead variant trees', () => {
    const map = makeMap('dead_forest', 20, 20);
    const decos = placeDecorations(map, 42);
    expect(decos.length).toBeGreaterThan(0);
    for (const d of decos) {
      expect(d.variant).toBe('dead');
    }
  });

  it('dense_forest has more trees than regular forest', () => {
    const denseMap = makeMap('dense_forest', 20, 20);
    const regularMap = makeMap('forest', 20, 20);
    const denseCount  = placeDecorations(denseMap, 42).length;
    const regularCount = placeDecorations(regularMap, 42).length;
    expect(denseCount).toBeGreaterThan(regularCount);
  });

  it('all decoration positions are within map bounds', () => {
    const map = makeMap('forest', 15, 15);
    const decos = placeDecorations(map, 7);
    for (const d of decos) {
      expect(d.tileX).toBeGreaterThanOrEqual(0);
      expect(d.tileX).toBeLessThan(map.width);
      expect(d.tileY).toBeGreaterThanOrEqual(0);
      expect(d.tileY).toBeLessThan(map.height);
    }
  });

  it('offsetX and offsetY are in the expected range', () => {
    const map = makeMap('dense_forest', 20, 20);
    const decos = placeDecorations(map, 42);
    for (const d of decos) {
      expect(d.offsetX).toBeGreaterThanOrEqual(-0.15);
      expect(d.offsetX).toBeLessThanOrEqual(0.15);
      expect(d.offsetY).toBeGreaterThanOrEqual(-0.15);
      expect(d.offsetY).toBeLessThanOrEqual(0.15);
    }
  });

  it('all decorations have category "tree"', () => {
    const map = makeMap('forest', 10, 10);
    const decos = placeDecorations(map, 1);
    for (const d of decos) {
      expect(d.category).toBe('tree');
    }
  });

  it('spriteCol is in range 0–7', () => {
    const map = makeMap('dense_forest', 20, 20);
    const decos = placeDecorations(map, 42);
    for (const d of decos) {
      expect(d.spriteCol).toBeGreaterThanOrEqual(0);
      expect(d.spriteCol).toBeLessThanOrEqual(7);
    }
  });
});
