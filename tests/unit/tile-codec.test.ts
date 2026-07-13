import { describe, it, expect } from 'vitest';
import { encodeTiles, decodeTiles, encodedTilesByteLength } from '@/core/tile-codec';
import type { Tile, TileState } from '@/core/types';

const TYPES = ['grass', 'water', 'forest', 'mountain', 'road', 'farm_field', 'sand', 'dirt'];
const STATES: TileState[] = ['void', 'realizing', 'realized'];

/** Deterministic hash so the fixture grid is varied but reproducible. */
function h(x: number, y: number, salt: number): number {
  let v = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return (v ^ (v >>> 16)) >>> 0;
}

function buildGrid(width: number, height: number, withRareFields: boolean): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) {
      const r = h(x, y, 1);
      const t: Tile = {
        type: TYPES[r % TYPES.length],
        x,
        y,
        walkable: (r & 1) === 0,
        state: STATES[(r >>> 3) % 3],
      };
      if (r % 11 === 0) t.irrigated = true;
      if (r % 13 === 0) t.baseType = TYPES[(r >>> 5) % TYPES.length];
      if (withRareFields) {
        if (r % 97 === 0) t.realizedAt = r % 100000;
        if (r % 101 === 0) t.height = (r % 50) / 10;
        if (r % 103 === 0) t.bridgeDirection = (r & 2) ? 'north' : 'east';
      }
      row.push(t);
    }
    tiles.push(row);
  }
  return tiles;
}

describe('tile-codec round-trip', () => {
  it('round-trips a varied grid to deep equality (every field)', () => {
    const w = 40, hgt = 30;
    const tiles = buildGrid(w, hgt, true);
    const decoded = decodeTiles(encodeTiles(tiles, w, hgt));
    expect(decoded).toEqual(tiles);
  });

  it('round-trips every optional field exactly, including awkward values', () => {
    const tiles: Tile[][] = [[
      { type: 'grass', x: 0, y: 0, walkable: true, state: 'realized' },
      // explicit irrigated:false must survive (not collapse to an absent key)
      { type: 'farm_field', x: 1, y: 0, walkable: true, state: 'realized', irrigated: false },
      { type: 'farm_field', x: 2, y: 0, walkable: true, state: 'realized', irrigated: true },
      { type: 'road', x: 3, y: 0, walkable: true, state: 'realized', baseType: 'grass' },
      { type: 'bridge', x: 4, y: 0, walkable: true, state: 'void', bridgeDirection: 'north', height: 1.5 },
      { type: 'grass', x: 5, y: 0, walkable: false, state: 'realizing', realizedAt: 12345 },
    ]];
    const decoded = decodeTiles(encodeTiles(tiles, 6, 1));
    expect(decoded).toEqual(tiles);
    // key-presence exactness, beyond toEqual
    expect('irrigated' in decoded[0][0]).toBe(false);
    expect(decoded[0][1].irrigated).toBe(false);
    expect(decoded[0][2].irrigated).toBe(true);
  });

  it('preserves fields the codec does not know about via the exceptions sweep', () => {
    const tiles: Tile[][] = [[
      { type: 'grass', x: 0, y: 0, walkable: true, state: 'realized' },
      {
        type: 'grass', x: 1, y: 0, walkable: true, state: 'realized',
        // simulate a future Tile field the codec has never heard of
        ...( { futureField: { nested: [1, 2, 3] }, futureFlag: 'later' } as object),
      },
    ]];
    const decoded = decodeTiles(encodeTiles(tiles, 2, 1));
    expect(decoded).toEqual(tiles);
    // and the decoded copy must not alias the source's nested object
    const src = (tiles[0][1] as unknown as Record<string, { nested: number[] }>).futureField;
    const out = (decoded[0][1] as unknown as Record<string, { nested: number[] }>).futureField;
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });

  it('preserves x/y that disagree with the grid position (exception path)', () => {
    const tiles: Tile[][] = [[
      { type: 'grass', x: 99, y: 42, walkable: true, state: 'realized' },
    ]];
    expect(decodeTiles(encodeTiles(tiles, 1, 1))).toEqual(tiles);
  });

  it('decoded tiles never alias the source grid', () => {
    const tiles = buildGrid(8, 8, true);
    const decoded = decodeTiles(encodeTiles(tiles, 8, 8));
    expect(decoded).not.toBe(tiles);
    expect(decoded[0]).not.toBe(tiles[0]);
    expect(decoded[0][0]).not.toBe(tiles[0][0]);
    // mutating the source after encode must not leak into a later decode
    const enc = encodeTiles(tiles, 8, 8);
    tiles[0][0].type = 'MUTATED';
    expect(decodeTiles(enc)[0][0].type).not.toBe('MUTATED');
  });
});

describe('tile-codec performance (a real-world 400×430 map)', () => {
  it('encodes ~172k tiles well under the ceiling and stays compact', () => {
    const w = 400, hgt = 430;
    const tiles = buildGrid(w, hgt, true);

    encodeTiles(tiles, w, hgt); // warm the JIT once — measure the steady state autosave pays
    const t0 = performance.now();
    const enc = encodeTiles(tiles, w, hgt);
    const encodeMs = performance.now() - t0;

    const bytes = encodedTilesByteLength(enc);
    // eslint-disable-next-line no-console
    console.log(
      `[tile-codec bench] ${w}x${hgt} = ${w * hgt} tiles: encode ${encodeMs.toFixed(1)} ms, ` +
      `flat channels ${(bytes / 1024).toFixed(0)} KiB, ${enc.exceptions.length} exceptions, ` +
      `${enc.typeTable.length} interned types`,
    );

    // Generous ceiling so CI never flakes; locally this runs in ~10-40 ms.
    expect(encodeMs).toBeLessThan(500);
    // The flat channels must stay a few hundred KiB — that's the whole point.
    expect(bytes).toBeLessThan(2 * 1024 * 1024);

    // Full-grid field-exact verification with a fast manual sweep (toEqual on
    // 172k objects is too slow for CI).
    const dec = decodeTiles(enc);
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        const a = tiles[y][x];
        const b = dec[y][x];
        if (
          a.type !== b.type || a.x !== b.x || a.y !== b.y ||
          a.walkable !== b.walkable || a.state !== b.state ||
          a.irrigated !== b.irrigated || a.baseType !== b.baseType ||
          a.realizedAt !== b.realizedAt || a.height !== b.height ||
          a.bridgeDirection !== b.bridgeDirection
        ) {
          expect.fail(`tile mismatch at (${x},${y}): ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        }
      }
    }
  });
});
