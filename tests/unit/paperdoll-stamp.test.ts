import { describe, expect, it } from 'vitest';
import { bakeClip, type AnimTemplate, type Clip } from '@/render/paperdoll/rig';
import { activeStampIndex, applyStamps, stampAnims, type StampKey, type StampRef } from '@/render/paperdoll/stamp';
import { donorSheetCandidates } from '@/render/paperdoll/lpc-humanoid';
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
