import { describe, it, expect } from 'vitest';
import {
  tileToScreen, screenToTile, screenToTileFlat, ISO_HALF_W, ISO_HALF_H, type IsoEnv,
} from '@/render/iso/lifted-projection';
import type { Camera } from '@/core/types';

// The pure lift-aware iso projection core, exercised against SYNTHETIC heightfields —
// no world gen, no GPU. Validates the lift-aware inverse (mouse → tile) the hover/select
// path relies on: exact on the flat, exact on the x-axis under any lift, zoom-invariant,
// and — the property the naive fixed-point got wrong — it returns the FRONTMOST tile
// drawn under the cursor on steep relief (occlusion).

const cam = (zoom: number, x = 0, y = 0): Camera =>
  ({ x, y, zoom, dragging: false, lastX: 0, lastY: 0 });

const K = 800;   // realistic lift gain (≈ relief 48 m × 17 px/m)

const flatEnv = (W: number, H: number): IsoEnv =>
  ({ elevAt: () => 0, seaLevel: 0, k: K, width: W, height: H });

/** A smooth central hill — the steep, occluding relief the inverse must handle. */
const hillEnv = (W: number, H: number): IsoEnv => ({
  elevAt: (tx, ty) => {
    const cx = (W - 1) / 2, cy = (H - 1) / 2;
    const r = Math.min(W, H) * 0.30;
    const d2 = ((tx - cx) ** 2 + (ty - cy) ** 2) / (r * r);
    return 0.85 * Math.exp(-d2);                 // peak ~0.85 normalised → ~0.85·K px lift
  },
  seaLevel: 0, k: K, width: W, height: H,
});

/** Two-triangle point-in-quad for a cell's four lifted screen corners. */
function inCellQuad(p: { x: number; y: number }, cx: number, cy: number, c: Camera, env: IsoEnv): boolean {
  const a = tileToScreen(cx, cy, c, env), b = tileToScreen(cx + 1, cy, c, env);
  const cc = tileToScreen(cx + 1, cy + 1, c, env), d = tileToScreen(cx, cy + 1, c, env);
  const sign = (px: number, py: number, ax: number, ay: number, bx: number, by: number) =>
    (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const inTri = (q: { x: number; y: number }, t1: { x: number; y: number }, t2: { x: number; y: number }, t3: { x: number; y: number }) => {
    const d1 = sign(q.x, q.y, t1.x, t1.y, t2.x, t2.y);
    const d2 = sign(q.x, q.y, t2.x, t2.y, t3.x, t3.y);
    const d3 = sign(q.x, q.y, t3.x, t3.y, t1.x, t1.y);
    return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)));
  };
  return inTri(p, a, b, cc) || inTri(p, a, cc, d);
}

describe('lifted-projection — flat terrain', () => {
  it('round-trips every tile centre back to its own cell (lift = 0)', () => {
    const W = 40, H = 40, env = flatEnv(W, H), c = cam(0.5, 120, 90);
    for (let ty = 1; ty < H - 1; ty++) for (let tx = 1; tx < W - 1; tx++) {
      const s = tileToScreen(tx + 0.5, ty + 0.5, c, env);
      const r = screenToTile(s.x, s.y, c, env);
      expect(Math.floor(r.tx)).toBe(tx);
      expect(Math.floor(r.ty)).toBe(ty);
    }
  });

  it('agrees with the flat closed-form inverse when there is no lift', () => {
    const env = flatEnv(50, 50), c = cam(0.37, -40, 15);
    for (const [tx, ty] of [[10.5, 10.5], [3.2, 44.8], [25, 25], [48.4, 1.1]]) {
      const s = tileToScreen(tx, ty, c, env);
      const lifted = screenToTile(s.x, s.y, c, env);
      const flat = screenToTileFlat(s.x, s.y, c);
      expect(lifted.tx).toBeCloseTo(flat.tx, 4);
      expect(lifted.ty).toBeCloseTo(flat.ty, 4);
    }
  });
});

describe('lifted-projection — lift-aware inverse', () => {
  it('inverts the x-axis (tx − ty) EXACTLY regardless of terrain lift', () => {
    const W = 50, H = 50, env = hillEnv(W, H), c = cam(0.6, 200, -30);
    for (let ty = 2; ty < H - 2; ty += 3) for (let tx = 2; tx < W - 2; tx += 3) {
      const s = tileToScreen(tx + 0.5, ty + 0.5, c, env);
      const r = screenToTile(s.x, s.y, c, env);
      // screen-x carries no lift term, so the (tx−ty) diagonal is recovered to float eps.
      expect(r.tx - r.ty).toBeCloseTo((tx + 0.5) - (ty + 0.5), 3);
    }
  });

  it('is zoom-invariant: the same world tile is picked at any zoom', () => {
    const env = hillEnv(48, 48);
    const tx = 19, ty = 27;
    for (const z of [0.04, 0.25, 1.0, 3.5]) {
      const c = cam(z, 77, 33);
      const s = tileToScreen(tx + 0.5, ty + 0.5, c, env);
      const r = screenToTile(s.x, s.y, c, env);
      expect(Math.floor(r.tx)).toBe(tx);
      expect(Math.floor(r.ty)).toBe(ty);
    }
  });

  it('never picks a tile BEHIND the cursor, and resolves occlusion to the frontmost tile', () => {
    // O(W·H), no pixel sweep: project each tile's centre, invert, and check the result.
    // The queried tile's own quad always covers its centre, so the inverse must return
    // a tile that (a) also covers that pixel and (b) is NOT behind the queried tile
    // (its tx+ty ≥ the queried tile's) — i.e. on a peak it returns the frontmost
    // occluder the GPU draws, never the hidden tile underneath. A steep hill produces
    // BOTH self-hits (visible) and occluded hits, so the property is genuinely exercised.
    const W = 36, H = 36, env = hillEnv(W, H), c = cam(0.8, 60, -20);
    let visible = 0, occluded = 0;
    for (let ty = 1; ty < H - 1; ty++) for (let tx = 1; tx < W - 1; tx++) {
      const s = tileToScreen(tx + 0.5, ty + 0.5, c, env);
      const r = screenToTile(s.x, s.y, c, env);
      const rx = Math.floor(r.tx), ry = Math.floor(r.ty);
      if (rx === tx && ry === ty) { visible++; continue; }
      occluded++;
      expect(rx + ry).toBeGreaterThanOrEqual(tx + ty);          // never resolves to a tile behind
      expect(inCellQuad(s, rx, ry, c, env)).toBe(true);          // the picked tile really covers the pixel
    }
    expect(visible).toBeGreaterThan(100);
    expect(occluded).toBeGreaterThan(0);                         // the hill MUST create occlusion
  });
});

describe('lifted-projection — constants', () => {
  it('uses the 128×64 iso diamond half-extents', () => {
    expect(ISO_HALF_W).toBe(64);
    expect(ISO_HALF_H).toBe(32);
  });
});
