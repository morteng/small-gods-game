// src/render/ui/ui-palette.ts
//
// UI design tokens for the WebGPU UI layer (S1). Canvas has no `tokens.css`, so
// tokens live in TS as resolved `Rgba` — DERIVED from the one world-colour source
// the canvas already uses (`CANVAS` in `src/render/canvas-palette.ts`) so chrome
// and world share colour. These are GRAY-BOX values: flat fills + borders. S3.5
// swaps the painted skin atlas in over these slots.

import { CANVAS } from '@/render/canvas-palette';
import { parseUiColor, shade, withAlpha, type Rgba } from '@/render/ui/ui-color';

export interface UiPalette {
  /** Panel/inspector surface. */
  panelBg: Rgba;
  panelBorder: Rgba;
  /** Primary + dimmed text on surfaces. */
  text: Rgba;
  textDim: Rgba;
  /** Button states (gray-box): rest → hover → press, plus disabled + label. */
  buttonBg: Rgba;
  buttonHotBg: Rgba;
  buttonActiveBg: Rgba;
  buttonBorder: Rgba;
  buttonText: Rgba;
  disabledBg: Rgba;
  disabledText: Rgba;
  /** Accent (player faith / gold) — orb, highlights, focus rings. */
  accent: Rgba;
}

/** Build the UI palette from a world-colour source (defaults to `CANVAS`). */
export function deriveUiPalette(source: typeof CANVAS = CANVAS): UiPalette {
  const surface = parseUiColor(source.surface);
  const onSurface = parseUiColor(source.onSurface);
  const accent = parseUiColor(source.faith);
  const buttonBg = withAlpha(shade(surface, 0.06), 0.9);

  return {
    panelBg: withAlpha(surface, 0.82),
    panelBorder: parseUiColor(source.inactiveLine),
    text: onSurface,
    textDim: withAlpha(onSurface, 0.6),
    buttonBg,
    buttonHotBg: withAlpha(shade(buttonBg, 0.16), 0.95),
    buttonActiveBg: withAlpha(shade(buttonBg, -0.18), 0.95),
    buttonBorder: parseUiColor(source.inactiveLine),
    buttonText: onSurface,
    disabledBg: parseUiColor(source.inactiveFill),
    disabledText: parseUiColor(source.inactiveText),
    accent,
  };
}

/** The default, eagerly-derived palette (one shared instance). */
export const UI_PALETTE: UiPalette = deriveUiPalette();
