// src/studio/types.ts
// Shared studio types + A/B model constants. Moved out of studio.ts (pure refactor).
import type { LightingState } from '@/render/lighting-state';
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';

// Candidate img2img models for the A/B eval. Approx per-image cost at our ≤1 MP
// sprite size (qwen on Replicate; the rest OpenRouter, pricing 2026-06/07). The
// provider + prompt + output modalities are adapted per model automatically
// (generateBuildingImageAuto / buildingImagePrompt / defaultModalitiesFor).
export const AB_MODELS: { id: string; label: string }[] = [
  { id: 'qwen/qwen-image-edit-2511', label: 'Qwen Image Edit 2511 (Replicate, ~$0.03)' },
  { id: 'google/gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image (~$0.039)' },
  { id: 'black-forest-labs/flux.2-klein-4b', label: 'FLUX.2 Klein 4B (~$0.014)' },
  { id: 'black-forest-labs/flux.2-pro', label: 'FLUX.2 Pro (~$0.03)' },
  { id: 'black-forest-labs/flux.2-flex', label: 'FLUX.2 Flex (~$0.06)' },
];

/** Gate thresholds for the A/B verdict — THE runtime gates, re-exported so the
 *  harness's "rejected in-game" claim can never drift from the real pipeline. */
export { MIN_BORDER_KEYED as AB_MIN_BORDER, MIN_SILHOUETTE_IOU as AB_MIN_IOU } from '@/render/generated-building-art-source';

export interface AbResult {
  model: string; ok: boolean; error?: string;
  costUsd: number; ms: number; border: number; iou: number;
  raw: SpriteCanvas | null; final: SpriteCanvas | null; verdict: string;
}

/** A single inspectable buffer in the stage strip / view pane. */
export interface Stage { label: string; canvas: SpriteCanvas | null; sub?: string }

export interface StudioState {
  kind: string;
  lighting: LightingState;
  az: number;   // sky-light azimuth, degrees (sun by day, moon by night)
  el: number;   // sky-light elevation, degrees
  // Sun/sky driver. 'solar' derives az/el + light colour from time/season/moon;
  // 'manual' lets az/el be dragged directly (colour still tracks elevation).
  sunMode: 'solar' | 'manual';
  hour: number;       // time of day, 0..24
  yearFrac: number;   // day of year, 0..1 (0 = spring equinox, 0.25 = summer solstice)
  lat: number;        // latitude, degrees N
  moonPhase: number;  // 0 = new (dark) … 1 = full (bright, anti-solar)
  overlays: boolean;
  // Show the finished img2img-textured sprite (when one exists for this blueprint —
  // from a session render or the seeded library) lit on grass, instead of the grey
  // massing render. Default ON: a fully-generated asset shows its game-ready art.
  textured: boolean;
  fit: boolean; // auto zoom-to-fit the subject (yields to any manual pan/zoom)
  // Scale mode. 'proper' = a FIXED true-metric scale shared across every subject,
  // so real size reads honestly (a church renders bigger than a cottage); 'game' =
  // fit-to-fill each subject (the convenient framing, ≈ the in-game look). A 1.7 m
  // human + the 2 m grid are drawn as the scale reference in both.
  scaleMode: 'proper' | 'game';
  // Turntable yaw (radians) — orbits the view around the model (right-drag / Q·E),
  // snapped to 15° steps so each angle's geometry bake is cached & reused.
  yaw: number;
  // Opt-in ground apron under the building (the "skirt"): null = off; else the apron
  // overhang past the footprint (tiles) + an edge fade (0 = hard edge, 1 = soft blend
  // into the terrain beneath). Re-composes geometry when changed.
  skirt: { margin: number; fade: number } | null;
  dockH: number;
  // null → live 3D render; else show this buffer in the view pane.
  view: { canvas: SpriteCanvas; label: string } | null;
}
