// src/render/ui/ui-tokens.ts
//
// The ONE source of design values for the WebGPU UI (UI v3 P1-A). Aesthetic
// direction: illuminated manuscript / devotional — parchment grounds, ink
// linework, ONE gold accent reserved for interactive-and-divine elements,
// restrained motion. Builds ON TOP of `ui-palette.ts` (kept exactly as-is — it
// still derives the gray-box panel/button/text ramp from the world's canvas
// palette — and re-exported below so every caller needs exactly one import).
//
// No module should hardcode a colour, spacing value, stroke weight, font scale
// or motion duration after this lands — pull it from here.

import { oklchToRgba, withAlpha, type Rgba } from '@/render/ui/ui-color';
import { UI_PALETTE, deriveUiPalette, type UiPalette } from '@/render/ui/ui-palette';

export { UI_PALETTE, deriveUiPalette, type UiPalette };

/**
 * Devotional colour set — additive to `UI_PALETTE`, not a replacement for it.
 * `UI_PALETTE` stays the gray-box slate/button ramp used by the legacy chrome
 * (menu, cards, HUD) until those are re-skinned; the kit (`src/render/ui/kit/`)
 * and new shell screens (P1+) paint with THESE instead.
 */
export const COLOR = {
  /** Page ground — warm parchment, the surface new screens sit on. */
  parchment: oklchToRgba(0.93, 0.025, 85),
  /** A receded parchment for sunken/inset surfaces (tracks, thumbnail wells,
   *  disabled fills) — same hue as `parchment`, darker. */
  ground: oklchToRgba(0.87, 0.02, 85),
  /** Primary linework/text — near-black ink, warmed to the parchment's hue so
   *  it reads as ink-on-vellum rather than screen-black-on-cream. */
  ink: oklchToRgba(0.22, 0.02, 70),
  /** Secondary/caption ink (metadata lines, timestamps, disabled labels). */
  inkDim: oklchToRgba(0.45, 0.015, 70),
  /**
   * THE accent. Deliberately the SAME value as `UI_PALETTE.accent` (both
   * ultimately `CANVAS.faith`, the world's gold) rather than a second
   * independently-tuned gold — one definition, so the button focus ring
   * (`ui-context.ts`, which reads `UI_PALETTE.accent` directly to avoid this
   * module importing it back) and every kit widget agree pixel-for-pixel.
   * Spend it ONLY on interactive-and-divine marks (focus rings, primary CTAs,
   * the presence orb) — if it starts decorating static chrome it has stopped
   * reading as "divine" and started reading as "yellow".
   */
  gold: UI_PALETTE.accent,
  /** Gold at rest — a CTA border/underline that is present but not focused. */
  goldDim: withAlpha(UI_PALETTE.accent, 0.5),
  /** Destructive actions (delete slot, discard, quit-without-saving). Kept
   *  OUT of the gold family on purpose — danger must never read as divine. */
  danger: oklchToRgba(0.55, 0.18, 25),
  /** Confirmation / "ok" states (save complete, slot healthy). Echoes the
   *  world's grass-green (life), kept distinct from `gold` (divine) and
   *  `danger` (destructive) so the three read as three different intents. */
  success: oklchToRgba(0.65, 0.13, 140),
} as const satisfies Record<string, Rgba>;

/**
 * Spacing scale, integer device px. Every gap/padding/margin a screen or kit
 * widget needs should be one of these nine values — introducing a tenth is a
 * signal the layout wants a rethink, not a new constant.
 */
export const SPACING = {
  hairline: 2, // smallest gap: icon-to-glyph, the space a focus ring eats
  tight: 4, // dense inline gaps: chip inner padding, inline icon-to-label
  snug: 6, // between a label and its immediate value/readout (slider readout)
  sm: 8, // compact padding: list row insets, chip stacks
  md: 12, // standard control padding: buttons, chips, card rows
  lg: 16, // section padding inside panels/cards, modal title gap
  xl: 24, // gaps between grouped controls (tab groups, control clusters)
  xxl: 32, // major layout gutters: modal margins, screen-edge padding
  xxxl: 48, // top-level hero spacing (title screen wordmark, big CTAs)
} as const satisfies Record<string, number>;

/** Stroke weights, integer device px. */
export const STROKE = {
  hairline: 1, // the default panel/card/divider border used everywhere today
  focus: 2, // keyboard/gamepad focus ring — readable at a glance, still inset
  heavy: 3, // rare, deliberately loud emphasis frames (e.g. a game-over frame)
} as const satisfies Record<string, number>;

/**
 * Type scale — integer multipliers of the 5×7 pixel font (`BuiltinPixelFont`).
 * Fractional scales are never allowed (1.5 is explicitly NOT a value here);
 * `small` is the smallest legible integer step below `body`, not a half-step.
 *
 * NOTE: `ui-runtime.ts` still declares its own local `FS_TITLE = 4` /
 * `FS_BODY = 2` and is deliberately left untouched this phase (the brief for
 * P1-A is additive-only — `ui-runtime.ts` is out of scope). `FS.title` /
 * `FS.body` below duplicate those two values on purpose; a later phase
 * repoints `ui-runtime.ts`'s usages at `FS.*` and deletes its local consts.
 */
export const FS = {
  small: 1, // captions, timestamps, secondary chip text
  body: 2, // standard HUD/menu/screen text — == ui-runtime.ts's FS_BODY
  title: 4, // screen/section titles — == ui-runtime.ts's FS_TITLE
  display: 6, // the title-screen wordmark (paired with a future font `bold` option)
} as const satisfies Record<string, number>;

/**
 * Motion durations, ms. "Restrained motion" means this list should stay
 * short — reach for `fade` before inventing a new easing/duration pair.
 */
export const MOTION = {
  fade: 150, // short label/panel fades — == ui-runtime.ts's LABEL_FADE_MS
} as const satisfies Record<string, number>;
