// src/render/iso/iso-env.ts
//
// The SINGLE binding of a world's terrain to the pure iso projection core
// (`lifted-projection.ts`). Everything that needs to convert tile↔screen ON the
// lifted terrain surface — the connectome overlay, studio picking, and in-game
// mouse picking — builds its `IsoEnv` HERE, so there is exactly one definition of
// "where the ground is" and the forward projection, its inverse, and the entity
// foot-z lift can never disagree.
//
// The lift gain `k = mountainRelief × terrainVerticalExaggeration` is the SAME
// product the GPU terrain shader applies (`uZParams`: reliefM × zPxPerM) and the
// CPU entity lift (`terrain-lift.ts`) uses — see `liftPxFromElev`. The elevation
// sampler reads the COMPOSED, gamma-curved render height buffer (road/river carve
// included), bilinearly, exactly matching the shader's vertex sampler, so a node
// sits on the carved channel floor, not the raw noise surface.
//
// Pure (apart from the memoised `heightField`); unit-tested against a synthetic
// heightfield via the injectable `IsoEnv` shape.

import type { GameMap } from '@/core/types';
import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { heightField } from '@/render/gpu/terrain-field';
import { worldStyleOf } from '@/core/world-style';
import type { IsoEnv } from '@/render/iso/lifted-projection';

/** Bilinear normalised elevation [0,1] at a fractional tile, read from the COMPOSED
 *  render-height buffer (carve + gamma) — matches the GPU terrain vertex sampler, so
 *  the projection lands on the same surface the shader draws. */
export function renderElevAt(map: GameMap, tx: number, ty: number): number {
  const W = map.width, H = map.height;
  const hf = heightField(map);
  const fx = Math.max(0, Math.min(W - 1, tx)), fy = Math.max(0, Math.min(H - 1, ty));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const dx = fx - x0, dy = fy - y0;
  const top = hf[y0 * W + x0] * (1 - dx) + hf[y0 * W + x1] * dx;
  const bot = hf[y1 * W + x0] * (1 - dx) + hf[y1 * W + x1] * dx;
  return top * (1 - dy) + bot * dy;
}

/** Bind a world's terrain sampler + lift constants into the pure projection's `IsoEnv`.
 *  THE single factory — picking, the connectome overlay and studio drill-down all call
 *  this, so they share pixel-exact parity with the GPU lift. `heightField` is memoised,
 *  so recreating the closure per call is cheap. */
export function isoEnvForMap(map: GameMap): IsoEnv {
  const style = worldStyleOf(map.worldSeed);
  return {
    elevAt: (tx, ty) => renderElevAt(map, tx, ty),
    seaLevel: ELEVATION_SEA_LEVEL,
    k: style.mountainRelief * style.terrainVerticalExaggeration,
    width: map.width,
    height: map.height,
  };
}
