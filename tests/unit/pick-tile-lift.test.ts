import { describe, it, expect } from 'vitest';
import type { Camera } from '@/core/types';
import { pickTile } from '@/ui/pick-tile';
import { tileToScreen, type IsoEnv } from '@/render/iso/lifted-projection';
import { liftPxFromElev } from '@/render/gpu/terrain-lift';

// A synthetic world with ONE smooth peak at (32,32): elevation falls off linearly to the
// sea datum. This is enough to exercise the lift-aware inverse vs the flat one — no real
// heightfield needed (the projection core is injectable via IsoEnv).
const SEA = 0;
const K = 400; // lift gain px per elevation unit (mountainRelief × verticalExaggeration)
function peakEnv(): IsoEnv {
  const elevAt = (tx: number, ty: number) => {
    const d = Math.hypot(tx - 32, ty - 32);
    return Math.max(0, 1 - d / 22) * 0.6; // 0.6 at the summit → 240px lift
  };
  return { elevAt, seaLevel: SEA, k: K, width: 64, height: 64 };
}
const cam: Camera = { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 };

describe('lift-aware tile picking', () => {
  it('flat picking mis-resolves the tile under a lifted peak; lift-aware recovers it', () => {
    const env = peakEnv();
    // Where the GPU actually draws the summit tile's centre (lifted up-screen).
    const scr = tileToScreen(32.5, 32.5, cam, env);

    const flat = pickTile(cam, scr.x, scr.y);          // no env → height-free inverse
    const lifted = pickTile(cam, scr.x, scr.y, env);   // env → marching inverse

    // The lift-aware pick lands on the summit tile (sub-tile precision).
    expect(Math.round(lifted.tx)).toBe(32);
    expect(Math.round(lifted.ty)).toBe(32);

    // The flat pick is wrong — pushed down-screen along the view diagonal by the lift.
    const flatErr = Math.hypot(flat.tx - 32, flat.ty - 32);
    expect(flatErr).toBeGreaterThan(3);                 // several tiles off on a tall peak
    expect(Math.hypot(lifted.tx - 32, lifted.ty - 32)).toBeLessThan(1.0); // within one tile
  });

  it('the flat error matches the analytic prediction liftPx / ISO_HALF_H along the diagonal', () => {
    const env = peakEnv();
    const scr = tileToScreen(32.5, 32.5, cam, env);
    const flat = pickTile(cam, scr.x, scr.y);
    // screenToTileFlat omits the lift on the s = tx+ty axis: error in s ≈ liftPx / ISO_HALF_H.
    const liftPx = liftPxFromElev(env.elevAt(32.5, 32.5), SEA, 1, K); // reliefM·zPxPerM == K
    const sErrPredicted = liftPx / 32; // ISO_HALF_H = 32 → ~7.3 tiles
    const sErrActual = Math.abs((flat.tx + flat.ty) - (32.5 + 32.5));
    expect(sErrActual).toBeGreaterThan(6);
    expect(Math.abs(sErrActual - sErrPredicted)).toBeLessThan(1); // within a tile of the model
  });

  it('on flat ground (no lift) both inverses agree', () => {
    const flatEnv: IsoEnv = { elevAt: () => SEA, seaLevel: SEA, k: K, width: 64, height: 64 };
    const scr = tileToScreen(20.3, 12.7, cam, flatEnv); // off the .5 rounding boundary
    // Flat inverse returns rounded integer tiles; lifted returns fractional — compare
    // the tile IDENTITY (what was clicked), which must agree where there's no lift.
    const a = pickTile(cam, scr.x, scr.y);
    const b = pickTile(cam, scr.x, scr.y, flatEnv);
    expect([Math.round(a.tx), Math.round(a.ty)]).toEqual([Math.round(b.tx), Math.round(b.ty)]);
  });

  it('liftPxFromElev is the shared formula (elev−sea)·reliefM·zPxPerM', () => {
    expect(liftPxFromElev(0.6, 0.35, 48, 20)).toBeCloseTo((0.6 - 0.35) * 48 * 20, 6);
    expect(liftPxFromElev(0.35, 0.35, 48, 20)).toBe(0); // at sea level → no lift
  });
});
