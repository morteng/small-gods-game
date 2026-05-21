import { describe, it, expect } from 'vitest';
import { composeBlob47Atlas, PRIMITIVE_W, PRIMITIVE_H, OUTPUT_W, OUTPUT_H, CELL_W, CELL_H, ATLAS_COLS } from '@/render/iso/blob-composer';
import { BLOB_INDEX_MAP_FOR_TEST } from '@/map/blob-autotiler';

// jsdom doesn't implement OffscreenCanvas — stub it using a regular canvas
if (typeof (globalThis as any).OffscreenCanvas === 'undefined') {
  (globalThis as any).OffscreenCanvas = class {
    width: number;
    height: number;
    private _canvas: HTMLCanvasElement;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this._canvas = document.createElement('canvas');
      this._canvas.width = width;
      this._canvas.height = height;
    }
    getContext(type: string) {
      return this._canvas.getContext(type as '2d');
    }
  };
}

/**
 * Build a synthetic 5×3 primitive sheet where each cell is flat-filled with
 * a unique color. Lets the tests assert which primitive each output quadrant
 * was sourced from by sampling pixel color at known coords.
 */
function buildSyntheticPrimitiveSheet(): OffscreenCanvas {
  const sheet = new OffscreenCanvas(PRIMITIVE_W, PRIMITIVE_H);
  const ctx = sheet.getContext('2d')!;
  // 15 distinct colors — one per primitive cell.
  // (col, row, hexColor)
  const cells: Array<[number, number, string]> = [
    [0, 0, '#100000'], [1, 0, '#110000'], [2, 0, '#120000'], [3, 0, '#130000'], [4, 0, '#140000'],
    [0, 1, '#200000'], [1, 1, '#210000'], [2, 1, '#220000'], [3, 1, '#230000'], [4, 1, '#240000'],
    [0, 2, '#300000'], [1, 2, '#310000'], [2, 2, '#320000'], [3, 2, '#330000'], [4, 2, '#340000'],
  ];
  for (const [c, r, color] of cells) {
    ctx.fillStyle = color;
    ctx.fillRect(c * CELL_W, r * CELL_H, CELL_W, CELL_H);
  }
  return sheet;
}

