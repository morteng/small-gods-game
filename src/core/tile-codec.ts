import type { Tile, TileState } from '@/core/types';

/**
 * Compact tile codec for the save path.
 *
 * `GameMap.tiles` on a real world is ~171k Tile objects. IndexedDB `put()`
 * structured-clones its value synchronously, and walking those objects was the
 * dominant cost of the autosave main-thread task (~720 ms measured 2026-07-13).
 * Encoding the grid into flat typed arrays turns that clone into a handful of
 * memcpys — near-free — and the encode itself is a linear typed-array fill.
 *
 * Layout (row-major, `index = y * width + x`):
 * - `typeTable`  — interned string table shared by `type` and `baseType`.
 * - `typeOrd`    — Uint16 ordinal into `typeTable` per tile (`tile.type`).
 * - `flags`      — Uint8 per tile: bit0 walkable · bits1-2 state ordinal
 *                  (void=0 / realizing=1 / realized=2) · bit3 `irrigated === true`.
 * - `baseTypeIndex` / `baseTypeOrd` — sparse parallel channel for `baseType`
 *   (only carved road / settlement-growth tiles carry it).
 * - `exceptions` — everything else, per tile: rare optional fields
 *   (`realizedAt`, `height`, `bridgeDirection`, an explicit `irrigated: false`,
 *   x/y that disagree with the grid position) AND any field added to `Tile`
 *   later. The encoder sweeps each tile's own keys, so an unhandled new field
 *   degrades to the sparse exceptions list instead of being silently dropped.
 *
 * `decodeTiles` reverses the mapping exactly: encode → decode round-trips to
 * deep equality (guard: `tests/unit/tile-codec.test.ts`).
 */

const STATES: readonly TileState[] = ['void', 'realizing', 'realized'];
const STATE_ORD: Record<string, number | undefined> = { void: 0, realizing: 1, realized: 2 };

export interface TileException {
  /** Linear tile index (`y * width + x`). */
  index: number;
  /** Verbatim field values to re-apply after the flat decode. */
  fields: Record<string, unknown>;
}

export interface EncodedTiles {
  width: number;
  height: number;
  /** Interned strings for `typeOrd` + `baseTypeOrd`. */
  typeTable: string[];
  typeOrd: Uint16Array;
  flags: Uint8Array;
  /** Sparse `baseType` channel: parallel arrays, tile indices ascending. */
  baseTypeIndex: Uint32Array;
  baseTypeOrd: Uint16Array;
  exceptions: TileException[];
}

/** Copy a value out of / into the codec boundary without aliasing mutable state.
 *  Primitives copy by value; the rare object-valued exception is deep-cloned. */
function detach(v: unknown): unknown {
  return v !== null && typeof v === 'object' ? structuredClone(v) : v;
}

/**
 * Encode a tile grid into the compact form. Synchronous and allocation-light —
 * safe inside the live save factory (`toSaveFileLive`), which must complete
 * within the same task as the IDB `put()`. The returned arrays are always
 * freshly built (never alias `tiles`), so the encoded map is stable even after
 * the live world mutates.
 */
