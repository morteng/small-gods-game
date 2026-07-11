// src/studio/sky-hud.ts
// Pure bearing + scrub math for the studio's sky HUD (the compass rose in drawHud and
// the time-of-day scrubber), factored out of studio.ts so it is unit-testable without
// a DOM or a canvas.
//
// WHY its own module: the compass folds TWO transforms at once — the turntable yaw the
// geometry is COMPOSED at, and the iso projection — and the sun/moon marker must stay
// consistent with the cardinal labels through both. That is exactly the kind of geometry
// a render catches but plain assertions miss, so it gets its own pinned tests.
//
// FRAME CONVENTIONS (every screen angle is DERIVED from worldToScreen, never hardcoded):
//  · World compass → tile axes — matches blueprint FACE_VEC + wall-geometry:
//      north = -y, south = +y, east = +x, west = -x   (tile x = east, y = south).
//  · Turntable yaw folds as the SAME rotor compose.ts bakes into the geometry
//      (makeYawRotor): a point/vector (x,y) → (x·cosθ − y·sinθ, x·sinθ + y·cosθ), i.e.
//      standard CCW in tile space. So composing at yaw = 90° turns the canonical-south
//      door to face west (toolbar Face "W", orientation 1) — the rose therefore tracks
//      the model's faces AS DISPLAYED, and the S label sits on the model's south face.
//  · Screen projection is the REAL iso map (worldToScreen); screen-y points DOWN, so a
//      returned angleRad is atan2(screenDy, screenDx) and a label draws at
//      (cx + cos·R, cy + sin·R) with no y-flip.
//  · The sky body plots in the SAME model frame (folds yaw identically), so a due-south
//      sun (TRUE azimuth 180°) always lands on the S label, at every yaw. Elevation is the
//      radius: el = 90° (zenith) → centre, el = 0° (horizon) → rim.
import { worldToScreen } from '@/render/iso/iso-projection';

export type Cardinal = 'N' | 'E' | 'S' | 'W';

/** World compass directions as tile-space unit vectors (x = east, y = south). */
const CARDINAL_VEC: Record<Cardinal, [number, number]> = {
  N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0],
};
const CARDINALS: Cardinal[] = ['N', 'E', 'S', 'W'];

/** Rotate a tile-space vector by the turntable yaw (radians, CCW) — the SAME rotor
 *  compose.ts applies to the facets, so screen bearings track the composed model. */
function rotYaw([x, y]: [number, number], yaw: number): [number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x * c - y * s, x * s + y * c];
}

/** Project a tile-space DIRECTION to a screen-space direction through the real iso
 *  projection. worldToScreen is linear and worldToScreen(0,0,…) = (0,0), so the image
 *  of a delta from the origin IS the projected direction. Screen-y points down. */
function projectDir([dx, dy]: [number, number]): { sx: number; sy: number } {
  const p = worldToScreen(dx, dy, 0, 0, 0);
  return { sx: p.sx, sy: p.sy };
}

export interface Bearing { label: Cardinal; angleRad: number; sx: number; sy: number }

/** Screen bearings for the four world-compass labels at the given turntable yaw.
 *  `angleRad` is atan2(screenDy, screenDx) in canvas space (y-down); (sx,sy) is the
 *  unit-normalised screen direction so a label sits at (cx + sx·R, cy + sy·R). */
export function compassBearings(yaw: number): Bearing[] {
  return CARDINALS.map((label) => {
    const { sx, sy } = projectDir(rotYaw(CARDINAL_VEC[label], yaw));
    const len = Math.hypot(sx, sy) || 1;
    return { label, angleRad: Math.atan2(sy, sx), sx: sx / len, sy: sy / len };
  });
}

export interface SkyPlot { x: number; y: number; radius: number; angleRad: number }

