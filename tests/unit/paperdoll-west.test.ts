import { describe, expect, it } from 'vitest';
import { sampleClip } from '@/render/paperdoll/rig';
import {
  CLIP_WEST_ARTICULATION_TEST,
  LPC_HUMANOID_WEST,
  mirrorFrame,
  WEST_CHIP_NAMES,
} from '@/render/paperdoll/lpc-humanoid-west';
import type { Raster } from '@/render/sprite-postprocess';

const CELL = LPC_HUMANOID_WEST.cell;

describe('LPC_HUMANOID_WEST template structure', () => {
  it('root is index 0 with parent -1', () => {
    expect(LPC_HUMANOID_WEST.chips[0].name).toBe('trunk');
    expect(LPC_HUMANOID_WEST.chips[0].parent).toBe(-1);
  });

  it('exposes EXACTLY the profile chip vocabulary', () => {
    const got = LPC_HUMANOID_WEST.chips.map((c) => c.name);
    expect(new Set(got)).toEqual(new Set(WEST_CHIP_NAMES));
    expect(got).toHaveLength(WEST_CHIP_NAMES.length); // no dupes
  });

  it('parents are valid, backward-pointing and acyclic', () => {
    LPC_HUMANOID_WEST.chips.forEach((ch, i) => {
      if (i === 0) return;
      expect(ch.parent).toBeGreaterThanOrEqual(0);
      expect(ch.parent).toBeLessThan(i); // backward ref ⇒ acyclic
    });
  });

  it('every rect lies fully inside the cell', () => {
    for (const ch of LPC_HUMANOID_WEST.chips) {
      expect(ch.rect.x).toBeGreaterThanOrEqual(0);
      expect(ch.rect.y).toBeGreaterThanOrEqual(0);
      expect(ch.rect.w).toBeGreaterThan(0);
      expect(ch.rect.h).toBeGreaterThan(0);
      expect(ch.rect.x + ch.rect.w).toBeLessThanOrEqual(CELL);
      expect(ch.rect.y + ch.rect.h).toBeLessThanOrEqual(CELL);
    }
  });

  it('every pivot sits inside (or 1px adjacent to) its own rect', () => {
    for (const ch of LPC_HUMANOID_WEST.chips) {
      const [px, py] = ch.pivot;
      expect(px).toBeGreaterThanOrEqual(ch.rect.x - 1);
      expect(px).toBeLessThanOrEqual(ch.rect.x + ch.rect.w + 1);
      expect(py).toBeGreaterThanOrEqual(ch.rect.y - 1);
      expect(py).toBeLessThanOrEqual(ch.rect.y + ch.rect.h + 1);
    }
  });

  it('far limbs paint behind the trunk (z<0), near limbs & head in front (z>0)', () => {
    const z = (n: string) => LPC_HUMANOID_WEST.chips.find((c) => c.name === n)!.z;
    expect(z('trunk')).toBe(0);
    for (const n of ['armFar_up', 'armFar_fore', 'legFar_up', 'legFar_fore']) {
      expect(z(n)).toBeLessThan(0);
    }
    for (const n of ['armNear_up', 'armNear_fore', 'legNear_up', 'legNear_fore', 'head']) {
      expect(z(n)).toBeGreaterThan(0);
    }
    expect(z('head')).toBe(Math.max(...LPC_HUMANOID_WEST.chips.map((c) => c.z))); // head last
  });

  it('_fore chips parent to their _up chips; knees/elbows sit below hips/shoulders', () => {
    const chips = LPC_HUMANOID_WEST.chips;
    for (const [up, fore] of [
      ['armNear_up', 'armNear_fore'],
      ['armFar_up', 'armFar_fore'],
      ['legNear_up', 'legNear_fore'],
      ['legFar_up', 'legFar_fore'],
    ] as const) {
      const ui = chips.findIndex((c) => c.name === up);
      const f = chips.find((c) => c.name === fore)!;
      expect(f.parent).toBe(ui);
      expect(f.pivot[1]).toBeGreaterThanOrEqual(chips[ui].pivot[1]); // distal joint lower
    }
  });
});

