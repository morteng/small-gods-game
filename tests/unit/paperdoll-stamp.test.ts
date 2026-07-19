import { describe, expect, it } from 'vitest';
import { applyAnchoredStamps, bakeClip, type AnimTemplate, type Clip } from '@/render/paperdoll/rig';
import { activeStampIndex, applyStamps, stampAnims, type StampKey, type StampRef } from '@/render/paperdoll/stamp';
import { donorSheetCandidates, STAMP_BLINK } from '@/render/paperdoll/lpc-humanoid';
import type { Raster } from '@/render/sprite-postprocess';

const N = 8;

function solid(w: number, h: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { data, w, h };
}

const px = (r: Raster, x: number, y: number): number[] => [...r.data.subarray((y * r.w + x) * 4, (y * r.w + x) * 4 + 4)];

// Donor sheet: 2 cols × 1 row of 8px cells; col 1 carries a red 2×2 patch at
// cell-local (5,5) with its (6,6) pixel transparent (tests hole preservation).
function donorSheet(): Raster {
  const sheet = solid(16, 8, [0, 0, 0, 0]);
  for (const [x, y] of [
    [13, 5],
    [14, 5],
    [13, 6],
  ] as const) {
    sheet.data.set([255, 0, 0, 255], (y * 16 + x) * 4);
  }
  return sheet;
}

const REF: StampRef = {
  anim: 'spellcast',
  col: 1,
  row: 0,
  crop: { x: 5, y: 5, w: 2, h: 2 },
  dest: [5, 5],
};

describe('activeStampIndex', () => {
  const track: StampKey[] = [
    { t: 0.2, refs: [] },
    { t: 0.6, refs: [] },
  ];

  it('is -1 before the first key and for missing tracks', () => {
    expect(activeStampIndex(undefined, 0.5)).toBe(-1);
    expect(activeStampIndex([], 0.5)).toBe(-1);
    expect(activeStampIndex(track, 0.1)).toBe(-1);
  });

  it('steps: the latest key at or before t wins', () => {
    expect(activeStampIndex(track, 0.2)).toBe(0);
    expect(activeStampIndex(track, 0.5)).toBe(0);
    expect(activeStampIndex(track, 0.6)).toBe(1);
    expect(activeStampIndex(track, 1)).toBe(1);
  });
});

describe('stampAnims', () => {
  it('dedupes anims across tracks and skips undefined', () => {
    const a: StampKey[] = [{ t: 0, refs: [REF, { ...REF, anim: 'thrust' }] }];
    const b: StampKey[] = [{ t: 0.5, refs: [REF] }];
    expect(stampAnims([a, undefined, b]).sort()).toEqual(['spellcast', 'thrust']);
    expect(stampAnims([undefined])).toEqual([]);
  });
});

