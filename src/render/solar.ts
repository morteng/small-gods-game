// src/render/solar.ts (moved from src/studio/solar.ts — now shared by the
// runtime day/night cycle, src/render/day-night.ts, AND the studio sun panel)
// A lightweight solar-position model so a sun can be driven by time of
// day + day of year (season) instead of raw azimuth/elevation. It's textbook
// horizontal-coordinate astronomy (declination + hour-angle → an East/North/Up
// sun vector) — good enough for art: believable sunrise→noon→sunset arcs and
// seasonal arc-height changes. Elevation additionally drives a golden-hour →
// noon → night colour/intensity ramp for the lit WebGL layer.
//
// Pure + Node-safe (no DOM); the only scene-specific choice is AZ_OFFSET, which
// rotates true azimuth into the iso sunDir convention so the sun visibly
// crosses the iso scene (tuned by eye, cardinal accuracy is irrelevant here).
import { normalizeVec3, type Vec3 } from '@/render/lighting-state';
import { clamp, lerp, smoothstep } from '@/core/math';
import { nightFactorForTick, tickAtSolarHour } from '@/core/calendar';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Rotates true compass azimuth into the studio's sunDir frame (0 = behind/top,
 *  90 = screen-left). Chosen by eye so dawn lights from one side, dusk the other. */
const AZ_OFFSET = -90;

export interface SolarAngles { az: number; el: number }   // degrees; el<0 ⇒ below horizon

/** Screen-space (normal-map frame: +x right, +y up, +z toward camera) light
 *  direction from az/el degrees in the AZ_OFFSET convention above (az 0 =
 *  behind/top, 90 = screen-left). Shared by the studio sun controls and any
 *  runtime consumer that wants the raw astronomical direction. */
export function sunDirFromAngles(az: number, el: number): Vec3 {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return normalizeVec3([-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]);
}

/** Sun azimuth/elevation for an hour (0..24), year fraction (0..1, 0 = spring
 *  equinox, 0.25 = summer solstice), and latitude (deg, N hemisphere). */
export function solarPosition(hour: number, yearFrac: number, latDeg: number): SolarAngles {
  const decl = 23.44 * Math.sin(2 * Math.PI * yearFrac);   // 0 at equinox, ±23.44 at solstices
  const H = (15 * (hour - 12)) * D2R;                       // hour angle (0 at solar noon)
  const phi = latDeg * D2R, dl = decl * D2R;
  const east = -Math.cos(dl) * Math.sin(H);
  const north = Math.sin(dl) * Math.cos(phi) - Math.cos(dl) * Math.sin(phi) * Math.cos(H);
  const up = Math.sin(dl) * Math.sin(phi) + Math.cos(dl) * Math.cos(phi) * Math.cos(H);
  const el = Math.asin(clamp(up, -1, 1)) * R2D;
  let azNorth = Math.atan2(east, north) * R2D;             // 0 = N, clockwise
  if (azNorth < 0) azNorth += 360;
  const az = (((azNorth + AZ_OFFSET) % 360) + 360) % 360;
  return { az, el };
}

/** Ambient + directional-sun colour for a given elevation — a warm low-sun
 *  golden hour, neutral-cool midday, dim blue night. Drives `LightingState`. */
export function solarLight(el: number): { ambient: Vec3; sunColor: Vec3 } {
  if (el <= 0) {
    // dusk → night over the first 6° below the horizon
    const t = clamp((el + 6) / 6, 0, 1);
    return {
      ambient: lerp3([0.13, 0.15, 0.24], [0.40, 0.34, 0.33], t),
      sunColor: lerp3([0.04, 0.05, 0.10], [0.58, 0.30, 0.15], t),
    };
  }
  const t = clamp(el / 55, 0, 1);                           // 0° golden → 55°+ neutral
  return {
    ambient: lerp3([0.44, 0.37, 0.35], [0.70, 0.70, 0.74], t),
    sunColor: lerp3([0.62, 0.32, 0.15], [0.42, 0.41, 0.38], t),
  };
}

/** A resolved sky light: which body is up, its direction, and the ambient + body
 *  colour to feed `LightingState`. By day this is the sun; once the sun sets it
 *  becomes the moon (cool, dim, scaled by illuminated fraction). */
export interface Celestial { az: number; el: number; ambient: Vec3; sunColor: Vec3; body: 'sun' | 'moon' }

/** Resolve the active sky light. `moonPhase` 0 = new (dark night) … 1 = full
 *  (bright, opposite the sun). The moon trails the sun by its elongation, so a
 *  full moon rises at sunset and rides highest at midnight. */
export function celestial(hour: number, yearFrac: number, latDeg: number, moonPhase: number): Celestial {
  const sun = solarPosition(hour, yearFrac, latDeg);
  if (sun.el > 0) {
    const { ambient, sunColor } = solarLight(sun.el);
    return { az: sun.az, el: sun.el, ambient, sunColor, body: 'sun' };
  }
  // Night: the moon stands at elongation 180°·phase behind the sun (full ⇒
  // anti-solar). Reuse the same arc solver shifted by 12h·phase.
  const moon = solarPosition(hour + 12 * moonPhase, yearFrac, latDeg);
  const illum = (1 - Math.cos(Math.PI * clamp(moonPhase, 0, 1))) / 2;   // lit fraction
  const lit = Math.max(0, illum) * clamp(moon.el / 45, 0, 1);           // also dim near/below horizon
  return {
    az: moon.az,
    el: moon.el > 0 ? moon.el : 0.01,                                   // keep a valid dir; colour ≈0 when down
    ambient: lerp3([0.07, 0.08, 0.13], [0.16, 0.19, 0.30], lit),
    sunColor: lerp3([0.02, 0.03, 0.06], [0.17, 0.21, 0.36], lit),
    body: 'moon',
  };
}

/** Studio equivalent of `nightFactorForTick` (the shader `uNight` — lit window
 *  panes) for the two ways the studio can drive the sun. In solar mode this
 *  IS the runtime authority (solar hour → tick → `nightFactorForTick`), so a
 *  studio subject glows on the same schedule a live building would. In manual
 *  az/el mode there's no tick to read, so the ramp is derived from elevation
 *  with the SAME shape `day-night.ts` uses for its ambient/sunColor day-ness
 *  term (`smoothstep(-5, 25, el)`) — 0 well below the horizon, 1 well above —
 *  so dragging the elevation slider down also lights windows, mirroring what
 *  the runtime curve would do at that sun height. Pure, cheap, frame-safe. */
export function studioNightFactor(sunMode: 'solar' | 'manual', hour: number, el: number): number {
  if (sunMode === 'solar') return nightFactorForTick(tickAtSolarHour(hour));
  return 1 - smoothstep(-5, 25, el);
}

const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
/** "summer 7/24" — season name + day within the season (24 days/season). */
export function seasonLabel(yearFrac: number): string {
  const f = ((yearFrac % 1) + 1) % 1;
  const season = SEASONS[Math.min(3, Math.floor(f * 4))];
  const dayInSeason = Math.floor(((f * 4) % 1) * 24) + 1;
  return `${season} ${dayInSeason}/24`;
}

/** "06:30" — hour-of-day as a 24h clock. */
export function clockLabel(hour: number): string {
  const hh = Math.floor(hour) % 24;
  const mm = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
