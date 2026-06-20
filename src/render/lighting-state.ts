/**
 * Runtime lighting state for the WebGL entity layer (PBR Slice 3).
 *
 * One global directional sun + ambient, applied per-pixel to building sprites
 * via their co-registered normal/material maps, with the diffuse term
 * quantized into bands so the pixel-art look survives. Direction follows the
 * project's canonical upper-left sun (`src/render/lighting.ts`) expressed in
 * the normal maps' SCREEN space (`normalRGB` in assetgen/render/projection.ts:
 * +x = screen-right, +y = screen-up, +z = toward the camera).
 *
 * Slice 4 will derive this from `state.clock` (day/night); for now it is a
 * fixed, gentle re-shading — the albedo already bakes upper-left FORM shading,
 * so v1 keeps contrast low (ambient-dominant) rather than double-shading hard.
 */

export type Vec3 = [number, number, number];

/** Cast-shadow style. `geometry` = the shadow baked from the real 3D geometry
 *  (projected to the ground at gen time) — correct shape, cheap blit; falls back
 *  to silhouette for items with no baked shadow. `silhouette` = projected/skewed
 *  sprite copy; `blob` = a flat ground ellipse under the foot (fast, organic);
 *  `off` = no cast shadows. */
export type ShadowMode = 'geometry' | 'silhouette' | 'blob' | 'off';

export interface LightingState {
  /** Master switch — false renders the plain unlit sprites (Slice 2 behavior). */
  enabled: boolean;
  /** Cast-shadow style (default 'silhouette'). */
  shadowMode?: ShadowMode;
  /** Ambient light colour, 0..1 per channel. */
  ambient: Vec3;
  /** Direction TOWARD the sun in normal-map screen space, normalized. */
  sunDir: Vec3;
  /** Sun (directional diffuse) colour, 0..1 per channel. */
  sunColor: Vec3;
  /** Diffuse quantization band count (≥1). */
  bands: number;
  /** Night factor 0..1 — fades in sprite emissive (lit window panes). 0 ⇒ day, no
   *  glow; 1 ⇒ full glow. Derived per-frame from the clock; absent ⇒ treated as 0. */
  nightFactor?: number;
}

export function normalizeVec3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Canonical upper-left sun: left of screen, above, in front (toward camera). */
export const DEFAULT_SUN_DIR: Vec3 = normalizeVec3([-0.5, 0.65, 0.58]);

export const DEFAULT_LIGHTING: LightingState = {
  enabled: true,
  // Geometry-baked ground shadows where available (trees/props/parametric
  // buildings); items without a baked shadow (cached img2img buildings, NPCs)
  // fall back to the projected silhouette.
  shadowMode: 'geometry',
  // Slightly cool ambient, slightly warm sun; flat camera-facing pixels land
  // near 1.0 so the overall brightness stays close to the unlit sprite.
  ambient: [0.7, 0.7, 0.74],
  sunDir: DEFAULT_SUN_DIR,
  sunColor: [0.4, 0.38, 0.33],
  bands: 4,
};

/** The disabled state (dev toggle 'Lighting: Off'). */
export const LIGHTING_OFF: LightingState = { ...DEFAULT_LIGHTING, enabled: false };
