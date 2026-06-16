// src/studio/types.ts
// Shared studio types + A/B model constants. Moved out of studio.ts (pure refactor).
import type { LightingState } from '@/render/lighting-state';
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';

// Candidate img2img models for the A/B eval. Approx per-image cost at our ≤1 MP
// sprite size (OpenRouter pricing, 2026-06). The prompt + output modalities are
// adapted per model automatically (buildingImagePrompt / defaultModalitiesFor).
export const AB_MODELS: { id: string; label: string }[] = [
  { id: 'google/gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image (~$0.039)' },
  { id: 'black-forest-labs/flux.2-klein-4b', label: 'FLUX.2 Klein 4B (~$0.014)' },
  { id: 'black-forest-labs/flux.2-pro', label: 'FLUX.2 Pro (~$0.03)' },
  { id: 'black-forest-labs/flux.2-flex', label: 'FLUX.2 Flex (~$0.06)' },
];

/** Gate thresholds (mirror generated-building-art-source) for the A/B verdict. */
export const AB_MIN_BORDER = 0.6, AB_MIN_IOU = 0.7;

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
  fit: boolean; // auto zoom-to-fit the subject (yields to any manual pan/zoom)
  // Opt-in ground apron under the building (the "skirt"): null = off; else the apron
  // overhang past the footprint (tiles) + an edge fade (0 = hard edge, 1 = soft blend
  // into the terrain beneath). Re-composes geometry when changed.
  skirt: { margin: number; fade: number } | null;
  dockH: number;
  // null → live 3D render; else show this buffer in the view pane.
  view: { canvas: SpriteCanvas; label: string } | null;
}
