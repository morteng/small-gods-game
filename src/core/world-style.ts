// src/core/world-style.ts
//
// World Style — "Tone & Scale" meta-configuration (epic S0: the resolution core).
//
// Two orthogonal high-level dials the player sets once (or tweaks live), each of
// which fans out into many concrete generation/render knobs:
//
//   1. SCALE / "game factor"  (Simulator ↔ Storybook) — spatial & visual
//      exaggeration: terrain height, mountain drama, spacing, flora scale, palette.
//   2. RATING / tone          (Kid-friendly ↔ Mature) — how death/violence are
//      depicted, which dark events fire, the LLM's narrative voice.
//
// The pattern is exactly a graphics-settings panel: a PRESET sets everything, any
// individual OVERRIDE wins last. A `WorldStyleConfig` (preset names + a sparse
// override bag) is stored on `worldSeed.style` — deterministic, serialisable, part
// of the save (aligns with the seeded-sim rule). Consumers call `resolveWorldStyle`
// / `worldStyleOf` to get the flat `WorldStyle` record and read knobs from it
// instead of hardcoded constants.
//
// S0 is BEHAVIOUR-NEUTRAL: `STYLE_DEFAULTS` equals today's constants, profiles are
// sparse override-bags over it, and a missing `style` resolves to the defaults — so
// nothing changes until a world actually sets a preset/override. S1 wires the scale
// constants (terrain height etc.) to read from the resolved style.
//
// Pure, dependency-free (core layer): no imports, fully unit-testable.

/** Scale / "game factor" preset. `natural` = today's defaults (empty bag). */
export type ScalePreset = 'simulator' | 'natural' | 'storybook';
/** Content-rating preset (ESRB-like). */
export type RatingPreset = 'kid' | 'family' | 'teen' | 'mature';

/** How death is depicted in narration/visuals (rating axis). */
export type DeathDepiction = 'euphemistic' | 'plain' | 'graphic';
/** LLM narration voice (rating axis). */
export type NarrationTone = 'whimsical' | 'neutral' | 'grim';

/**
 * The fully-resolved flat record of every style knob. Consumers read these.
 * Multiplier knobs default to `1` (= "today's value"); the two absolute terrain
 * knobs default to today's constants (see {@link STYLE_DEFAULTS}). Most knobs are
 * declared here (the full taxonomy) but only the S1 scale set is wired so far;
 * each is annotated with the slice that consumes it.
 */
export interface WorldStyle {
  // ── Scale / "game factor" axis (Simulator ↔ Storybook) ──────────────────────
  /** Screen px per metre of terrain relief — vertical exaggeration. (S1; mirrors
   *  `TERRAIN_Z_PX_PER_M`.) Raise toward storybook, lower toward simulator. */
  terrainVerticalExaggeration: number;
  /** Total relief in metres for the full `0→1` elevation span. (S1; mirrors
   *  `TERRAIN_RELIEF_M`.) Taller = more dramatic mountains. */
  mountainRelief: number;
  /** Gamma applied to the render height ABOVE sea level: `a' = a^gamma` on the
   *  above-sea fraction. `1` = linear (neutral). `>1` keeps peaks tall while
   *  flattening low mounds (a dramatic massif over gentle valleys); `<1` puffs
   *  rises up. Affects ONLY the visual height buffer + water surface (hydrology /
   *  biomes / roads read the raw field), so the waterline stays aligned. (S1) */
  terrainHeightGamma: number;
  /** ×multiplier on the island's central-dome swell (coast → interior rise). (S1) */
  coastDrama: number;
  /** ×multiplier on open-field / croft dimensions. (S2) */
  fieldSize: number;
  /** ×multiplier on frontage gaps / lot padding between buildings. (S2) */
  buildingSpacing: number;
  /** ×multiplier on separation between settlements. (S2) */
  settlementSpacing: number;
  /** ×multiplier on separation between POIs. (S2) */
  poiSpacing: number;
  /** ×multiplier on growth pressure / buildings per settlement. (S2) */
  settlementDensity: number;
  /** ×multiplier on tree/bush size. (consumer pending — flora Slice 2 not wired) */
  floraScale: number;
  /** ×multiplier on tree/bush count. (S2 / flora) */
  floraDensity: number;
  /** ×multiplier on prop size. (S2) */
  propScale: number;
  /** ×multiplier on terrain/biome palette saturation. (future render knob) */
  paletteSaturation: number;
  /** ×multiplier on palette warmth. (future render knob) */
  paletteWarmth: number;
  /** Storybook outline thickness in px (0 = none/simulator). (future render knob) */
  outlineWeight: number;

  // ── Rating / tone axis (Kid-friendly ↔ Mature) ──────────────────────────────
  /** How death is shown. (S3 — event catalogue + LLM prompt) */
  deathDepiction: DeathDepiction;
  /** `0..1` ceiling on depicted violence (raids, war, sacrifice). (S3) */
  violence: number;
  /** Allow dark events (plague / famine / sacrifice / heresy-burning). (S3) */
  darkThemes: boolean;
  /** LLM narration voice. (S3 — `npc-prompt-builder` system-prompt modifier) */
  narrationTone: NarrationTone;
  /** `0..1` intensity of miracle visuals (gentle glow → smiting). (S3) */
  miracleIntensity: number;
  /** `0..1` LLM register / profanity ceiling. (S3) */
  language: number;
}