describe('applyStamps', () => {
  it('returns the input untouched with no donors, no refs, or a missing anim', () => {
    const cell = solid(N, N, [0, 0, 255, 255]);
    expect(applyStamps(cell, [REF], undefined, N)).toBe(cell);
    expect(applyStamps(cell, [], { spellcast: donorSheet() }, N)).toBe(cell);
    expect(applyStamps(cell, [REF], { thrust: donorSheet() }, N)).toBe(cell);
  });

  it('clears the dest footprint, pastes opaque donor pixels, keeps donor holes', () => {
    const cell = solid(N, N, [0, 0, 255, 255]);
    const out = applyStamps(cell, [REF], { spellcast: donorSheet() }, N);
    expect(px(out, 5, 5)).toEqual([255, 0, 0, 255]); // pasted
    expect(px(out, 6, 5)).toEqual([255, 0, 0, 255]);
    expect(px(out, 6, 6)[3]).toBe(0); // transparent donor px → cleared hole stays
    expect(px(out, 4, 5)).toEqual([0, 0, 255, 255]); // outside footprint untouched
  });

  it('honors explicit multi-rect clears beyond the paste footprint', () => {
    const cell = solid(N, N, [0, 0, 255, 255]);
    const ref: StampRef = {
      ...REF,
      clear: [
        { x: 5, y: 5, w: 2, h: 2 },
        { x: 0, y: 0, w: 1, h: 1 },
      ],
    };
    const out = applyStamps(cell, [ref], { spellcast: donorSheet() }, N);
    expect(px(out, 0, 0)[3]).toBe(0); // extra clear rect applied
    expect(px(out, 5, 5)).toEqual([255, 0, 0, 255]);
  });

  it('clips out-of-bounds crop and clear coordinates safely', () => {
    const cell = solid(N, N, [0, 0, 255, 255]);
    const ref: StampRef = {
      anim: 'spellcast',
      col: 1,
      row: 0,
      crop: { x: 4, y: 4, w: 6, h: 6 }, // spills past the donor cell and dest
      dest: [6, 6],
      clear: [{ x: -2, y: 6, w: 12, h: 6 }],
    };
    const out = applyStamps(cell, [ref], { spellcast: donorSheet() }, N);
    expect(out.w).toBe(N);
    expect(px(out, 7, 7)).toEqual([255, 0, 0, 255]); // donor (5,5) → dest+1,+1
  });

  it('is deterministic and never mutates its input', () => {
    const cell = solid(N, N, [0, 0, 255, 255]);
    const before = [...cell.data];
    const a = applyStamps(cell, [REF], { spellcast: donorSheet() }, N);
    const b = applyStamps(cell, [REF], { spellcast: donorSheet() }, N);
    expect(Buffer.from(a.data)).toEqual(Buffer.from(b.data));
    expect([...cell.data]).toEqual(before);
  });
});

describe('self stamps (donor-less clones from the layer\'s own cell)', () => {
  it('clones from the cell itself, with no donor sheets at all', () => {
    const cell = solid(N, N, [0, 0, 255, 255]);
    cell.data.set([255, 0, 0, 255], (1 * N + 1) * 4); // red at (1,1)
    const ref: StampRef = { self: true, crop: { x: 1, y: 1, w: 1, h: 1 }, dest: [6, 6] };
    const out = applyStamps(cell, [ref], undefined, N);
    expect(px(out, 6, 6)).toEqual([255, 0, 0, 255]);
    expect(px(out, 1, 1)).toEqual([255, 0, 0, 255]); // source untouched
  });

  it('reads PRE-STAMP pixels: a later ref sees the original, not earlier writes', () => {
    const cell = solid(N, N, [0, 0, 255, 255]);
    cell.data.set([255, 0, 0, 255], (2 * N + 2) * 4); // red at (2,2)
    const refs: StampRef[] = [
      // First ref buries (2,2) under blue cloned from (0,0)…
      { self: true, crop: { x: 0, y: 0, w: 1, h: 1 }, dest: [2, 2] },
      // …second ref still reads the ORIGINAL red at (2,2).
      { self: true, crop: { x: 2, y: 2, w: 1, h: 1 }, dest: [5, 5] },
    ];
    const out = applyStamps(cell, refs, undefined, N);
    expect(px(out, 2, 2)).toEqual([0, 0, 255, 255]);
    expect(px(out, 5, 5)).toEqual([255, 0, 0, 255]);
  });

  it('a transparent self source erases the dest (clear happens, paste no-ops)', () => {
    const cell = solid(N, N, [0, 0, 255, 255]);
    cell.data[(0 * N + 0) * 4 + 3] = 0; // (0,0) transparent
    const ref: StampRef = { self: true, crop: { x: 0, y: 0, w: 1, h: 1 }, dest: [3, 3] };
    const out = applyStamps(cell, [ref], undefined, N);
    expect(px(out, 3, 3)[3]).toBe(0);
  });

  it('stampAnims skips self refs (no donor shopping for them)', () => {
    const track: StampKey[] = [{ t: 0, refs: [{ self: true, crop: { x: 0, y: 0, w: 1, h: 1 }, dest: [0, 0] }, REF] }];
    expect(stampAnims([track])).toEqual(['spellcast']);
  });
});