export function encodeTiles(tiles: Tile[][], width: number, height: number): EncodedTiles {
  const n = width * height;
  const typeTable: string[] = [];
  const ordOf = new Map<string, number>();
  const intern = (s: string): number => {
    let ord = ordOf.get(s);
    if (ord === undefined) {
      ord = typeTable.length;
      if (ord > 0xffff) throw new Error('tile-codec: more than 65536 distinct tile type strings');
      typeTable.push(s);
      ordOf.set(s, ord);
    }
    return ord;
  };

  const typeOrd = new Uint16Array(n);
  const flags = new Uint8Array(n);
  const baseIdx: number[] = [];
  const baseOrd: number[] = [];
  const exceptions: TileException[] = [];

  for (let y = 0; y < height; y++) {
    const row = tiles[y];
    for (let x = 0; x < width; x++) {
      const index = y * width + x;

      // FAST PATH: the overwhelming majority of tiles carry exactly the five
      // required fields ({type,x,y,walkable,state}, one shared hidden class),
      // so their named reads stay monomorphic — but ONLY because every tile
      // with extra fields branches to the generic sweep below BEFORE any named
      // read happens (mixing shapes through these read sites would go
      // megamorphic, ~100 ns/read — measured 5-20x the cost of the whole
      // encode). The key-count gate is what keeps the shapes separated.
      const plain = row[x];
      if (Object.keys(plain).length === 5) {
        const ord = STATE_ORD[plain.state];
        if (
          typeof plain.type === 'string' && ord !== undefined &&
          typeof plain.walkable === 'boolean' && plain.x === x && plain.y === y
        ) {
          typeOrd[index] = intern(plain.type);
          flags[index] = (plain.walkable ? 1 : 0) | (ord << 1);
          continue;
        }
        // five keys but unexpected values (undefined-valued key, off-grid x/y,
        // unknown state) — fall through to the exact generic sweep.
      }

      // GENERIC SWEEP: tiles come in many hidden-class shapes (each
      // optional-field combination is its own shape), so named reads here
      // would be megamorphic. Every field is therefore read exactly once via
      // the for-in keyed load `t[key]`, which shares one polymorphic access
      // site (and hits V8's enum-cache indexed load once optimized).
      const t = row[x] as unknown as Record<string, unknown>;
      let f = 0;
      let fields: Record<string, unknown> | null = null;

      // Sweep the tile's own keys so a field this codec doesn't know about
      // (added to Tile later) lands in `exceptions` instead of vanishing.
      for (const key in t) {
        const v = t[key];
        switch (key) {
          case 'type':
            typeOrd[index] = intern(v as string);
            break;
          case 'walkable':
            if (v === true) f |= 1;
            else if (v !== false) (fields ??= {}).walkable = v; // malformed: exact round-trip
            break;
          case 'state': {
            const ord = STATE_ORD[v as string];
            if (ord === undefined) (fields ??= {}).state = v;
            else f |= ord << 1;
            break;
          }
          case 'x':
            if (v !== x) (fields ??= {}).x = v;
            break;
          case 'y':
            if (v !== y) (fields ??= {}).y = v;
            break;
          case 'irrigated':
            if (v === true) f |= 8;
            else (fields ??= {}).irrigated = v; // explicit false/undefined: exact round-trip
            break;
          case 'baseType':
            if (typeof v === 'string') {
              baseIdx.push(index);
              baseOrd.push(intern(v));
            } else {
              (fields ??= {}).baseType = v;
            }
            break;
          default:
            (fields ??= {})[key] = detach(v);
        }
      }

      flags[index] = f;
      if (fields) exceptions.push({ index, fields });
    }
  }

  return {
    width,
    height,
    typeTable,
    typeOrd,
    flags,
    baseTypeIndex: Uint32Array.from(baseIdx),
    baseTypeOrd: Uint16Array.from(baseOrd),
    exceptions,
  };
}

/** Rebuild the full Tile grid from the compact form. Inverse of `encodeTiles`. */
export function decodeTiles(enc: EncodedTiles): Tile[][] {
  const { width, height, typeTable, typeOrd, flags, baseTypeIndex, baseTypeOrd, exceptions } = enc;
  const tiles: Tile[][] = new Array(height);
  for (let y = 0; y < height; y++) {
    const row: Tile[] = new Array(width);
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const f = flags[index];
      const tile: Tile = {
        type: typeTable[typeOrd[index]],
        x,
        y,
        walkable: (f & 1) !== 0,
        state: STATES[(f >> 1) & 3] ?? 'realized',
      };
      if (f & 8) tile.irrigated = true;
      row[x] = tile;
    }
    tiles[y] = row;
  }
  for (let i = 0; i < baseTypeIndex.length; i++) {
    const index = baseTypeIndex[i];
    tiles[(index / width) | 0][index % width].baseType = typeTable[baseTypeOrd[i]];
  }
  for (const ex of exceptions) {
    const tile = tiles[(ex.index / width) | 0][ex.index % width] as unknown as Record<string, unknown>;
    for (const key of Object.keys(ex.fields)) {
      tile[key] = detach(ex.fields[key]);
    }
  }
  return tiles;
}

/** Approximate persisted size of the flat channels, for diagnostics/benches. */
export function encodedTilesByteLength(enc: EncodedTiles): number {
  let table = 0;
  for (const s of enc.typeTable) table += s.length * 2;
  return (
    enc.typeOrd.byteLength +
    enc.flags.byteLength +
    enc.baseTypeIndex.byteLength +
    enc.baseTypeOrd.byteLength +
    table
  );
}