/** Plot a sky body (sun by day / moon by night) on the rose. `azDeg` is a TRUE compass
 *  azimuth (0 = N, 90 = E, 180 = S, 270 = W); `elDeg` its elevation. Folds the turntable
 *  yaw exactly like the labels, so az = 180 always lands on the S bearing. Returns a
 *  unit-rose offset (x,y in [-1,1], y-down) ALREADY scaled by the elevation radius
 *  (el 90° → 0 at centre … el 0° → 1 at rim); multiply by the ring radius R to draw. */
export function celestialPlot(azDeg: number, elDeg: number, yaw = 0): SkyPlot {
  const az = (azDeg * Math.PI) / 180;
  // True compass azimuth → tile vector: 0=N[0,-1], 90=E[1,0], 180=S[0,1], 270=W[-1,0].
  const tile: [number, number] = [Math.sin(az), -Math.cos(az)];
  const { sx, sy } = projectDir(rotYaw(tile, yaw));
  const len = Math.hypot(sx, sy) || 1;
  const radius = 1 - Math.min(90, Math.max(0, elDeg)) / 90;
  return { x: (sx / len) * radius, y: (sy / len) * radius, radius, angleRad: Math.atan2(sy, sx) };
}

/** Fold the turntable yaw into a compass azimuth — the WORLD-anchored sun.
 *  celestialPlot folds yaw by rotating the sky body's tile vector `rotYaw(tile(az), yaw)`,
 *  and that rotation is *exactly* an azimuth shift: rotYaw([sin az, −cos az], θ) =
 *  [sin(az+θ), −cos(az+θ)] = tile(az+θ). So anchoring the studio sun to the world (so the
 *  rose dot and the cast shadow stay locked as you orbit) is just adding the yaw, in
 *  degrees, to the azimuth. Pure addition ⇒ offset-invariant: feed it a TRUE compass
 *  azimuth or the studio's AZ_OFFSET-shifted `az` and the +yaw fold is identical, so the
 *  light (via sunDirFromAngles) tracks the dot (via celestialPlot) at every yaw.
 *  Returns a normalised 0..360 azimuth. */
export function effectiveLightAz(azDeg: number, yaw: number): number {
  const a = azDeg + (yaw * 180) / Math.PI;
  return ((a % 360) + 360) % 360;
}

/** Signed shortest angular delta a→b in (−π, π]. Accumulates a rose-drag orbit smoothly
 *  across the atan2 ±π seam (spin the dial past due-north without a 2π jolt). */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

// ── time-scrubber helpers ─────────────────────────────────────────────────────
/** Fraction 0..1 along a 24h scrub track for an hour-of-day (clamped to the day). */
export function scrubFraction(hour: number): number {
  return Math.min(24, Math.max(0, hour)) / 24;
}
/** Inverse: a track fraction (0..1) back to an hour-of-day (0..24). */
export function scrubHour(frac: number): number {
  return Math.min(1, Math.max(0, frac)) * 24;
}

/** Day-cycle gradient stops (deep night → dawn orange → pale noon → dusk → night), keyed
 *  by track fraction. Drives the scrub-track background; kept here (pure, monotonic in
 *  `at`, spanning 0..1) so its shape is testable without the DOM. */
export const DAY_GRADIENT: { at: number; color: string }[] = [
  { at: 0.00, color: '#0b1030' },  // 00:00 deep night
  { at: 0.22, color: '#16224e' },  // ~05:20 pre-dawn
  { at: 0.29, color: '#c8632e' },  // ~07:00 dawn orange
  { at: 0.50, color: '#cdd6e6' },  // 12:00 pale noon
  { at: 0.71, color: '#c8632e' },  // ~17:00 dusk orange
  { at: 0.78, color: '#16224e' },  // ~18:40 twilight
  { at: 1.00, color: '#0b1030' },  // 24:00 deep night
];

/** The day-cycle gradient as a CSS `linear-gradient(90deg, …)` for the scrub track. */
export function dayGradientCss(): string {
  const stops = DAY_GRADIENT.map((s) => `${s.color} ${(s.at * 100).toFixed(1)}%`).join(', ');
  return `linear-gradient(90deg, ${stops})`;
}
