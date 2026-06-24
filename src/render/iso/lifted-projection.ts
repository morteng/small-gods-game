// src/render/iso/lifted-projection.ts
//
// The PURE lift-aware iso projection core (Camera convention: x/y pan + zoom) used by
// the world connectome overlay + studio picking. Distinct from the flat, origin-based
// sibling `iso/iso-projection.ts` (worldToScreen) — this one accounts for TERRAIN LIFT
// and inverts it. tile↔screen with NO dependency on the
// height store, world style, or any global. Everything that varies per world (the
// terrain elevation sampler, the lift gain, the sea datum, the map dims) is passed in
// as an `IsoEnv`, so the math is unit-testable against a synthetic heightfield and the
// renderer/studio bind the real one.
//
// Screen-x of a tile depends only on `tx − ty` and carries NO lift term, so that axis
// inverts exactly. Screen-y depends on `tx + ty` AND the terrain lift, and on steep
// relief many tiles along that diagonal project to the same pixel (a near low tile
// overlaps a far high peak). The inverse therefore MARCHES the diagonal front→back and
// returns the frontmost surface crossing — the tile the GPU actually draws under the
// cursor — so picking is pixel-perfect on slopes, not just on the flat.

import type { Camera } from '@/core/types';
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';

export const ISO_HALF_W = ISO_TILE_W / 2;
export const ISO_HALF_H = ISO_TILE_H / 2;

/** Everything world-specific the projection needs, injected so the core stays pure. */
export interface IsoEnv {
  /** Normalised elevation [0,1] at a (fractional) tile coord — bilinear, matching the
   *  GPU terrain vertex sampler. Implementations clamp to the map. */
  elevAt(tx: number, ty: number): number;
  /** The sea datum subtracted before lifting (lift is relative to sea level). */
  seaLevel: number;
  /** Lift gain: (elev − seaLevel) × k = screen-y lift in px (pre-zoom). */
  k: number;
  width: number;
  height: number;
}

/** Tile (fractional) → CSS-pixel screen, lifted onto the terrain. */
export function tileToScreen(tx: number, ty: number, cam: Camera, env: IsoEnv): { x: number; y: number } {
  const lift = (env.elevAt(tx, ty) - env.seaLevel) * env.k;
  return {
    x: ((tx - ty) * ISO_HALF_W - cam.x) * cam.zoom,
    y: ((tx + ty) * ISO_HALF_H - lift - cam.y) * cam.zoom,
  };
}

/** Flat (lift-ignoring) inverse — exact on the x-axis, off by the lift on the y-axis.
 *  Used as the seed/fallback for the marching inverse. NOT clamped. */
export function screenToTileFlat(sx: number, sy: number, cam: Camera): { tx: number; ty: number } {
  const a = (sx / cam.zoom + cam.x) / ISO_HALF_W;   // tx − ty (lift-free, exact)
  const b = (sy / cam.zoom + cam.y) / ISO_HALF_H;    // tx + ty (lift omitted)
  return { tx: (a + b) / 2, ty: (b - a) / 2 };
}

/**
 * Lift-aware inverse: CSS-pixel screen → the frontmost tile drawn under the cursor.
 * Marches the diagonal `s = tx + ty` from front (largest s) to back, returning the
 * first surface crossing (refined by bisection). Result clamped to the map. When the
 * cursor is off every surface (sky / outside the map diamond), falls back to the flat
 * inverse, clamped — matching the legacy `screenToTileApprox` behaviour for brushes.
 */
export function screenToTile(sx: number, sy: number, cam: Camera, env: IsoEnv, step = 0.1): { tx: number; ty: number } {
  const W = env.width, H = env.height;
  const clamp = (tx: number, ty: number) => ({
    tx: Math.max(0, Math.min(W - 1, tx)),
    ty: Math.max(0, Math.min(H - 1, ty)),
  });
  const a = (sx / cam.zoom + cam.x) / ISO_HALF_W;     // tx − ty, exact
  const Y = sy / cam.zoom + cam.y;                      // s·HALF_H − lift at the answer
  const sLo = Math.abs(a);                              // tx≥0 ∧ ty≥0
  const sHi = Math.min(2 * (W - 1) - a, 2 * (H - 1) + a); // tx≤W−1 ∧ ty≤H−1
  if (sHi < sLo) { const f = screenToTileFlat(sx, sy, cam); return clamp(f.tx, f.ty); }
  const liftAt = (s: number): number => (env.elevAt((a + s) / 2, (s - a) / 2) - env.seaLevel) * env.k;
  const f = (s: number): number => s * ISO_HALF_H - liftAt(s) - Y;   // root ⇒ projects under cursor
  let prevS = sHi, prevF = f(sHi);
  for (let s = sHi - step; s >= sLo - 1e-6; s -= step) {
    const cur = f(s);
    if ((prevF <= 0) !== (cur <= 0)) {                 // sign change ⇒ crossing in [s, prevS]
      let lo = s, hi = prevS, flo = cur;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2, fm = f(mid);
        if ((flo <= 0) === (fm <= 0)) { lo = mid; flo = fm; } else { hi = mid; }
      }
      const sr = (lo + hi) / 2;
      return clamp((a + sr) / 2, (sr - a) / 2);
    }
    prevS = s; prevF = cur;
  }
  const fl = screenToTileFlat(sx, sy, cam);            // above all peaks → flat fallback
  return clamp(fl.tx, fl.ty);
}
