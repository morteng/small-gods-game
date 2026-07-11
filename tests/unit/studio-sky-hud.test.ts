import { describe, it, expect } from 'vitest';
import {
  compassBearings, celestialPlot, scrubFraction, scrubHour, DAY_GRADIENT, dayGradientCss,
  effectiveLightAz, angleDelta,
} from '@/studio/sky-hud';
import { worldToScreen } from '@/render/iso/iso-projection';
import { clockLabel } from '@/render/solar';

// Expected screen bearing for a world tile-space direction, derived through the REAL iso
// projection (not a hardcoded magic angle) — this is the contract the rose must satisfy.
const bearingOf = (dx: number, dy: number): number => {
  const p = worldToScreen(dx, dy, 0, 0, 0);
  return Math.atan2(p.sy, p.sx);
};
const find = (bs: ReturnType<typeof compassBearings>, l: string) => bs.find((b) => b.label === l)!;

const PI2 = Math.PI / 2;

describe('sky-hud compass bearings', () => {
  it('(a) yaw=0 labels match the iso projection south / west screen directions', () => {
    const b = compassBearings(0);
    // world compass → tile axes: south = +y, west = -x, north = -y, east = +x
    expect(find(b, 'S').angleRad).toBeCloseTo(bearingOf(0, 1), 6);
    expect(find(b, 'W').angleRad).toBeCloseTo(bearingOf(-1, 0), 6);
    expect(find(b, 'N').angleRad).toBeCloseTo(bearingOf(0, -1), 6);
    expect(find(b, 'E').angleRad).toBeCloseTo(bearingOf(1, 0), 6);
    // (sx,sy) is a unit direction
    expect(Math.hypot(find(b, 'S').sx, find(b, 'S').sy)).toBeCloseTo(1, 6);
  });

  it('(b) bearings counter-rotate with yaw — a +90° orbit turns the model south face to where west projected', () => {
    const b0 = compassBearings(0);
    const b90 = compassBearings(PI2);
    // The model composes at +yaw; its south face at yaw=90° points where WORLD-west was at yaw 0.
    expect(find(b90, 'S').angleRad).toBeCloseTo(find(b0, 'W').angleRad, 6);
    expect(find(b90, 'E').angleRad).toBeCloseTo(find(b0, 'S').angleRad, 6);
    // and it actually moved (not a no-op)
    expect(find(b90, 'S').angleRad).not.toBeCloseTo(find(b0, 'S').angleRad, 3);
    // a full turn returns to the start
    const b360 = compassBearings(Math.PI * 2);
    expect(find(b360, 'S').angleRad).toBeCloseTo(find(b0, 'S').angleRad, 6);
  });
});

describe('sky-hud celestial plot', () => {
  it('(c) az=180 (due south) plots on the S bearing; elevation is distance from centre', () => {
    const s = celestialPlot(180, 0, 0);
    const bS = find(compassBearings(0), 'S');
    expect(s.angleRad).toBeCloseTo(bS.angleRad, 6);          // az 180 → S bearing
    expect(Math.atan2(s.y, s.x)).toBeCloseTo(bS.angleRad, 6); // offset points the same way
    expect(s.radius).toBeCloseTo(1, 6);                       // el 0° → rim
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(1, 6);

    const zenith = celestialPlot(180, 90, 0);
    expect(zenith.radius).toBeCloseTo(0, 6);                  // el 90° → centre
    expect(Math.hypot(zenith.x, zenith.y)).toBeCloseTo(0, 6);

    const half = celestialPlot(0, 45, 0);                     // az 0 = north
    expect(half.radius).toBeCloseTo(0.5, 6);
    expect(half.angleRad).toBeCloseTo(find(compassBearings(0), 'N').angleRad, 6);

    const east = celestialPlot(90, 0, 0);
    expect(east.angleRad).toBeCloseTo(find(compassBearings(0), 'E').angleRad, 6);
  });

  it('az=180 stays on the S bearing after a turntable orbit (folds yaw like the labels)', () => {
    const s = celestialPlot(180, 30, PI2);
    const bS = find(compassBearings(PI2), 'S');
    expect(s.angleRad).toBeCloseTo(bS.angleRad, 6);
  });
});