describe('CLIP_WEST_ARTICULATION_TEST', () => {
  it('has the declared frame count', () => {
    expect(CLIP_WEST_ARTICULATION_TEST.frames).toBe(8);
  });

  it('tracks reference only existing chips, with sorted keys', () => {
    const names = new Set(LPC_HUMANOID_WEST.chips.map((c) => c.name));
    for (const [chip, track] of Object.entries(CLIP_WEST_ARTICULATION_TEST.tracks)) {
      expect(names.has(chip)).toBe(true);
      for (let i = 1; i < track.length; i++) expect(track[i].t).toBeGreaterThan(track[i - 1].t);
    }
  });

  it('couplings reference only existing chips', () => {
    const names = new Set(LPC_HUMANOID_WEST.chips.map((c) => c.name));
    for (const c of CLIP_WEST_ARTICULATION_TEST.couple ?? []) {
      expect(names.has(c.from)).toBe(true);
      expect(names.has(c.to)).toBe(true);
    }
  });

  it('deliberately plants nothing (the legs are meant to move)', () => {
    expect(CLIP_WEST_ARTICULATION_TEST.plant ?? []).toHaveLength(0);
  });

  it('sampleClip runs at t 0 / 0.5 / 1 and returns one pose per chip', () => {
    for (const t of [0, 0.5, 1]) {
      const poses = sampleClip(LPC_HUMANOID_WEST, CLIP_WEST_ARTICULATION_TEST, t);
      expect(poses).toHaveLength(LPC_HUMANOID_WEST.chips.length);
      for (const p of poses) {
        expect(Number.isFinite(p.deg)).toBe(true);
        expect(Number.isFinite(p.dx)).toBe(true);
        expect(Number.isFinite(p.dy)).toBe(true);
      }
    }
  });

  it('frame 0 is the rest pose (every chip at identity)', () => {
    const poses = sampleClip(LPC_HUMANOID_WEST, CLIP_WEST_ARTICULATION_TEST, 0);
    expect(poses.every((p) => p.deg === 0 && p.dx === 0 && p.dy === 0)).toBe(true);
  });

  it('mid-clip actually articulates the near arm and both legs', () => {
    const chips = LPC_HUMANOID_WEST.chips;
    const poses = sampleClip(LPC_HUMANOID_WEST, CLIP_WEST_ARTICULATION_TEST, 0.5);
    const deg = (n: string) => poses[chips.findIndex((c) => c.name === n)].deg;
    expect(Math.abs(deg('armNear_up'))).toBeGreaterThan(10);
    // At t=0.25 the scissor is at full spread; the shin couple counters the thigh.
    const spread = sampleClip(LPC_HUMANOID_WEST, CLIP_WEST_ARTICULATION_TEST, 0.25);
    const d = (n: string) => spread[chips.findIndex((c) => c.name === n)].deg;
    expect(Math.abs(d('legNear_up'))).toBeGreaterThan(10);
    expect(Math.sign(d('legNear_up'))).toBe(-Math.sign(d('legFar_up'))); // mirrored scissor
    // Shin = thigh + (−1 × thigh) via couple ⇒ counter-rotated (opposite sign).
    expect(Math.sign(d('legNear_fore'))).toBe(-Math.sign(d('legNear_up')));
  });
});

describe('mirrorFrame', () => {
  const px = (r: Raster, x: number, y: number): [number, number, number, number] => {
    const i = (y * r.w + x) * 4;
    return [r.data[i], r.data[i + 1], r.data[i + 2], r.data[i + 3]];
  };

  it('flips a known 2×1 pattern horizontally', () => {
    // 2×1 cell: left = red opaque, right = blue transparent.
    const data = new Uint8ClampedArray(2 * 1 * 4);
    data.set([255, 0, 0, 255], 0); // (0,0) red
    data.set([0, 0, 255, 0], 4); //   (1,0) blue, alpha 0
    const r: Raster = { data, w: 2, h: 1 };
    const m = mirrorFrame(r);
    expect(px(m, 0, 0)).toEqual([0, 0, 255, 0]); // blue now on the left
    expect(px(m, 1, 0)).toEqual([255, 0, 0, 255]); // red now on the right
  });

  it('is pure — does not mutate the input', () => {
    const data = new Uint8ClampedArray([9, 8, 7, 255, 1, 2, 3, 128]);
    const r: Raster = { data, w: 2, h: 1 };
    mirrorFrame(r);
    expect(Array.from(r.data)).toEqual([9, 8, 7, 255, 1, 2, 3, 128]);
  });

  it('double-flip is the identity', () => {
    const data = new Uint8ClampedArray(4 * 3 * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256; // arbitrary pattern
    const r: Raster = { data, w: 4, h: 3 };
    const back = mirrorFrame(mirrorFrame(r));
    expect(Array.from(back.data)).toEqual(Array.from(r.data));
  });
});
