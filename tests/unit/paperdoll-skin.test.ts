import { describe, expect, it } from 'vitest';
import { renderPose, type AnimTemplate, type ChipPose } from '@/render/paperdoll/rig';
import { buildSkinField, rigidSkinField } from '@/render/paperdoll/skin';
import { collectSourcePalette, snapToSourcePalette } from '@/render/paperdoll/palette-snap';
import type { Raster } from '@/render/sprite-postprocess';

// Fixture: 8px cell, root + one arm (right column), joint interface at x=4|5.
const T: AnimTemplate = {
  name: 'skin-test',
  cell: 8,
  chips: [
    { name: 'root', rect: { x: 0, y: 0, w: 8, h: 8 }, pivot: [4, 4], parent: -1, z: 0 },
    { name: 'arm', rect: { x: 5, y: 0, w: 3, h: 8 }, pivot: [5, 4], parent: 0, z: 1 },
  ],
};

const P = (deg = 0, dx = 0, dy = 0): ChipPose => ({ deg, dx, dy });

function solidCell(n: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) data.set(rgba, i * 4);
  return { data, w: n, h: n };
}

describe('buildSkinField', () => {
  it('band 0 = fully rigid (boneA === boneB === assign)', () => {
    const f = buildSkinField(T, solidCell(8, [10, 20, 30, 255]), 0);
    for (let i = 0; i < 64; i++) {
      expect(f.boneA[i]).toBe(f.assign[i]);
      expect(f.boneB[i]).toBe(f.assign[i]);
      expect(f.w[i]).toBe(0);
    }
  });

  it('weights rise monotonically from parent side to child side across the interface', () => {
    const f = buildSkinField(T, solidCell(8, [10, 20, 30, 255]), 2);
    const y = 4;
    const wAt = (x: number): number => {
      const i = y * 8 + x;
      // rigid pixels read as pure bone weight
      if (f.boneA[i] === f.boneB[i]) return f.assign[i] === 1 ? 1 : 0;
      return f.w[i];
    };
    expect(wAt(0)).toBe(0); // deep root: rigid
    expect(wAt(7)).toBe(1); // deep arm: rigid
    // across the seam x=4|5 the child weight strictly increases
    let prev = -1;
    for (let x = 2; x <= 7; x++) {
      const cur = wAt(x);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
    // interface pixels straddle 0.5
    expect(wAt(4)).toBeLessThan(0.5);
    expect(wAt(5)).toBeGreaterThan(0.5);
    expect(wAt(4)).toBeGreaterThan(0);
    expect(wAt(5)).toBeLessThan(1);
  });

  it('contour-aware: no blending across a transparent gap (weights flow through opaque pixels only)', () => {
    // Opaque root block (x0-3) and opaque arm block (x6-7) separated by a
    // transparent column at x=4-5: no opaque interface → everything rigid.
    const r = solidCell(8, [10, 20, 30, 255]);
    for (let y = 0; y < 8; y++) {
      for (const x of [4, 5]) r.data[(y * 8 + x) * 4 + 3] = 0;
    }
    const f = buildSkinField(T, r, 3);
    for (let i = 0; i < 64; i++) expect(f.boneA[i]).toBe(f.boneB[i]);
  });

  it('rigidSkinField binds every pixel to the given chip', () => {
    const f = rigidSkinField(T, 1);
    for (let i = 0; i < 64; i++) {
      expect(f.assign[i]).toBe(1);
      expect(f.boneA[i]).toBe(1);
      expect(f.boneB[i]).toBe(1);
    }
  });
});

describe('renderPose skinned path', () => {
  const REST = [P(), P()];

  it('identity pose preserves opaque pixels exactly', () => {
    const cell = solidCell(8, [10, 200, 30, 255]);
    const out = renderPose(T, [cell], REST, { skin: { band: 2 } });
    for (let i = 0; i < 64; i++) {
      expect(out.data[i * 4]).toBe(10);
      expect(out.data[i * 4 + 1]).toBe(200);
      expect(out.data[i * 4 + 2]).toBe(30);
      expect(out.data[i * 4 + 3]).toBe(255);
    }
  });

  it('is deterministic', () => {
    const cell = solidCell(8, [90, 60, 120, 255]);
    const a = renderPose(T, [cell], [P(), P(35)], { skin: { band: 2 } });
    const b = renderPose(T, [cell], [P(), P(35)], { skin: { band: 2 } });
    expect(Buffer.from(a.data)).toEqual(Buffer.from(b.data));
  });

  it('a bent joint keeps the seam covered (no tear between parent and child)', () => {
    // Rotate the arm 40°: with rigid chips the corner of the rect pulls away
    // from the root; the skinned mesh must stay watertight along the seam row.
    const cell = solidCell(8, [200, 100, 50, 255]);
    const out = renderPose(T, [cell], [P(), P(40)], { skin: { band: 2 } });
    // Sample the seam neighborhood on the pivot row — must remain covered.
    for (const x of [3, 4, 5]) {
      expect(out.data[(4 * 8 + x) * 4 + 3]).toBeGreaterThan(0);
    }
  });

  it('incompatible neighbors tear: a distal rigid pixel is not dragged by the rotating limb', () => {
    // Root pixels grey, arm column red. Band 1 blends only near the pivot
    // (5,4); the distal seam row y=7 is rigid on both sides → must TEAR.
    const n = 8;
    const cell = solidCell(n, [100, 100, 100, 255]);
    for (let y = 0; y < n; y++)
      for (let x = 5; x < 8; x++) cell.data.set([255, 0, 0, 255], (y * n + x) * 4);
    const out = renderPose(T, [cell], [P(), P(90)], { skin: { band: 1 } });
    // Seam-adjacent root pixel: may lose a corner to band falloff, but keeps
    // its own color — never dragged red by the arm.
    const seam = (7 * n + 4) * 4;
    expect(out.data[seam + 3]).toBeGreaterThan(128);
    expect(out.data[seam]).toBe(100);
    expect(out.data[seam + 1]).toBe(100);
    // One pixel further from the seam: fully intact.
    const deep = (7 * n + 3) * 4;
    expect(out.data[deep + 3]).toBe(255);
    expect(out.data[deep]).toBe(100);
  });

  it('honors hide (hidden chip leaves a hole)', () => {
    const cell = solidCell(8, [200, 100, 50, 255]);
    const out = renderPose(T, [cell], REST, { skin: { band: 0 }, hide: new Set(['arm']) });
    expect(out.data[(0 * 8 + 6) * 4 + 3]).toBe(0); // arm column empty
    expect(out.data[(0 * 8 + 0) * 4 + 3]).toBe(255); // root painted
  });

  it('assigned layers ride their chip rigidly through the skinned path', () => {
    const n = 8;
    const data = new Uint8ClampedArray(n * n * 4);
    data.set([0, 255, 0, 255], (7 * n + 0) * 4);
    const layer = { raster: { data, w: n, h: n }, assign: 'arm' };
    const out = renderPose(T, [layer], [P(), P(0, 2, 0)], { skin: { band: 2 } });
    expect(out.data[(7 * n + 2) * 4 + 3]).toBe(255); // moved with the arm
    expect(out.data[(7 * n + 0) * 4 + 3]).toBe(0); // origin vacated
  });
});

describe('source-palette snap', () => {
  it('collects the distinct opaque colors once', () => {
    const r = solidCell(4, [10, 20, 30, 255]);
    r.data.set([50, 60, 70, 255], 0);
    const p = collectSourcePalette([r, r]);
    expect(p.rgb).toHaveLength(2);
  });

  it('snapped output uses only source colors and binary alpha', () => {
    const pal = collectSourcePalette([solidCell(2, [100, 0, 0, 255])]);
    const frame = solidCell(2, [120, 20, 10, 255]);
    frame.data[3] = 90; // low-coverage pixel → drops out
    const out = snapToSourcePalette(frame, pal);
    expect(out.data[3]).toBe(0);
    for (let i = 1; i < 4; i++) {
      expect([...out.data.subarray(i * 4, i * 4 + 4)]).toEqual([100, 0, 0, 255]);
    }
  });

  it('is deterministic and does not mutate its input', () => {
    const pal = collectSourcePalette([solidCell(2, [1, 2, 3, 255]), solidCell(2, [200, 200, 200, 255])]);
    const frame = solidCell(2, [90, 90, 90, 255]);
    const before = [...frame.data];
    const a = snapToSourcePalette(frame, pal);
    const b = snapToSourcePalette(frame, pal);
    expect(Buffer.from(a.data)).toEqual(Buffer.from(b.data));
    expect([...frame.data]).toEqual(before);
  });
});
