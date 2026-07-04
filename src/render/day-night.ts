// src/render/day-night.ts
//
// Runtime day/night lighting — the single authority mapping the sim clock onto
// the banded-lighting `LightingState` every frame. Pure function of the tick
// (deterministic, scrub-safe: `clock.setNow` moves the sun), quantized into
// LIGHT_STEP_TICKS steps and memoized so the hot render path allocates nothing
// while the step is unchanged.
//
// Design (the day curve):
//  - The VISUAL solar day spans SOLAR_DAY_CALENDAR_DAYS calendar days (~4 real
//    minutes at rate 1) — see the rationale in `src/core/calendar.ts`.
//  - The solar model (`render/solar.ts`, lat 45°, fixed equinox — the 96-day
//    calendar YEAR is shorter than one visual solar day, so seasonal declination
//    would sweep nonsense within a single day) gives the sun's ELEVATION, which
//    drives the colour ramp: cool clamped night → warm dawn → the exact shipped
//    DEFAULT_LIGHTING at full day → golden dusk → night.
//  - READABILITY CLAMP: NIGHT_AMBIENT/NIGHT_SUN are the floor (~68% of the day
//    ambient luminance, moon-blue) — the game stays fully playable at midnight;
//    stylized god-game night, not simulation darkness.
//  - DIRECTION: the true az/el→screen mapping puts noon light edge-on (z = 0)
//    and dusk light BEHIND the scene (z < 0), which blacks out the camera-facing
//    sprite faces the normal maps were baked for. So the shading direction sweeps
//    an AUTHORED screen-space arc (dawn from screen-right, the canonical
//    upper-left sun at noon, low screen-left at dusk), parameterized by the solar
//    hour; it always keeps y/z positive so the banded relight never inverts.
//  - SHADOWS stay pinned to the canonical sun via `shadowDir` (geometry-mode
//    shadows are pre-baked at gen time and can't move; a moving direction would
//    also re-bake the L2 static shadow bundle every step).
//  - `nightFactor` (shader uNight — lit window panes) comes from
//    `nightFactorForTick`, the same solar-day authority.

import {
  DEFAULT_LIGHTING, DEFAULT_SUN_DIR, normalizeVec3,
  type LightingState, type Vec3,
} from './lighting-state';
import { nightFactorForTick, solarHourForTick } from '@/core/calendar';
import { solarPosition } from './solar';
import { smoothstep, lerp } from '@/core/math';

/** Lighting recomputes once per this many ticks (0.5 s at rate 1 — ~480 steps
 *  per visual day). Uniform-only cost; nothing rebakes on a step change. */
export const LIGHT_STEP_TICKS = 30;

const LAT_DEG = 45;
const YEAR_FRAC = 0; // fixed equinox (see header)

/** Night floor — the readability clamp. Never darker than this. */
export const NIGHT_AMBIENT: Vec3 = [0.35, 0.37, 0.49];
/** Moonlight directional colour (keeps terrain/sprite form legible at night). */
export const NIGHT_SUN: Vec3 = [0.22, 0.24, 0.34];
const DUSK_AMBIENT: Vec3 = [0.52, 0.46, 0.44];
const DUSK_SUN: Vec3 = [0.72, 0.44, 0.24];

/** Authored screen-space sun arc (see DIRECTION note in the header). */
const DAWN_DIR: Vec3 = normalizeVec3([0.45, 0.30, 0.68]);
const NOON_DIR: Vec3 = DEFAULT_SUN_DIR;
const DUSK_DIR: Vec3 = normalizeVec3([-0.85, 0.28, 0.44]);

/** Component lerp with EXACT endpoints (t≤0 → `a`, t≥1 → `b`, by reference) so
 *  full day reproduces DEFAULT_LIGHTING byte-identically — no float drift. */
function mix3(a: Vec3, b: Vec3, t: number): Vec3 {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Normalized arc segment between two pre-normalized endpoints (exact at ends). */
function arc(a: Vec3, b: Vec3, t: number): Vec3 {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return normalizeVec3(mix3(a, b, t));
}

/** Shading direction at solar hour `h` — the authored dawn→noon→dusk arc, eased
 *  back dusk→dawn through the night (dim then, so the sweep is invisible). */
function sunDirAtHour(h: number): Vec3 {
  if (h >= 6 && h < 12) return arc(DAWN_DIR, NOON_DIR, (h - 6) / 6);
  if (h >= 12 && h < 18) return arc(NOON_DIR, DUSK_DIR, (h - 12) / 6);
  return arc(DUSK_DIR, DAWN_DIR, h >= 18 ? (h - 18) / 12 : (h + 6) / 12);
}

/** Pure day/night lighting at `tick` — exported for tests; the game path goes
 *  through the memoized `dayNightLightingForTick`. At full day this is exactly
 *  the shipped DEFAULT_LIGHTING look (ambient/sunColor byte-identical). */
export function computeDayNightLighting(tick: number): LightingState {
  const h = solarHourForTick(tick);
  const { el } = solarPosition(h, YEAR_FRAC, LAT_DEG);
  // dayness: 0 night → 1 full day (reaches 1 well before the noon el of 45°).
  const day = smoothstep(-5, 25, el);
  // golden-hour bell around the horizon (dawn + dusk warm-up/warm-down).
  const golden = smoothstep(-8, 2, el) * (1 - smoothstep(4, 22, el));
  const ambient = mix3(mix3(NIGHT_AMBIENT, DEFAULT_LIGHTING.ambient, day), DUSK_AMBIENT, golden * 0.7);
  const sunColor = mix3(mix3(NIGHT_SUN, DEFAULT_LIGHTING.sunColor, day), DUSK_SUN, golden * 0.8);
  return {
    ...DEFAULT_LIGHTING,
    ambient,
    sunColor,
    sunDir: sunDirAtHour(h),
    shadowDir: DEFAULT_SUN_DIR, // shadows pinned (see header)
    nightFactor: nightFactorForTick(tick),
  };
}

let lastStep = Number.NaN;
let lastState: LightingState = DEFAULT_LIGHTING;

/** Memoized per LIGHT_STEP_TICKS: the render path calls this every frame and
 *  gets the SAME object (zero allocation) until the clock crosses a step. */
export function dayNightLightingForTick(tick: number): LightingState {
  const step = Math.floor(tick / LIGHT_STEP_TICKS);
  if (step !== lastStep) {
    lastStep = step;
    lastState = computeDayNightLighting(step * LIGHT_STEP_TICKS);
  }
  return lastState;
}
