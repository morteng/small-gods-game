/**
 * Canvas palette — single source of truth for colors drawn directly onto the
 * canvas (HUD, action overlays). DOM UI uses the CSS custom properties in
 * tokens.css; canvas 2D can't read those per-draw cheaply, so we mirror the
 * same world-derived palette here as oklch strings. Keep these in sync with
 * src/ui/tokens.css — they are deliberately the same source colors so chrome
 * and canvas agree.
 *
 * Canvas 2D `fillStyle`/`strokeStyle` accept oklch() in all current browsers.
 */

// World-derived sources (mirror of tokens.css :root --w-*)
const W_SUN = 'oklch(0.78 0.13 85)';    // harvest gold — faith / whisper
const W_GRASS = 'oklch(0.62 0.10 140)'; // fields — life / omen
const W_DUSK = 'oklch(0.65 0.14 45)';   // late afternoon — player / miracle

/** Semantic canvas colors, named by meaning (not hue). */
export const CANVAS = {
  /** Translucent dark surface behind HUD pills. */
  surface: 'oklch(0.20 0.02 60 / 0.65)',
  /** Text on dark surfaces. */
  onSurface: 'oklch(0.985 0.008 80)',

  /** Player power / faith accent (gold). */
  faith: W_SUN,
  faithFill: 'oklch(0.78 0.13 85 / 0.92)',

  /** Whisper action (gold, matches faith). */
  whisperFill: 'oklch(0.78 0.13 85 / 0.92)',
  whisperLine: W_SUN,

  /** Omen action (grass green — life). */
  omenFill: 'oklch(0.62 0.10 140 / 0.92)',
  omenLine: W_GRASS,

  /** Miracle action (dusk/terracotta — the player's hand at work). */
  miracleFill: 'oklch(0.65 0.14 45 / 0.92)',
  miracleLine: W_DUSK,

  /** Button label text. */
  onAction: 'oklch(0.985 0.008 80)',

  /** Inactive/disabled action button (insufficient power, on cooldown). */
  inactiveFill: 'oklch(0.25 0.02 60 / 0.85)',
  inactiveLine: 'oklch(0.62 0.012 60 / 0.4)',
  inactiveText: 'oklch(0.72 0.012 65 / 0.6)',
} as const;

/** Shared canvas type scale (matches tokens.css --t-*). */
export const CANVAS_FONT = {
  hud: 'bold 13px "IBM Plex Mono", ui-monospace, monospace',
  button: 'bold 11px "Manrope", system-ui, sans-serif',
  buttonSmall: 'bold 10px "Manrope", system-ui, sans-serif',
} as const;
