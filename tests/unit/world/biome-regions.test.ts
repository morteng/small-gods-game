import { describe, it, expect } from 'vitest';
import { biomeRegions } from '@/world/biome-regions';
import type { BiomeMap } from '@/core/types';

function mkMap(rows: string[][]): BiomeMap {
  const h = rows.length, w = rows[0].length;
  const biomes = new Array<string>(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) biomes[y * w + x] = rows[y][x];
  return { biomes, width: w, height: h };
}

describe('biomeRegions', () => {
  it('returns one region per connected biome blob', () => {
    const m = mkMap([
      ['F', 'F', 'G'],
      ['F', 'F', 'G'],
      ['G', 'G', 'G'],
    ]);
    const r = biomeRegions(m);
    expect(r).toHaveLength(2);
    const forest = r.find(x => x.biome === 'F')!;
    expect(forest).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
    const grass = r.find(x => x.biome === 'G')!;
    // Grass is connected (top-right column + bottom row meet at (2,1)–(2,2))
    expect(grass.biome).toBe('G');
  });

  it('disconnected blobs of the same biome become separate regions', () => {
    const m = mkMap([
      ['F', 'G', 'F'],
      ['F', 'G', 'F'],
    ]);
    const r = biomeRegions(m);
    const forests = r.filter(x => x.biome === 'F');
    expect(forests).toHaveLength(2);
  });

  it('skips ocean biomes', () => {
    const m = mkMap([
      ['deep_ocean', 'ocean', 'F'],
      ['ocean',      'F',     'F'],
    ]);
    const r = biomeRegions(m);
    expect(r.every(x => x.biome !== 'deep_ocean' && x.biome !== 'ocean')).toBe(true);
    expect(r.some(x => x.biome === 'F')).toBe(true);
  });

  it('is deterministic — same input → same output order', () => {
    const m = mkMap([
      ['F', 'G'],
      ['G', 'F'],
    ]);
    expect(biomeRegions(m)).toEqual(biomeRegions(m));
  });

  it('uses 4-neighbour connectivity (diagonals are NOT connected)', () => {
    const m = mkMap([
      ['F', 'G'],
      ['G', 'F'],
    ]);
    const r = biomeRegions(m);
    const forests = r.filter(x => x.biome === 'F');
    expect(forests).toHaveLength(2);
  });

  it('bounding box covers all cells of the blob', () => {
    const m = mkMap([
      ['G', 'F', 'F', 'G'],
      ['G', 'F', 'F', 'G'],
      ['G', 'F', 'F', 'G'],
    ]);
    const r = biomeRegions(m);
    const forest = r.find(x => x.biome === 'F')!;
    expect(forest).toMatchObject({ x: 1, y: 0, w: 2, h: 3 });
  });
});
