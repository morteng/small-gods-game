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
 * `ui-runtime.ts` used to declare its own local `FS_TITLE = 4` / `FS_BODY = 2`
 * duplicating `title`/`body` below (P1-A left it untouched deliberately, out
 * of scope for that phase); P4b repointed every usage at `FS.title`/`FS.body`
 * and deleted the local consts — this is now the only definition.
 */
export const FS = {
  // ── SHELL / META SCREENS: the 10-foot tier (title, save/load, settings, …) ──
  // USER PRODUCT DIRECTION (2026-07-25): this is a GAME, and its menus must read
  // like a console game's — sized for someone on a couch looking at a TV, not for
  // a desktop app at arm's length. Primary interactive text is therefore ~2x the
  // in-game HUD's body scale.
  //
  // THE FLOOR IS `caption`. Nothing in the shell or the kit may render smaller.
  // A dense screen handles overflow by SCROLLING (`UiContext.scrollList`) or
  // paginating — NEVER by stepping the font down. Secondary text gets dimmer
  // (`COLOR.inkDim`), not smaller. The old `small: 1` tier was exactly that
  // mistake: it rendered captions at HALF body size, and the controls list
  // silently shrank itself to fit. It is deleted, not deprecated.
  //
  // Consequence, and it is the correct trade: at this size FEWER rows fit per
  // screen. Embrace it — that is what 10-foot design costs. Hit targets grow with
  // the type too (full-width rows, generous padding), which serves TV pointers,
  // touch and gamepad focus alike.
  /** Metadata, timestamps, hints. The FLOOR — never go below this anywhere. */
  caption: 2,
  /** ALL interactive rows: menu items, settings rows + values, slot names,
   *  bindings, dialog choices. The default for anything the player can act on. */
  menu: 4,
  /** Screen titles / section headings. */
  heading: 6,
  /** The title wordmark (pairs with the font's `bold` option). */
  display: 8,

  // ── IN-GAME HUD (ui-runtime): unchanged ──
  // The HUD overlays the world at normal viewing distance and is NOT a shell
  // screen, so the 10-foot rule deliberately does not apply to it. Retuning the
  // HUD is a separate decision from retuning the menus.
  /** Standard in-game HUD text. */
  body: 2,
  /** In-game HUD titles (pause menu heading, card titles). */
  title: 4,
} as const satisfies Record<string, number>;

// ── RESPONSIVE SHELL TYPE SCALE ─────────────────────────────────────────────
// The same UI has to work on a phone held at 30cm, a desktop at arm's length,
// and a TV across a room. So the shell's text scale is derived from the
// EFFECTIVE VIEWPORT WIDTH as well as DPR — never DPR alone, which knows
// nothing about viewing distance (a 3x phone and a 2x laptop would otherwise
// get near-identical glyphs for very different situations).
//
// One centralized step function, so this is never a per-screen judgement call.
// Everything stays an INTEGER multiple of the 5x7 pixel font (the pixel-perfect
// rule) — a fractional glyph scale is not an option at any breakpoint.

/** Viewing-context class, from the effective (CSS-px) viewport width. */
export type SizeClass = 'compact' | 'regular' | 'large';

/** Breakpoints in CSS px. `compact` = phones/narrow windows (held close, needs
 *  wrapping + big touch targets more than big glyphs); `regular` = laptop/desktop
 *  at arm's length; `large` = 1080p+, assumed couch distance. */
export const SIZE_BREAKPOINTS = { compact: 700, regular: 1400 } as const;

export function sizeClassFor(cssWidth: number): SizeClass {
  if (cssWidth < SIZE_BREAKPOINTS.compact) return 'compact';
  if (cssWidth < SIZE_BREAKPOINTS.regular) return 'regular';
  return 'large';
}

/** The four shell tiers, as multipliers of the integer HUD scale `s`, per class.
 *  `regular` is deliberately LARGER than the pre-2026-07-25 shell (which drew
 *  menus at `FS.body` = 2s): the user reported that as too small. `large` steps
 *  up again for TV distance; `compact` steps down, because a phone gains more
 *  from wrapping and touch targets than from giant glyphs. */
const SHELL_TIERS: Record<SizeClass, { caption: number; menu: number; heading: number; display: number }> = {
  compact: { caption: 1, menu: 2, heading: 3, display: 4 },
  regular: { caption: 2, menu: 3, heading: 5, display: 7 },
  large: { caption: 2, menu: 4, heading: 6, display: 9 },
};

/** Final device-px font scales for a shell screen at this viewport.
 *
 *  `s` is the integer HUD scale (`uiScaleFor(dpr)`); the tier multiplies it, so
 *  the result stays integer and crisp. Screens should take their scales from
 *  HERE rather than reaching for `FS.*` directly — `FS` remains the raw token
 *  table (and the in-game HUD's own tiers). */
export function shellTypeScale(cssWidth: number, s: number): {
  cls: SizeClass; caption: number; menu: number; heading: number; display: number;
} {
  const cls = sizeClassFor(cssWidth);
  const t = SHELL_TIERS[cls];
  return {
    cls,
    caption: Math.max(1, t.caption * s),
    menu: Math.max(1, t.menu * s),
    heading: Math.max(1, t.heading * s),
    display: Math.max(1, t.display * s),
  };
}

/** `shellTypeScale` from a screen's own arguments.
 *
 *  Screens receive `(w, h, s)` in DEVICE px and never see `dpr` — but
 *  `uiScaleFor(dpr)` is `max(1, round(dpr))`, so `wDev / s` recovers the
 *  effective CSS width exactly for the integer DPRs that produces. This is the
 *  call every shell screen should use. */
export function shellTypeScaleFor(wDev: number, s: number): ReturnType<typeof shellTypeScale> {
  return shellTypeScale(wDev / Math.max(1, s), s);
}

/** Minimum comfortable HIT TARGET in device px, by class. Touch needs ~44 CSS px
 *  regardless of how small the glyphs are; larger classes grow with the type so a
 *  TV pointer and a gamepad focus ring both land easily. */
export function minHitSize(cls: SizeClass, s: number): number {
  const cssMin = cls === 'compact' ? 44 : cls === 'regular' ? 36 : 48;
  return Math.round(cssMin * Math.max(1, s / 2));
}

/** The smallest font scale any SHELL/KIT text may use at a given viewport — the
 *  caption tier. Nothing may render below it; dense content SCROLLS instead.
 *  Exported so a guard test can assert it — `tests/unit/ui-min-text-scale.test.ts`. */
export function minShellFontScale(cssWidth: number, s: number): number {
  return shellTypeScale(cssWidth, s).caption;
}

/**
 * Motion durations, ms. "Restrained motion" means this list should stay
 * short — reach for `fade` before inventing a new easing/duration pair.
 */
export const MOTION = {
  fade: 150, // short label/panel fades — == ui-runtime.ts's LABEL_FADE_MS
} as const satisfies Record<string, number>;