describe('STAMP_BLINK geometry (authored face refs)', () => {
  // Synthetic 64px head cell: skin fills the face, blue "eyes" in the recon'd
  // eye rects (rows 29–31, x26–29 / x34–37), dark ink at the lash sources.
  function faceCell(): Raster {
    const cell = solid(64, 64, [249, 213, 186, 255]);
    const set = (x: number, y: number, c: [number, number, number, number]) => cell.data.set(c, (y * 64 + x) * 4);
    for (let y = 29; y <= 31; y++) {
      for (let x = 26; x <= 29; x++) set(x, y, [86, 134, 174, 255]);
      for (let x = 34; x <= 37; x++) set(x, y, [86, 134, 174, 255]);
    }
    for (const x of [27, 28, 35, 36]) set(x, 29, [39, 25, 32, 255]);
    return cell;
  }

  it('closes both eyes to skin with a 2px ink lash line', () => {
    const out = applyStamps(faceCell(), [...STAMP_BLINK], undefined, 64);
    // Eye corners are skin now.
    expect(px(out, 26, 29)).toEqual([249, 213, 186, 255]);
    expect(px(out, 29, 31)).toEqual([249, 213, 186, 255]);
    expect(px(out, 37, 29)).toEqual([249, 213, 186, 255]);
    // Lash line survives BECAUSE self reads are pre-stamp (the skin rows
    // already buried (27,29) by the time the lash ref runs).
    expect(px(out, 27, 30)).toEqual([39, 25, 32, 255]);
    expect(px(out, 28, 30)).toEqual([39, 25, 32, 255]);
    expect(px(out, 35, 30)).toEqual([39, 25, 32, 255]);
  });

  it('no-ops on a layer with nothing in the face region (hair/clothes/body)', () => {
    const empty = solid(64, 64, [0, 0, 0, 0]);
    const out = applyStamps(empty, [...STAMP_BLINK], undefined, 64);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(0);
  });
});

describe('zero-sized crop = pure eraser', () => {
  it('clears its clear rects and pastes nothing (the pre-FK fist strip)', () => {
    const cell = solid(N, N, [0, 0, 255, 255]);
    const ref: StampRef = {
      self: true,
      crop: { x: 0, y: 0, w: 0, h: 0 },
      dest: [0, 0],
      clear: [{ x: 5, y: 5, w: 2, h: 2 }],
    };
    const out = applyStamps(cell, [ref], undefined, N);
    expect(px(out, 5, 5)[3]).toBe(0);
    expect(px(out, 6, 6)[3]).toBe(0);
    expect(px(out, 4, 5)).toEqual([0, 0, 255, 255]); // outside untouched
    expect(px(out, 0, 0)).toEqual([0, 0, 255, 255]); // dest not pasted over
  });
});

describe('bakeClip stamp integration', () => {
  const T: AnimTemplate = {
    name: 'stamp-test',
    cell: N,
    chips: [
      { name: 'root', rect: { x: 0, y: 0, w: N, h: N }, pivot: [4, 4], parent: -1, z: 0 },
      { name: 'arm', rect: { x: 5, y: 0, w: 3, h: N }, pivot: [5, 4], parent: 0, z: 1 },
    ],
  };
  const clip: Clip = {
    name: 'open-hand',
    frames: 4, // t = 0, 1/3, 2/3, 1
    tracks: {},
    stamps: [{ t: 0.5, refs: [REF] }],
  };

  it('switches pixels at the stamp key, not before', () => {
    const layer = { raster: solid(N, N, [0, 0, 255, 255]), donors: { spellcast: donorSheet() } };
    const frames = bakeClip(T, [layer], clip);
    expect(px(frames[0], 5, 5)).toEqual([0, 0, 255, 255]);
    expect(px(frames[1], 5, 5)).toEqual([0, 0, 255, 255]);
    expect(px(frames[2], 5, 5)).toEqual([255, 0, 0, 255]);
    expect(px(frames[3], 5, 5)).toEqual([255, 0, 0, 255]);
  });

  it('a layer without donors keeps its rest pixels (graceful degrade)', () => {
    const layer = { raster: solid(N, N, [0, 255, 0, 255]) };
    const frames = bakeClip(T, [layer], clip);
    expect(px(frames[3], 5, 5)).toEqual([0, 255, 0, 255]);
  });
});