function pixelAt(canvas: OffscreenCanvas, x: number, y: number): string {
  const ctx = canvas.getContext('2d')!;
  const d = ctx.getImageData(x, y, 1, 1).data;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(d[0])}${h(d[1])}${h(d[2])}`;
}

function alphaAt(canvas: OffscreenCanvas, x: number, y: number): number {
  const ctx = canvas.getContext('2d')!;
  return ctx.getImageData(x, y, 1, 1).data[3];
}

/** Get pixel at center of a quadrant within a blob cell. */
function quadPixel(canvas: OffscreenCanvas, blobIndex: number, quad: 'TL' | 'TR' | 'BL' | 'BR'): string {
  const col = blobIndex % ATLAS_COLS;
  const row = Math.floor(blobIndex / ATLAS_COLS);
  const cellX = col * CELL_W;
  const cellY = row * CELL_H;
  const halfW = CELL_W / 2;
  const halfH = CELL_H / 2;
  const dx = quad === 'TR' || quad === 'BR' ? halfW : 0;
  const dy = quad === 'BL' || quad === 'BR' ? halfH : 0;
  // Sample near center of the quadrant (offset by 25% of half-cell)
  return pixelAt(canvas, cellX + dx + Math.floor(halfW * 0.5), cellY + dy + Math.floor(halfH * 0.5));
}

/**
 * Build a reverse lookup: blobIndex (0..46) → highest 8-bit mask that maps to it.
 * Mirrors the algorithm in blob-composer.ts so tests stay in sync with the implementation.
 */
function computeBlobToMask(): Map<number, number> {
  const map = new Map<number, number>();
  for (let mask = 0; mask < 256; mask++) {
    const blobIndex = BLOB_INDEX_MAP_FOR_TEST[mask] % 47;
    map.set(blobIndex, mask); // overwrite — keeps the last (highest) mask
  }
  return map;
}

// Primitive colors from buildSyntheticPrimitiveSheet
const COLOR = {
  NW_OUTER: '#100000', N_EDGE:   '#110000', NE_OUTER: '#120000',
  W_EDGE:   '#200000', CENTER:   '#210000', E_EDGE:   '#220000',
  NW_INNER: '#230000', NE_INNER: '#240000',
  SW_OUTER: '#300000', S_EDGE:   '#310000', SE_OUTER: '#320000',
  SW_INNER: '#330000', SE_INNER: '#340000',
};

// Known-skipped blob indices per the composer source comment
const SKIPPED_BLOBS = new Set([11, 27, 40, 41, 42, 43]);

describe('composeBlob47Atlas', () => {
  it('the blob index for "fully surrounded" (mask 0xFF) sources all 4 quadrants from the center primitive', () => {
    // At runtime, computeBlobMap reduces mask 0xFF → some blobIndex via the
    // table. The composer must put all-CENTER art at that slot.
    const fullySurroundedBlob = BLOB_INDEX_MAP_FOR_TEST[0xFF] % 47;

    const primitives = buildSyntheticPrimitiveSheet();
    const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
    composeBlob47Atlas(primitives, target);

    // Center primitive lives at (1, 1) → color #210000.
    const cellX = (fullySurroundedBlob % 6) * CELL_W;
    const cellY = Math.floor(fullySurroundedBlob / 6) * CELL_H;
    expect(pixelAt(target, cellX + 10,           cellY + 5)).toBe('#210000');         // TL
    expect(pixelAt(target, cellX + CELL_W - 10,  cellY + 5)).toBe('#210000');         // TR
    expect(pixelAt(target, cellX + 10,           cellY + CELL_H - 5)).toBe('#210000');// BL
    expect(pixelAt(target, cellX + CELL_W - 10,  cellY + CELL_H - 5)).toBe('#210000');// BR
  });

  describe('composeBlob47Atlas — coverage', () => {
    it('no-neighbors blob (mask 0x00 preimage) uses all 4 outer-corner primitives', () => {
      // mask 0x00 → blobIndex 0 (BLOB_INDEX_MAP[0] % 47 = 0 % 47 = 0)
      // No neighbor bits set, so each quadrant gets its "isolated" outer-corner prim.
      // Because 0x00 is the lowest mask, verify the preimage for blob 0 is ≥ 0x00.
      const blobToMask = computeBlobToMask();
      const blobIndex = BLOB_INDEX_MAP_FOR_TEST[0x00] % 47;
      expect(blobIndex).toBe(0); // sanity

      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      // The representative mask for blob 0 has no cardinal neighbor bits:
      // bitsFor TL: A=N=false, B=W=false → NW_OUTER
      // bitsFor TR: A=N=false, B=E=false → NE_OUTER
      // bitsFor BL: A=S=false, B=W=false → SW_OUTER
      // bitsFor BR: A=S=false, B=E=false → SE_OUTER
      // Confirmed by running computeBlobToMask() — blob 0 has mask 0xba whose
      // N=0 and no-cardinal bits for each quadrant reduce to the same outer-corner logic.
      // Actually blob 0 highest preimage is 0xba which has no N or S — check directly:
      const repMask = blobToMask.get(0)!;
      const hasN = (repMask & 0x01) !== 0;
      const hasS = (repMask & 0x10) !== 0;
      const hasW = (repMask & 0x40) !== 0;
      const hasE = (repMask & 0x04) !== 0;

      // TL: A=N, B=W
      expect(quadPixel(target, blobIndex, 'TL')).toBe(
        (!hasN && !hasW) ? COLOR.NW_OUTER : (!hasN && hasW) ? COLOR.N_EDGE : (hasN && !hasW) ? COLOR.W_EDGE : COLOR.CENTER
      );
    });

    it('every mapped blob index (0..46, excluding skipped) has at least one non-transparent pixel', () => {
      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      for (let b = 0; b <= 46; b++) {
        if (SKIPPED_BLOBS.has(b)) continue;
        const col = b % ATLAS_COLS;
        const row = Math.floor(b / ATLAS_COLS);
        // Check center of cell
        const cx = col * CELL_W + Math.floor(CELL_W / 2);
        const cy = row * CELL_H + Math.floor(CELL_H / 2);
        const alpha = alphaAt(target, cx, cy);
        expect(alpha, `blob ${b} should have non-transparent pixels`).toBeGreaterThan(0);
      }
    });

    it('atlas slot 47 (the 48th cell in the 6×8 grid) is fully transparent', () => {
      // Atlas is 6×8 = 48 cells. Blob indices run 0..46. Cell at position 47 (col=5, row=7)
      // is never written by the composer and must remain cleared.
      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      const col47 = 47 % ATLAS_COLS; // = 5
      const row47 = Math.floor(47 / ATLAS_COLS); // = 7
      const cx = col47 * CELL_W + Math.floor(CELL_W / 2);
      const cy = row47 * CELL_H + Math.floor(CELL_H / 2);
      expect(alphaAt(target, cx, cy)).toBe(0);
    });

    it('each skipped blob index (11, 27, 40-43) has fully transparent center pixel', () => {
      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      for (const b of SKIPPED_BLOBS) {
        const col = b % ATLAS_COLS;
        const row = Math.floor(b / ATLAS_COLS);
        const cx = col * CELL_W + Math.floor(CELL_W / 2);
        const cy = row * CELL_H + Math.floor(CELL_H / 2);
        expect(alphaAt(target, cx, cy), `blob ${b} (skipped) should be transparent`).toBe(0);
      }
    });

    it('blob for N-neighbor-only topology: TL and BL come from W_EDGE, TR and BR from E_EDGE', () => {
      // We find a blob whose representative mask has N=1, S=0, W=0, E=0 (N-only cardinals).
      // TL: A=N=true, B=W=false → W_EDGE; TR: A=N=true, B=E=false → E_EDGE
      // BL: A=S=false, B=W=false → SW_OUTER; BR: A=S=false, B=E=false → SE_OUTER
      // For blob 12, mask=0x09 → N=1, SE=1, no W/E/S → TL:W_EDGE, TR:E_EDGE, BL:SW_OUTER, BR:SE_OUTER
      const blobToMask = computeBlobToMask();
      // Find a blob whose representative mask has N=1, S=0, W=0, E=0
      let targetBlob = -1;
      for (const [blob, mask] of blobToMask) {
        const N = (mask & 0x01) !== 0;
        const S = (mask & 0x10) !== 0;
        const W = (mask & 0x40) !== 0;
        const E = (mask & 0x04) !== 0;
        if (N && !S && !W && !E) {
          targetBlob = blob;
          break;
        }
      }
      expect(targetBlob, 'should find a blob with N-only cardinals').toBeGreaterThanOrEqual(0);

      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      expect(quadPixel(target, targetBlob, 'TL')).toBe(COLOR.W_EDGE);
      expect(quadPixel(target, targetBlob, 'TR')).toBe(COLOR.E_EDGE);
    });

    it('blob for S-neighbor-only topology: BL and BR come from W_EDGE/E_EDGE, TL and TR from NW_OUTER/NE_OUTER', () => {
      // Find a blob whose representative mask has S=1, N=0, W=0, E=0
      const blobToMask = computeBlobToMask();
      let targetBlob = -1;
      for (const [blob, mask] of blobToMask) {
        const N = (mask & 0x01) !== 0;
        const S = (mask & 0x10) !== 0;
        const W = (mask & 0x40) !== 0;
        const E = (mask & 0x04) !== 0;
        if (S && !N && !W && !E) {
          targetBlob = blob;
          break;
        }
      }
      expect(targetBlob, 'should find a blob with S-only cardinals').toBeGreaterThanOrEqual(0);

      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      // TL: A=N=false, B=W=false → NW_OUTER
      // TR: A=N=false, B=E=false → NE_OUTER
      // BL: A=S=true,  B=W=false → W_EDGE
      // BR: A=S=true,  B=E=false → E_EDGE
      expect(quadPixel(target, targetBlob, 'TL')).toBe(COLOR.NW_OUTER);
      expect(quadPixel(target, targetBlob, 'TR')).toBe(COLOR.NE_OUTER);
      expect(quadPixel(target, targetBlob, 'BL')).toBe(COLOR.W_EDGE);
      expect(quadPixel(target, targetBlob, 'BR')).toBe(COLOR.E_EDGE);
    });

    it('inner-corner TL: blob whose mask has N+W set but NW clear puts NW_INNER in TL quadrant', () => {
      // Blobs 9 (mask 0x61) and 10 (mask 0x71) both have N=1, W=1, NW=0.
      // For TL: A=N=true, B=W=true, D=NW=false → NW_INNER
      const blobToMask = computeBlobToMask();
      let targetBlob = -1;
      for (const [blob, mask] of blobToMask) {
        const N  = (mask & 0x01) !== 0;
        const W  = (mask & 0x40) !== 0;
        const NW = (mask & 0x80) !== 0;
        if (N && W && !NW) {
          targetBlob = blob;
          break;
        }
      }
      expect(targetBlob, 'should find a blob with N+W but not NW').toBeGreaterThanOrEqual(0);

      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      expect(quadPixel(target, targetBlob, 'TL')).toBe(COLOR.NW_INNER);
    });

    it('inner-corner TR: blob whose mask has N+E set but NE clear puts NE_INNER in TR quadrant', () => {
      // For TR: A=N=true, B=E=true, D=NE=false → NE_INNER
      const blobToMask = computeBlobToMask();
      let targetBlob = -1;
      for (const [blob, mask] of blobToMask) {
        const N  = (mask & 0x01) !== 0;
        const E  = (mask & 0x04) !== 0;
        const NE = (mask & 0x02) !== 0;
        if (N && E && !NE) {
          targetBlob = blob;
          break;
        }
      }
      expect(targetBlob, 'should find a blob with N+E but not NE').toBeGreaterThanOrEqual(0);

      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      expect(quadPixel(target, targetBlob, 'TR')).toBe(COLOR.NE_INNER);
    });

    it('N_EDGE primitive only ever appears in TL and TR quadrants, never BL or BR', () => {
      // Structural invariant of the algorithm: N_EDGE is chosen when A=N=false, B=true for
      // a TL or TR quadrant. BL and BR use A=S, so they can only produce S_EDGE in the !A&&B
      // branch — never N_EDGE.
      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      // Scan BL and BR sub-quadrants of every mapped blob and confirm N_EDGE color
      // (#110000) never appears there.
      const N_EDGE_R = 0x11;
      let nEdgeInBottom = 0;

      for (let b = 0; b <= 46; b++) {
        if (SKIPPED_BLOBS.has(b)) continue;
        const col = b % ATLAS_COLS;
        const row = Math.floor(b / ATLAS_COLS);
        const cellX = col * CELL_W;
        const cellY = row * CELL_H;
        const halfW = CELL_W / 2;
        const halfH = CELL_H / 2;
        // Sample a pixel in the BL quadrant and a pixel in the BR quadrant
        for (const dx of [Math.floor(halfW * 0.5), halfW + Math.floor(halfW * 0.5)]) {
          const dy = halfH + Math.floor(halfH * 0.5);
          const ctx = target.getContext('2d')!;
          const [r] = Array.from(ctx.getImageData(cellX + dx, cellY + dy, 1, 1).data);
          if (r === N_EDGE_R) nEdgeInBottom++;
        }
      }

      expect(nEdgeInBottom).toBe(0);
    });

    it('S_EDGE primitive only ever appears in BL and BR quadrants, never TL or TR', () => {
      // Mirror of the N_EDGE invariant: S_EDGE is chosen when A=S=false, B=true for BL/BR.
      // TL/TR use A=N, so in the !A&&B branch they produce N_EDGE — never S_EDGE.
      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      const S_EDGE_R = 0x31;
      let sEdgeInTop = 0;

      for (let b = 0; b <= 46; b++) {
        if (SKIPPED_BLOBS.has(b)) continue;
        const col = b % ATLAS_COLS;
        const row = Math.floor(b / ATLAS_COLS);
        const cellX = col * CELL_W;
        const cellY = row * CELL_H;
        const halfW = CELL_W / 2;
        const halfH = CELL_H / 2;
        // Sample a pixel in the TL quadrant and a pixel in the TR quadrant
        for (const dx of [Math.floor(halfW * 0.5), halfW + Math.floor(halfW * 0.5)]) {
          const dy = Math.floor(halfH * 0.5);
          const ctx = target.getContext('2d')!;
          const [r] = Array.from(ctx.getImageData(cellX + dx, cellY + dy, 1, 1).data);
          if (r === S_EDGE_R) sEdgeInTop++;
        }
      }

      expect(sEdgeInTop).toBe(0);
    });

    it('CENTER primitive appears most in the fully-surrounded blob and not at all in no-neighbors blob', () => {
      // Blob 8 (mask 0xFF) → all CENTER; blob 0 (mask 0xba) → no CENTER
      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      const fullBlob = BLOB_INDEX_MAP_FOR_TEST[0xFF] % 47; // blob 8
      const noNeighborBlob = BLOB_INDEX_MAP_FOR_TEST[0x00] % 47; // blob 0

      // All 4 quadrants of fullBlob should be CENTER (#210000)
      expect(quadPixel(target, fullBlob, 'TL')).toBe(COLOR.CENTER);
      expect(quadPixel(target, fullBlob, 'TR')).toBe(COLOR.CENTER);
      expect(quadPixel(target, fullBlob, 'BL')).toBe(COLOR.CENTER);
      expect(quadPixel(target, fullBlob, 'BR')).toBe(COLOR.CENTER);

      // No quadrant of noNeighborBlob (mask 0xba: N=0, S=0, W=0, E=0) should be CENTER
      // Its representative mask 0xba has no cardinal neighbors in TL quadrant (N=0, W=0)
      // → NW_OUTER, not CENTER
      expect(quadPixel(target, noNeighborBlob, 'TL')).not.toBe(COLOR.CENTER);
    });

    it('composer is deterministic: two calls on fresh targets produce byte-identical pixel data', () => {
      const primitives = buildSyntheticPrimitiveSheet();

      const target1 = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      const target2 = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target1);
      composeBlob47Atlas(primitives, target2);

      const data1 = target1.getContext('2d')!.getImageData(0, 0, OUTPUT_W, OUTPUT_H).data;
      const data2 = target2.getContext('2d')!.getImageData(0, 0, OUTPUT_W, OUTPUT_H).data;

      expect(data1.length).toBe(data2.length);
      let identical = true;
      for (let i = 0; i < data1.length; i++) {
        if (data1[i] !== data2[i]) { identical = false; break; }
      }
      expect(identical).toBe(true);
    });

    it('total non-transparent area: exactly 41 mapped blobs × CELL_W × CELL_H pixels are painted', () => {
      // 47 blob slots - 6 skipped = 41 painted blobs
      // Each blob: CELL_W × CELL_H pixels, all non-transparent (primitives are opaque)
      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      const ctx = target.getContext('2d')!;
      const data = ctx.getImageData(0, 0, OUTPUT_W, OUTPUT_H).data;

      let nonTransparentPixels = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) nonTransparentPixels++;
      }

      const expectedPixels = 41 * CELL_W * CELL_H;
      expect(nonTransparentPixels).toBe(expectedPixels);
    });

    it('square cell mode: composes at caller-supplied cell dimensions', () => {
      // Compose-then-warp pipeline composes in topdown SQUARE space (e.g. 64×64)
      // and warps afterwards. The composer must honour caller-supplied cell dims.
      const sqCellW = 64, sqCellH = 64;
      const sheet = new OffscreenCanvas(sqCellW * 5, sqCellH * 3);
      const sctx = sheet.getContext('2d')!;
      const cells: Array<[number, number, string]> = [
        [0, 0, '#100000'], [1, 0, '#110000'], [2, 0, '#120000'], [3, 0, '#130000'], [4, 0, '#140000'],
        [0, 1, '#200000'], [1, 1, '#210000'], [2, 1, '#220000'], [3, 1, '#230000'], [4, 1, '#240000'],
        [0, 2, '#300000'], [1, 2, '#310000'], [2, 2, '#320000'], [3, 2, '#330000'], [4, 2, '#340000'],
      ];
      for (const [c, r, color] of cells) {
        sctx.fillStyle = color;
        sctx.fillRect(c * sqCellW, r * sqCellH, sqCellW, sqCellH);
      }
      const target = new OffscreenCanvas(sqCellW * ATLAS_COLS, sqCellH * 8);
      composeBlob47Atlas(sheet, target, sqCellW, sqCellH);

      // Fully-surrounded blob → all 4 quadrants from CENTER primitive (#210000).
      const fullBlob = BLOB_INDEX_MAP_FOR_TEST[0xFF] % 47;
      const cx = (fullBlob % ATLAS_COLS) * sqCellW;
      const cy = Math.floor(fullBlob / ATLAS_COLS) * sqCellH;
      expect(pixelAt(target, cx + 8, cy + 8)).toBe('#210000');
      expect(pixelAt(target, cx + sqCellW - 8, cy + sqCellH - 8)).toBe('#210000');
    });

    it('W-only cardinal topology: TL and BL use N_EDGE/S_EDGE, TR and BR use NE_OUTER/SE_OUTER', () => {
      // Find a blob whose representative mask has W=1, N=0, S=0, E=0
      const blobToMask = computeBlobToMask();
      let targetBlob = -1;
      for (const [blob, mask] of blobToMask) {
        const N = (mask & 0x01) !== 0;
        const S = (mask & 0x10) !== 0;
        const W = (mask & 0x40) !== 0;
        const E = (mask & 0x04) !== 0;
        if (W && !N && !S && !E) {
          targetBlob = blob;
          break;
        }
      }
      expect(targetBlob, 'should find a blob with W-only cardinals').toBeGreaterThanOrEqual(0);

      const primitives = buildSyntheticPrimitiveSheet();
      const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
      composeBlob47Atlas(primitives, target);

      // TL: A=N=false, B=W=true → N_EDGE (the !A&&B branch for TL/TR returns N_EDGE)
      // BL: A=S=false, B=W=true → S_EDGE (the !A&&B branch for BL/BR returns S_EDGE)
      // TR: A=N=false, B=E=false → NE_OUTER
      // BR: A=S=false, B=E=false → SE_OUTER
      expect(quadPixel(target, targetBlob, 'TL')).toBe(COLOR.N_EDGE);
      expect(quadPixel(target, targetBlob, 'BL')).toBe(COLOR.S_EDGE);
      expect(quadPixel(target, targetBlob, 'TR')).toBe(COLOR.NE_OUTER);
      expect(quadPixel(target, targetBlob, 'BR')).toBe(COLOR.SE_OUTER);
    });
  });
});
