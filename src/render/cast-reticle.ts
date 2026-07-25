/**
 * Cast Reticle — abilities-v1 A2: a world-space ring on the Canvas2D overlay,
 * drawn only while a verb-first cast is armed (`interaction.targeting`,
 * `Game.castPower`). It shares the overlay layer with `divine-effects.ts`
 * (both rendered from `frame-renderer.ts`, alive even in barebones mode) and
 * the SAME projection idiom `alert-pins.ts` established for that layer:
 * `worldToScreen` (`iso/iso-projection.ts`) + `isoStageTransform`
 * (`iso/entity-draw-list.ts`) — the camera pans in ISO-SCREEN space, so the
 * flat `tile × TILE_SIZE` mapping lands mid-ocean (the documented gotcha this
 * slice also fixes in `divine-effects.ts`, see that file's `render()`).
 *
 * ONE difference from `alert-pins.ts`'s `projectWorldAnchor`: that helper
 * multiplies by `dpr` because it feeds the WebGPU UI pass, which works in
 * DEVICE px. This module draws on `Game.ctx`, the Canvas2D overlay context —
 * `Game.resize()` already runs `ctx.setTransform(devicePixelRatio,0,0,dpr,0,0)`
 * on it, so that context is ALREADY dpr-scaled and every draw call here must
 * stay in CSS px (matching `selection-outline.ts`'s `isoTileCenter`, the other
 * consumer of this same overlay ctx — no second dpr multiply).
 *
 * All math lives in the pure `projectCastReticle` helper (tile + camera + an
 * optional lift env → CSS-px centre + radius) so it is unit-testable with no
 * canvas at all; `renderCastReticle` is the thin paint on top. Deterministic —
 * no `Math.random` on the render path (the smite FX's fixed-zigzag discipline).
 */
import type { Camera } from '@/core/types';
import { worldToScreen } from '@/render/iso/iso-projection';
import { isoStageTransform } from '@/render/iso/entity-draw-list';
import { quantizeIsoZoom } from '@/render/iso/iso-camera';
import type { IsoEnv } from '@/render/iso/lifted-projection';
import { CANVAS } from '@/render/canvas-palette';

/** Ring radius in CSS px at native 1:1 zoom (`ISO_TILE_W`=128, `ISO_TILE_H`=64) —
 *  big enough to read as a reticle, small enough to stay inside the hovered
 *  tile's own diamond rather than bleeding into its neighbours. */
const RETICLE_BASE_RADIUS = 34;

export interface CastReticleGeometry {
  /** CSS-px centre, pixel-snapped. */
  cx: number;
  cy: number;
  /** CSS-px radius, pixel-snapped, scaled off the quantized zoom rung. */
  radius: number;
}

/**
 * Project the hovered tile to the reticle's CSS-px centre + radius.
 *
 * Lift-aware: `env` (build with `isoEnvForMap`, the same factory `getPickEnv`
 * uses) samples the terrain at the tile so the ring sits on the surface a
 * click would actually resolve against on a slope — passing `null` falls back
 * to sea-level (z=0), matching `pickTile`'s own no-env fallback.
 *
 * The radius snaps to `quantizeIsoZoom(camera.zoom, 0)`, NOT the raw
 * `camera.zoom` — `CameraDirector` tweens zoom continuously between rungs
 * mid-flight, and drawing at that instantaneous fractional zoom would sample
 * the ring at a fractional-pixel size every frame of the glide (this project
 * is strict about 1:1 pixel-perfect rendering). Position still tracks the
 * live (possibly mid-tween) camera exactly, same as every other overlay.
 */
export function projectCastReticle(
  tile: { x: number; y: number },
  camera: Camera,
  env: IsoEnv | null,
): CastReticleGeometry {
  const lift = env ? (env.elevAt(tile.x + 0.5, tile.y + 0.5) - env.seaLevel) * env.k : 0;
  const iso = worldToScreen(tile.x + 0.5, tile.y + 0.5, lift, 0, 0);
  const t = isoStageTransform(camera);
  const z = quantizeIsoZoom(camera.zoom, 0);
  return {
    cx: Math.round(iso.sx * t.scale + t.x),
    cy: Math.round(iso.sy * t.scale + t.y),
    radius: Math.round(RETICLE_BASE_RADIUS * z),
  };
}

/**
 * Paint the reticle: a bright ring + a softer inner echo + four crosshair
 * ticks (so it reads as a TARGETING reticle, not a bare circle). Gold
 * (`CANVAS.faith`, the same source colour as the power/faith HUD accent) when
 * the hovered tile would resolve to an accepted target; dim ink
 * (`CANVAS.inactiveLine`, the SAME tone the action pill uses for a disabled/
 * insufficient-power button) when it would not. `valid` is the caller's own
 * live "would `resolveTargetAt` accept this" read on hover — this module
 * never resolves targets itself, it only paints what it's told.
 */
export function renderCastReticle(
  ctx: CanvasRenderingContext2D,
  geo: CastReticleGeometry,
  valid: boolean,
): void {
  const color = valid ? CANVAS.faith : CANVAS.inactiveLine;
  const { cx, cy, radius } = geo;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.65, 0, Math.PI * 2);
  ctx.stroke();

  // Crosshair ticks at N/E/S/W, standing just off the ring.
  const tick = radius * 0.4;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(cx - radius - tick, cy); ctx.lineTo(cx - radius, cy);
  ctx.moveTo(cx + radius, cy); ctx.lineTo(cx + radius + tick, cy);
  ctx.moveTo(cx, cy - radius - tick); ctx.lineTo(cx, cy - radius);
  ctx.moveTo(cx, cy + radius); ctx.lineTo(cx, cy + radius + tick);
  ctx.stroke();

  ctx.restore();
}