describe('anchored stamps (post-FK hand swap)', () => {
  // Root is empty; the arm chip is a 2-wide column that clips can rotate.
  const T: AnimTemplate = {
    name: 'anchor-test',
    cell: 16,
    chips: [
      { name: 'root', rect: { x: 0, y: 0, w: 16, h: 16 }, pivot: [8, 8], parent: -1, z: 0 },
      { name: 'arm', rect: { x: 7, y: 8, w: 2, h: 6 }, pivot: [8, 8], parent: 0, z: 1 },
    ],
  };
  // Donor sheet (one cell wide): a green 2×2 patch at (4,4) with a distinct
  // corner pixel to prove the paste is axis-aligned (never rotated).
  function greenDonor(): Raster {
    const sheet = solid(16, 16, [0, 0, 0, 0]);
    sheet.data.set([0, 255, 0, 255], (4 * 16 + 4) * 4);
    sheet.data.set([0, 255, 0, 255], (4 * 16 + 5) * 4);
    sheet.data.set([0, 255, 0, 255], (5 * 16 + 5) * 4);
    sheet.data.set([255, 255, 0, 255], (5 * 16 + 4) * 4); // yellow corner
    return sheet;
  }
  const ANCHORED: StampRef = {
    anim: 'spellcast',
    col: 0,
    row: 0,
    crop: { x: 4, y: 4, w: 2, h: 2 },
    dest: [7, 12], // rest-space: at the arm's far end
    anchor: 'arm',
  };

  it('pastes at the chip-transformed dest, axis-aligned, only after the key', () => {
    const clip: Clip = {
      name: 'swing',
      frames: 3, // t = 0, 0.5, 1
      tracks: { arm: [{ t: 0, deg: 0 }, { t: 1, deg: 180 }] },
      stamps: [{ t: 0.9, refs: [ANCHORED] }],
    };
    const layer = { raster: solid(16, 16, [0, 0, 255, 255]), donors: { spellcast: greenDonor() } };
    const frames = bakeClip(T, [layer], clip);
    // Before the key: no green anywhere.
    const hasGreen = (f: Raster) => {
      for (let i = 0; i < f.data.length; i += 4) if (f.data[i] === 0 && f.data[i + 1] === 255 && f.data[i + 3] > 0) return true;
      return false;
    };
    expect(hasGreen(frames[0])).toBe(false);
    expect(hasGreen(frames[1])).toBe(false);
    // At t=1 the arm is rotated 180° about (8,8): rest dest center (8,13) maps
    // to (8,3), so the 2×2 patch lands at (7,2)..(8,3) — and the yellow corner
    // stays bottom-left (axis-aligned paste; a rotated paste would flip it).
    expect(px(frames[2], 7, 2)).toEqual([0, 255, 0, 255]);
    expect(px(frames[2], 8, 2)).toEqual([0, 255, 0, 255]);
    expect(px(frames[2], 8, 3)).toEqual([0, 255, 0, 255]);
    expect(px(frames[2], 7, 3)).toEqual([255, 255, 0, 255]);
  });

  it('applyAnchoredStamps: unknown anchors and zero crops are ignored', () => {
    const frame = solid(16, 16, [0, 0, 255, 255]);
    const before = [...frame.data];
    applyAnchoredStamps(frame, T, [{ raster: solid(16, 16, [0, 0, 255, 255]), donors: { spellcast: greenDonor() } }], [
      { ...ANCHORED, anchor: 'ghost' },
      { ...ANCHORED, crop: { x: 4, y: 4, w: 0, h: 0 } },
    ], T.chips.map(() => ({ deg: 0, dx: 0, dy: 0 })));
    expect([...frame.data]).toEqual(before);
  });
});

describe('donorSheetCandidates', () => {
  it('derives flat and variant donor paths, with variantless fallback', () => {
    expect(donorSheetCandidates('a/b/male/walk.png', 'spellcast')).toEqual(['a/b/male/spellcast.png']);
    expect(donorSheetCandidates('a/b/male/walk/blue.png', 'spellcast')).toEqual([
      'a/b/male/spellcast/blue.png',
      'a/b/male/spellcast.png',
    ]);
    expect(donorSheetCandidates('a/b/notwalk.png', 'spellcast')).toEqual([]);
  });
});