/**
 * The neutral baseline — every knob's value equals today's hardcoded constant, so
 * resolving with no preset/override reproduces current behaviour exactly. The two
 * terrain constants are mirrored here (kept in sync with `TERRAIN_Z_PX_PER_M` in
 * `render/gpu/terrain-field` and `TERRAIN_RELIEF_M` in `world/heightfield`, which
 * remain the seed defaults).
 */
export const STYLE_DEFAULTS: WorldStyle = {
  // Scale
  terrainVerticalExaggeration: 20, // == TERRAIN_Z_PX_PER_M (1:1=32 deferred: needs focus/occlusion handling)
  mountainRelief: 48,              // == TERRAIN_RELIEF_M
  terrainHeightGamma: 1,           // linear (neutral); >1 = dramatic peaks + flat mounds
  coastDrama: 1,
  fieldSize: 1,
  buildingSpacing: 1,
  settlementSpacing: 1,
  poiSpacing: 1,
  settlementDensity: 1,
  floraScale: 1,
  floraDensity: 1,
  propScale: 1,
  paletteSaturation: 1,
  paletteWarmth: 1,
  outlineWeight: 0,
  // Rating (neutral = roughly "teen": plain death, dark themes on, even voice)
  deathDepiction: 'plain',
  violence: 0.5,
  darkThemes: true,
  narrationTone: 'neutral',
  miracleIntensity: 0.5,
  language: 0.3,
};

/**
 * Scale-axis profiles — sparse override-bags over {@link STYLE_DEFAULTS}. Adding a
 * new knob never breaks an existing profile (unset knobs fall through to defaults).
 * `natural` is the empty bag (= defaults).
 */
export const SCALE_PROFILES: Record<ScalePreset, Partial<WorldStyle>> = {
  natural: {},
  simulator: {
    terrainVerticalExaggeration: 8,
    mountainRelief: 36,
    coastDrama: 0.6,
    fieldSize: 1.25,
    buildingSpacing: 0.85,
    settlementSpacing: 0.85,
    poiSpacing: 0.85,
    settlementDensity: 1.25,
    floraScale: 0.85,
    floraDensity: 1.2,
    propScale: 0.9,
    paletteSaturation: 0.85,
    outlineWeight: 0,
  },
  storybook: {
    terrainVerticalExaggeration: 24,
    mountainRelief: 72,
    coastDrama: 1.6,
    fieldSize: 0.8,
    buildingSpacing: 1.3,
    settlementSpacing: 1.2,
    poiSpacing: 1.2,
    settlementDensity: 0.8,
    floraScale: 1.35,
    floraDensity: 0.85,
    propScale: 1.2,
    paletteSaturation: 1.25,
    paletteWarmth: 1.1,
    outlineWeight: 2,
  },
};

/** Rating-axis profiles — sparse override-bags over {@link STYLE_DEFAULTS}. */
export const RATING_PROFILES: Record<RatingPreset, Partial<WorldStyle>> = {
  kid: {
    deathDepiction: 'euphemistic', violence: 0, darkThemes: false,
    narrationTone: 'whimsical', miracleIntensity: 0.3, language: 0,
  },
  family: {
    deathDepiction: 'euphemistic', violence: 0.25, darkThemes: false,
    narrationTone: 'whimsical', miracleIntensity: 0.45, language: 0.1,
  },
  teen: {
    deathDepiction: 'plain', violence: 0.6, darkThemes: true,
    narrationTone: 'neutral', miracleIntensity: 0.6, language: 0.4,
  },
  mature: {
    deathDepiction: 'graphic', violence: 1, darkThemes: true,
    narrationTone: 'grim', miracleIntensity: 1, language: 0.8,
  },
};

/**
 * What gets stored on `worldSeed.style`: the two preset choices plus a sparse
 * per-knob override bag. All optional — an absent config (or absent fields) means
 * "use defaults". Kept minimal & serialisable so it round-trips through saves.
 */
export interface WorldStyleConfig {
  /** Scale / "game factor" preset. Omitted → `natural` (defaults). */
  scalePreset?: ScalePreset;
  /** Content-rating preset. Omitted → defaults. */
  ratingPreset?: RatingPreset;
  /** Per-knob overrides applied LAST (win over both presets). */
  overrides?: Partial<WorldStyle>;
}

/**
 * Resolve a {@link WorldStyleConfig} to the flat {@link WorldStyle} record:
 * `defaults ⊕ scaleProfile ⊕ ratingProfile ⊕ overrides`. Pure; returns a fresh
 * object. A null/undefined config → a copy of {@link STYLE_DEFAULTS}.
 */
export function resolveWorldStyle(cfg?: WorldStyleConfig | null): WorldStyle {
  if (!cfg) return { ...STYLE_DEFAULTS };
  return {
    ...STYLE_DEFAULTS,
    ...(cfg.scalePreset ? SCALE_PROFILES[cfg.scalePreset] : null),
    ...(cfg.ratingPreset ? RATING_PROFILES[cfg.ratingPreset] : null),
    ...(cfg.overrides ?? null),
  };
}

/**
 * Convenience: resolve the style for a world seed (or any object carrying an
 * optional `style`). The single entry point consumers use — a world with no
 * `style` resolves to {@link STYLE_DEFAULTS}, so behaviour is unchanged.
 */
export function worldStyleOf(seed?: { style?: WorldStyleConfig } | null): WorldStyle {
  return resolveWorldStyle(seed?.style ?? null);
}
