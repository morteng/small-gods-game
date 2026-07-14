import { describe, it, expect } from 'vitest';
import { artBillboardItem, plantSpriteItemFromPack, natureBuryFrac, plantMirror } from '@/render/iso/iso-sprites';
import type { SpritePack } from '@/render/iso/sprite-canvas';

/** Minimal pack: only .albedo width/height are read by the bury path. */
function pack(w: number, h: number): SpritePack {
  return { albedo: { width: w, height: h } as unknown as HTMLCanvasElement } as unknown as SpritePack;
}

describe('artBillboardItem (decoration / prop)', () => {
  it('blits at the art NATIVE size (no tile-fraction scaling) — true 1:1', () => {
    const img = { naturalWidth: 96, naturalHeight: 128 } as unknown as HTMLImageElement;
    const item = artBillboardItem({ originX: 0, originY: 0 }, img, 0, 0);

    expect(item.t).toBe('image');
    if (item.t !== 'image') return;
    expect(item.src).toBe(img);
    // dest size === native size exactly (one source px == one screen px at zoom 1)
    expect(item.dw).toBe(96);  // dest width === naturalWidth
    expect(item.dh).toBe(128); // dest height === naturalHeight
    // base anchored at the tile centre (0,0 → screen 0,0): dx = -round(w/2), dy = -h
    expect(item.dx).toBe(-48); // -round(96/2)
    expect(item.dy).toBe(-128);
  });
});

describe('plantSpriteItemFromPack — rock bury (R5)', () => {
  const o = { originX: 0, originY: 0 };

  it('buryFrac 0 leaves the sprite whole (no frame, full height)', () => {
    const it = plantSpriteItemFromPack(o, pack(40, 40), 0, 0, 0);
    if (it.t !== 'image') throw new Error('expected image');
    expect(it.frame).toBeUndefined();
    expect(it.dh).toBe(40);
  });

  it('bury crops the bottom rows but keeps the FOOT at the ground line', () => {
    const whole = plantSpriteItemFromPack(o, pack(40, 40), 0, 0, 0);
    const sunk = plantSpriteItemFromPack(o, pack(40, 40), 0, 0, 0.15);   // 6 px buried
    if (whole.t !== 'image' || sunk.t !== 'image') throw new Error('expected image');
    expect(sunk.dh).toBe(34);                       // 40 − round(40·0.15)
    expect(sunk.frame).toEqual({ sx: 0, sy: 0, sw: 40, sh: 34 });  // TOP 34 rows kept
    // Foot (dy+dh, the ground contact) is invariant — bury never lifts/drops the anchor.
    expect(sunk.dy + sunk.dh).toBe(whole.dy + whole.dh);
    // The visible sprite is shorter (its base is underground), so its top sits lower.
    expect(sunk.dy).toBeGreaterThan(whole.dy);
  });

  it('natureBuryFrac: rocks sink 10–20 %, other flora 0, and it is deterministic', () => {
    const b = natureBuryFrac('boulder', 12, 7);
    expect(b).toBeGreaterThanOrEqual(0.10);
    expect(b).toBeLessThanOrEqual(0.20);
    expect(natureBuryFrac('boulder', 12, 7)).toBe(b);   // stable per position
    expect(natureBuryFrac('english-oak', 12, 7)).toBe(0);   // a tree does not bury here
  });
});

describe('plantSpriteItemFromPack — seeded mirror + snow whiten (alpine fidelity)', () => {
  const o = { originX: 0, originY: 0 };
  const item = (x: number, y: number, whiten = 0) => {
    const it = plantSpriteItemFromPack(o, pack(40, 40), x, y, 0, false, whiten);
    if (it.t !== 'image') throw new Error('expected image');
    return it;
  };

  it('the mirror is DETERMINISTIC: an instance at the same spot always flips the same way', () => {
    for (const [x, y] of [[0, 0], [12, 7], [3.5, 91], [-4, 200]] as const) {
      const m = plantMirror(x, y);
      expect(plantMirror(x, y)).toBe(m);                 // stable across calls
      expect(item(x, y).mirror ?? false).toBe(m);        // …and the draw item agrees
    }
  });

  it('it is real variety, not a constant (both flips occur across a population)', () => {
    let flipped = 0;
    for (let i = 0; i < 400; i++) if (plantMirror(i % 20, Math.floor(i / 20))) flipped++;
    expect(flipped).toBeGreaterThan(50);
    expect(flipped).toBeLessThan(350);
  });

  it('mirroring is a FLAG only — native size and foot anchor are untouched (no scaling)', () => {
    // Two tiles on the same ISO row (constant x+y → same screen y) that flip differently:
    // the sprite geometry must match (the flip lives in the UV rect / shader, not the blit).
    const SUM = 12;
    const xs = Array.from({ length: SUM + 1 }, (_, i) => i);
    const flipped = xs.find(x => plantMirror(x, SUM - x));
    const plain = xs.find(x => !plantMirror(x, SUM - x));
    expect(flipped).toBeDefined();
    expect(plain).toBeDefined();

    const a = item(flipped!, SUM - flipped!), b = item(plain!, SUM - plain!);
    expect(a.mirror).toBe(true);
    expect(b.mirror).toBeUndefined();
    for (const it of [a, b]) {
      expect(it.dw).toBe(40);        // native size (1 src px == 1 screen px)
      expect(it.dh).toBe(40);
    }
    expect(a.dy).toBe(b.dy);         // same iso row → same foot line, flip or not
    expect(a.dy + a.dh).toBe(b.dy + b.dh);
  });

  it('whiten 0 leaves the item untouched (byte-identical output for the unsnowed world)', () => {
    expect(item(12, 7, 0).whiten).toBeUndefined();
  });

  it('whiten passes through and clamps to 1', () => {
    expect(item(12, 7, 0.4).whiten).toBe(0.4);
    expect(item(12, 7, 3).whiten).toBe(1);
  });
});