describe('sky-hud world-anchored sun (effectiveLightAz)', () => {
  const R2D = 180 / Math.PI;

  it('folding yaw into the azimuth is identical to celestialPlot folding it into the rose', () => {
    // The studio lights the sprite at effectiveLightAz(az, yaw) and plots the dot at
    // celestialPlot(az, ·, yaw); the two must resolve to the SAME screen bearing at every
    // yaw, else the sun dot and the cast shadow drift apart as you orbit.
    for (const az of [0, 90, 180, 270, 37]) {
      for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI / 4, -1.3]) {
        const folded = celestialPlot(az, 30, yaw);          // dot: yaw folded by the rotor
        const shifted = celestialPlot(effectiveLightAz(az, yaw), 30, 0);  // light: yaw folded into az
        expect(shifted.angleRad).toBeCloseTo(folded.angleRad, 6);
        expect(shifted.x).toBeCloseTo(folded.x, 6);
        expect(shifted.y).toBeCloseTo(folded.y, 6);
      }
    }
  });

  it('a due-south world sun lights the model south face at every yaw', () => {
    // az 180 (world S) must land on the model S bearing for any orbit — the light az the
    // studio feeds sunDirFromAngles (effectiveLightAz) reproduces exactly that bearing.
    for (const yaw of [0, Math.PI / 2, Math.PI, 1.1]) {
      const bS = find(compassBearings(yaw), 'S');
      const lit = celestialPlot(effectiveLightAz(180, yaw), 20, 0);
      expect(lit.angleRad).toBeCloseTo(bS.angleRad, 6);
    }
  });

  it('yaw 0 is a no-op and the fold is offset-invariant (works on studio az too)', () => {
    expect(effectiveLightAz(90, 0)).toBeCloseTo(90, 6);
    expect(effectiveLightAz(350, Math.PI / 2)).toBeCloseTo((350 + 90) % 360, 6);
    // AZ_OFFSET-shifted studio az and true az fold by the same +yaw degrees, so the
    // difference between two azimuths is preserved by the fold (offset-invariant).
    const yaw = Math.PI / 3;
    expect(((effectiveLightAz(90, yaw) - effectiveLightAz(180, yaw)) % 360 + 360) % 360)
      .toBeCloseTo(((90 - 180) % 360 + 360) % 360, 6);
    // adding a full turn of yaw returns the same azimuth
    expect(effectiveLightAz(45, Math.PI * 2)).toBeCloseTo(45, 6);
    // the shift magnitude is exactly the yaw in degrees
    expect(effectiveLightAz(0, 1)).toBeCloseTo((R2D) % 360, 6);
  });
});

describe('sky-hud rose-drag angle (angleDelta)', () => {
  it('returns the signed shortest delta and crosses the ±π seam cleanly', () => {
    expect(angleDelta(0, 1)).toBeCloseTo(1, 9);
    expect(angleDelta(1, 0)).toBeCloseTo(-1, 9);
    // seam: 170° → −170° is a +20° step, not −340°
    const d = angleDelta((170 * Math.PI) / 180, (-170 * Math.PI) / 180);
    expect((d * 180) / Math.PI).toBeCloseTo(20, 6);
    // accumulating deltas around a full turn sums to ~2π with no jumps
    let acc = 0, prev = 0;
    for (let i = 1; i <= 360; i++) { const a = (i * Math.PI) / 180; acc += angleDelta(prev, a); prev = a; }
    expect(acc).toBeCloseTo(Math.PI * 2, 6);
  });
});

describe('sky-hud scrub helpers', () => {
  it('(d) scrubFraction edge cases (0, 12, 24) + clamps', () => {
    expect(scrubFraction(0)).toBe(0);
    expect(scrubFraction(12)).toBeCloseTo(0.5, 6);
    expect(scrubFraction(24)).toBe(1);
    expect(scrubFraction(-5)).toBe(0);   // clamp below the day
    expect(scrubFraction(30)).toBe(1);   // clamp above the day
    expect(scrubHour(scrubFraction(15.5))).toBeCloseTo(15.5, 6);  // round-trips
  });

  it('clockLabel edge cases (0, 12, 24)', () => {
    expect(clockLabel(0)).toBe('00:00');
    expect(clockLabel(12)).toBe('12:00');
    expect(clockLabel(24)).toBe('00:00');   // wraps to midnight
  });

  it('the day-cycle gradient is monotonic across the full 0..1 track', () => {
    const ats = DAY_GRADIENT.map((s) => s.at);
    expect(ats[0]).toBe(0);
    expect(ats[ats.length - 1]).toBe(1);
    for (let i = 1; i < ats.length; i++) expect(ats[i]).toBeGreaterThanOrEqual(ats[i - 1]);
    const css = dayGradientCss();
    expect(css).toContain('linear-gradient(90deg');
    expect(css).toContain('0.0%');
    expect(css).toContain('100.0%');
  });
});
