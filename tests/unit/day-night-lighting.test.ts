// Day/night lighting (WP-E): the runtime LightingState derived from the sim
// clock — the exact DEFAULT_LIGHTING look at full day, a clamped readable night,
// warm dusk/dawn, a pinned shadow direction, and per-step memoization.
import { describe, it, expect } from 'vitest';
import {
  computeDayNightLighting, dayNightLightingForTick,
  NIGHT_AMBIENT, LIGHT_STEP_TICKS,
} from '@/render/day-night';
import { DEFAULT_LIGHTING, DEFAULT_SUN_DIR, type Vec3 } from '@/render/lighting-state';
import { tickAtSolarHour, TICKS_PER_SOLAR_DAY } from '@/core/calendar';

const lum = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

describe('day-night lighting derivation', () => {
  const noon = computeDayNightLighting(tickAtSolarHour(12));
  const midnight = computeDayNightLighting(tickAtSolarHour(0));
  const dusk = computeDayNightLighting(tickAtSolarHour(18));

  it('full day is EXACTLY the shipped default look', () => {
    expect(noon.ambient).toEqual(DEFAULT_LIGHTING.ambient);
    expect(noon.sunColor).toEqual(DEFAULT_LIGHTING.sunColor);
    expect(noon.sunDir).toEqual(DEFAULT_SUN_DIR);
    expect(noon.bands).toBe(DEFAULT_LIGHTING.bands);
    expect(noon.enabled).toBe(true);
    expect(noon.nightFactor).toBeCloseTo(0, 6); // zero window glow at noon
  });

  it('midnight sits ON the readability clamp floor — dim but playable', () => {
    expect(midnight.ambient).toEqual(NIGHT_AMBIENT);
    expect(midnight.nightFactor).toBeCloseTo(1, 6); // full window glow
    // ≥60% of the day ambient luminance — stylized night, not darkness.
    expect(lum(midnight.ambient) / lum(noon.ambient)).toBeGreaterThan(0.6);
    // Cool cast: blue channel dominates at night.
    expect(midnight.ambient[2]).toBeGreaterThan(midnight.ambient[0]);
    // Moon still carries some directional form.
    expect(lum(midnight.sunColor)).toBeGreaterThan(0.15);
  });

  it('dusk is warmer than noon (colour-temperature shift)', () => {
    const warmth = (c: Vec3): number => c[0] / c[2]; // r/b ratio
    expect(warmth(dusk.sunColor)).toBeGreaterThan(warmth(noon.sunColor));
    expect(warmth(dusk.ambient)).toBeGreaterThan(warmth(noon.ambient));
    // Dusk sits between day and night brightness.
    expect(lum(dusk.ambient)).toBeLessThan(lum(noon.ambient));
    expect(lum(dusk.ambient)).toBeGreaterThanOrEqual(lum(midnight.ambient) - 1e-9);
    // Lamps are coming on.
    expect(dusk.nightFactor!).toBeGreaterThan(0.1);
  });

  it('the sun direction sweeps through the day but never inverts the relight', () => {
    const dawnDir = computeDayNightLighting(tickAtSolarHour(7)).sunDir;
    const duskDir = dusk.sunDir;
    expect(dawnDir[0]).toBeGreaterThan(0);        // morning light from screen-right
    expect(duskDir[0]).toBeLessThan(0);           // evening light from screen-left
    expect(dawnDir).not.toEqual(duskDir);
    for (let h = 0; h < 24; h += 0.5) {
      const d = computeDayNightLighting(tickAtSolarHour(h)).sunDir;
      expect(len(d)).toBeCloseTo(1, 5);           // normalized
      expect(d[1]).toBeGreaterThan(0.2);          // always from above
      expect(d[2]).toBeGreaterThan(0.3);          // always toward the camera
    }
  });

  it('cast shadows stay pinned to the canonical sun at every hour', () => {
    for (let h = 0; h < 24; h += 3) {
      expect(computeDayNightLighting(tickAtSolarHour(h)).shadowDir).toEqual(DEFAULT_SUN_DIR);
    }
  });

  it('is deterministic and periodic: same tick → same lighting', () => {
    const t = tickAtSolarHour(15) + 7;
    expect(computeDayNightLighting(t)).toEqual(computeDayNightLighting(t));
    expect(computeDayNightLighting(t + TICKS_PER_SOLAR_DAY)).toEqual(computeDayNightLighting(t));
  });

  it('memoizes per lighting step — same object within a step (hot-path, no churn)', () => {
    const base = 10 * LIGHT_STEP_TICKS;
    const a = dayNightLightingForTick(base);
    const b = dayNightLightingForTick(base + LIGHT_STEP_TICKS - 1);
    expect(b).toBe(a); // identity: zero per-frame allocation within a step
    const c = dayNightLightingForTick(base + LIGHT_STEP_TICKS);
    expect(c).not.toBe(a);
    // Scrub-safe: jumping BACK recomputes for the earlier tick.
    expect(dayNightLightingForTick(base)).toEqual(a);
  });

  it('ambient never falls below the night floor across the whole day', () => {
    for (let t = 0; t < TICKS_PER_SOLAR_DAY; t += 199) {
      const l = computeDayNightLighting(t);
      expect(lum(l.ambient)).toBeGreaterThanOrEqual(lum(NIGHT_AMBIENT) - 1e-9);
    }
  });
});
