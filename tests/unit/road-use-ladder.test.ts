// Road-wear economy S0 — the pure ladder functions (spec §3/§4 + §9 rulings).
// These are the EXACT functions the studio dials drive and the later sim slices wire to;
// this matrix pins the threshold/hysteresis/streak behaviour before anything consumes it.
import { describe, it, expect } from 'vitest';
import {
  ROAD_CLASS_LADDER, PROMOTE_USE, DEMOTE_USE, N_UP, N_DOWN,
  stepEdgeClass, type UseStreaks,
  tierForUse, CROSSING_LAG, RICH_CROSSING_MIN, CLASS_CROSSING_TIER,
  CROSSING_TIER_RECIPES, CROSSING_TIER_LABELS, CROSSING_EARN_USE,
  CROSSING_TIER_MAX_SPAN_T, tierSpans, minViableTier, type CrossingTier,
} from '@/world/road-use';
import { BRIDGE_RECIPES } from '@/blueprint/presets/bridges';
import type { RoadClass } from '@/world/road-graph';

const S0: UseStreaks = { up: 0, down: 0 };

/** Run `n` consecutive applies from (cls, streaks), returning the trajectory of classes. */
function run(cls: RoadClass, ema: number, n: number, lord = false, streaks: UseStreaks = S0): { cls: RoadClass; streaks: UseStreaks; classes: RoadClass[] } {
  const classes: RoadClass[] = [];
  let s = streaks;
  for (let i = 0; i < n; i++) {
    const r = stepEdgeClass(cls, ema, s, lord);
    cls = r.next; s = r.streaks;
    classes.push(cls);
  }
  return { cls, streaks: s, classes };
}

describe('stepEdgeClass — the class ladder (§3)', () => {
  it('thresholds have a real hysteresis gap on every rung', () => {
    for (const c of ['track', 'road', 'highway'] as const) {
      expect(PROMOTE_USE[c]).toBeGreaterThan(DEMOTE_USE[c]);
    }
    // The ladder itself is ordered promote-fast / demote-slow.
    expect(N_UP).toBe(2);
    expect(N_DOWN).toBe(4);
    expect(ROAD_CLASS_LADDER).toEqual(['path', 'track', 'road', 'highway']);
  });

  it('promotes after exactly N_UP consecutive qualifying applies', () => {
    const r1 = stepEdgeClass('path', PROMOTE_USE.track, S0);
    expect(r1.next).toBe('path');
    expect(r1.changed).toBe(false);
    expect(r1.streaks).toEqual({ up: 1, down: 0 });
    const r2 = stepEdgeClass('path', PROMOTE_USE.track, r1.streaks);
    expect(r2.next).toBe('track');
    expect(r2.changed).toBe(true);
    expect(r2.streaks).toEqual({ up: 0, down: 0 });   // streaks reset on transition
  });

  it('moves at most ONE rung per apply, even at saturating use', () => {
    const { classes } = run('path', 1.0, 6);
    // 2 applies per rung: path→(1)path→(2)track→(3)track→(4)road→(5)road→(6)highway? (lord-gated)
    expect(classes).toEqual(['path', 'track', 'track', 'road', 'road', 'road']);
    const withLord = run('path', 1.0, 6, true);
    expect(withLord.classes).toEqual(['path', 'track', 'track', 'road', 'road', 'highway']);
  });

  it('demotes after exactly N_DOWN consecutive applies below the demote threshold', () => {
    const { classes } = run('road', DEMOTE_USE.road - 0.01, N_DOWN);
    expect(classes.slice(0, N_DOWN - 1)).toEqual(['road', 'road', 'road']);
    expect(classes[N_DOWN - 1]).toBe('track');
  });

  it('a non-qualifying apply BREAKS the streak (consecutive, not lifetime)', () => {
    const r1 = stepEdgeClass('path', 0.9, S0);                     // up 1
    const gap = stepEdgeClass('path', 0.2, r1.streaks);            // dead band → reset
    expect(gap.streaks).toEqual({ up: 0, down: 0 });
    const r2 = stepEdgeClass('path', 0.9, gap.streaks);            // up 1 again, NOT promote
    expect(r2.next).toBe('path');
    expect(r2.changed).toBe(false);
    // Same for down: 3 lean years, one good year, 3 more lean years — still no demotion.
    let s = S0; let cls: RoadClass = 'road';
    for (let i = 0; i < 3; i++) ({ next: cls, streaks: s } = stepEdgeClass(cls, 0.1, s));
    ({ next: cls, streaks: s } = stepEdgeClass(cls, 0.4, s));      // in-band year breaks it
    for (let i = 0; i < 3; i++) ({ next: cls, streaks: s } = stepEdgeClass(cls, 0.1, s));
    expect(cls).toBe('road');
  });

  it('holds forever inside the hysteresis band — no flap at a boundary value', () => {
    // Freshly promoted to track at exactly the promote threshold: the SAME value neither
    // re-promotes (it is below PROMOTE_USE.road) nor demotes (it is above DEMOTE_USE.track).
    const { cls, streaks } = run('track', PROMOTE_USE.track, 10);
    expect(cls).toBe('track');
    expect(streaks).toEqual({ up: 0, down: 0 });
    // And just under the promote threshold from below: never promotes.
    expect(run('path', PROMOTE_USE.track - 1e-9, 10).cls).toBe('path');
    // Just AT the demote threshold: demotion needs strictly-below, so it holds.
    expect(run('track', DEMOTE_USE.track, 10).cls).toBe('track');
  });

  it('path is the floor and highway is the cap', () => {
    expect(run('path', 0, 20).cls).toBe('path');              // never demotes below path
    const top = run('highway', 1.0, 20, true);
    expect(top.cls).toBe('highway');                          // nothing above highway
    expect(top.streaks).toEqual({ up: 0, down: 0 });          // topped-out applies don't accrue
  });

  it('highway promotion is lord-gated: no seat ⇒ saturates at road, NO streak accrues', () => {
    // Sustained king's-highway use without a gripping lord seat: road forever.
    const noSeat = run('road', 0.95, 10, false);
    expect(noSeat.cls).toBe('road');
    expect(noSeat.streaks).toEqual({ up: 0, down: 0 });       // gate only — but no silent accrual
    // The seat arriving does NOT get credit for the ungated years: still needs N_UP applies.
    const r1 = stepEdgeClass('road', 0.95, noSeat.streaks, true);
    expect(r1.next).toBe('road');
    const r2 = stepEdgeClass('road', 0.95, r1.streaks, true);
    expect(r2.next).toBe('highway');
  });

  it('is pure: never mutates the streaks argument', () => {
    const s: UseStreaks = { up: 1, down: 2 };
    stepEdgeClass('track', 0.9, s);
    stepEdgeClass('track', 0.0, s);
    expect(s).toEqual({ up: 1, down: 2 });
  });

  it('clamps garbage ema input (NaN / out of range) instead of misbehaving', () => {
    expect(stepEdgeClass('road', Number.NaN, S0).next).toBe('road');
    expect(stepEdgeClass('road', Number.NaN, S0).streaks.down).toBe(1);  // NaN → 0 → lean year
    expect(stepEdgeClass('path', 99, { up: 1, down: 0 }).next).toBe('track');
    expect(stepEdgeClass('track', -5, { up: 0, down: 3 }).next).toBe('path');
  });
});

describe('tierForUse — the crossing-tier ladder (§4 + §10, LAG + wealth buyback)', () => {
  it('the built ladder has SEVEN rungs with the log at the bottom (§10 redirect)', () => {
    expect(CROSSING_TIER_RECIPES).toEqual(['log', 'twin-log', 'log-rail', 'plank-walk', 'timber-beam', 'timber-arch', 'stone-arch']);
    expect(CROSSING_TIER_LABELS).toHaveLength(7);
    // Drift guard: every tier's recipe key exists in the buildable bridge library.
    for (const key of CROSSING_TIER_RECIPES) expect(BRIDGE_RECIPES[key], key).toBeTruthy();
    // "No affordance" is NOT a tier — the ladder starts at the log; the trestle recipe still
    // exists (other consumers) but is no longer a rung.
    expect(CROSSING_TIER_RECIPES).not.toContain('timber-trestle');
    expect(BRIDGE_RECIPES['timber-trestle']).toBeTruthy();
  });

  it('EARN thresholds interpolate between the §3 promote points (documented anchors)', () => {
    // Anchors: the class-cap tiers sit exactly ON the class promote points.
    expect(CROSSING_EARN_USE[0]).toBe(0);
    expect(CROSSING_EARN_USE[3]).toBe(PROMOTE_USE.track);      // track cap = plank walk
    expect(CROSSING_EARN_USE[5]).toBe(PROMOTE_USE.road);       // road cap = timber arch
    expect(CROSSING_EARN_USE[6]).toBe(PROMOTE_USE.highway);    // highway cap = stone arch
    // In-between rungs subdivide the gaps evenly (tiers 1–2 in thirds, tier 4 halfway).
    expect(CROSSING_EARN_USE[1]).toBeCloseTo(PROMOTE_USE.track / 3, 9);
    expect(CROSSING_EARN_USE[2]).toBeCloseTo((2 * PROMOTE_USE.track) / 3, 9);
    expect(CROSSING_EARN_USE[4]).toBeCloseTo((PROMOTE_USE.track + PROMOTE_USE.road) / 2, 9);
    // Strictly increasing — every rung is individually earnable.
    for (let t = 1; t < CROSSING_EARN_USE.length; t++) {
      expect(CROSSING_EARN_USE[t]).toBeGreaterThan(CROSSING_EARN_USE[t - 1]);
    }
  });

  it('use walks EVERY rung one by one (rich highway: lag bought back, no cap in the way)', () => {
    for (let t = 0; t < CROSSING_EARN_USE.length; t++) {
      expect(tierForUse(CROSSING_EARN_USE[t], 'highway', 1)).toBe(t);
      if (t > 0) expect(tierForUse(CROSSING_EARN_USE[t] - 1e-9, 'highway', 1)).toBe(t - 1);
    }
  });

  it('LAG=1: the crossing sits one tier behind the class cap it has earned', () => {
    expect(CROSSING_LAG).toBe(1);
    // Saturating use, poor endpoints: tier = classCap − 1 on every class.
    expect(tierForUse(1, 'path', 0)).toBe(1);      // twin logs (cap 2 − lag)
    expect(tierForUse(1, 'track', 0)).toBe(2);     // log + rail (cap 3 − lag)
    expect(tierForUse(1, 'road', 0)).toBe(4);      // timber beam (cap 5 − lag)
    expect(tierForUse(1, 'highway', 0)).toBe(5);   // timber arch — stone needs wealth
  });

  it('wealth buyback: wealth ≥ RICH_CROSSING_MIN ⇒ LAG 0 (bridges ahead of traffic)', () => {
    expect(tierForUse(1, 'highway', RICH_CROSSING_MIN)).toBe(6);          // the grand stone arch
    expect(tierForUse(1, 'highway', RICH_CROSSING_MIN - 1e-9)).toBe(5);   // one coin short
    expect(tierForUse(1, 'path', 1)).toBe(2);      // a rich hamlet rails its logs
    // Wealth buys back the LAG, never a rung: a dead edge keeps its log however rich.
    expect(tierForUse(0, 'path', 1)).toBe(0);
  });

  it('use must EARN the rung: the class caps but does not grant', () => {
    // A highway whose traffic has collapsed: earned rung follows use, not the class label.
    expect(tierForUse(0.0, 'highway', 0)).toBe(0);
    expect(tierForUse(PROMOTE_USE.track, 'highway', 0)).toBe(2);
    expect(tierForUse(PROMOTE_USE.road, 'highway', 0)).toBe(4);
    expect(tierForUse(PROMOTE_USE.highway, 'highway', 0)).toBe(5);
    // And the actual class caps a use spike: heavy traffic on a mere track holds at its cap
    // minus the lag — the road must earn its class before the crossing can follow.
    expect(tierForUse(0.99, 'track', 0)).toBe(2);
    expect(tierForUse(0.99, 'track', 1)).toBe(3);   // rich: at the cap, never past it
  });

  it('floors at tier 0 and respects the class cap for any input', () => {
    expect(tierForUse(0, 'path', 0)).toBe(0);
    expect(tierForUse(-5, 'path', -5)).toBe(0);
    expect(tierForUse(99, 'highway', 99)).toBe(6);
    expect(tierForUse(Number.NaN, 'road', Number.NaN)).toBe(0);
    for (const cls of ROAD_CLASS_LADDER) {
      for (const u of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        for (const w of [0, 0.5, 1]) {
          const t = tierForUse(u, cls, w);
          expect(t).toBeGreaterThanOrEqual(0);
          expect(t).toBeLessThanOrEqual(CLASS_CROSSING_TIER[cls]);
        }
      }
    }
  });

  it('wealth never moves the tier by more than the lag it buys back', () => {
    for (const cls of ROAD_CLASS_LADDER) {
      for (const u of [0, 0.15, 0.3, 0.5, 0.7, 0.9, 1]) {
        expect(tierForUse(u, cls, 1) - tierForUse(u, cls, 0)).toBeLessThanOrEqual(CROSSING_LAG);
      }
    }
  });
});

describe('stream width vs structure — min viable tier (§10 "what happens at different streams?")', () => {
  it('a log spans ~2 tiles; bents walk wider; the widest water is high-tier only', () => {
    expect(CROSSING_TIER_MAX_SPAN_T).toHaveLength(CROSSING_TIER_RECIPES.length);
    expect(minViableTier(1)).toBe(0);        // a stride of water: the log does it
    expect(minViableTier(2)).toBe(0);
    expect(minViableTier(2.4)).toBe(2);      // past the single log: railed logs stretch a hair
    expect(minViableTier(3)).toBe(3);        // real width wants BENTS — the plank walk
    expect(minViableTier(6)).toBe(3);
    expect(minViableTier(8.5)).toBe(5);      // wider still: only the arches
    expect(minViableTier(12)).toBe(6);
    expect(minViableTier(15)).toBeNull();    // that's a ferry, not a bridge
  });

  it('tierSpans is honest about the beam: a plank walk out-spans a single sawn beam', () => {
    expect(tierSpans(3 as CrossingTier, 6)).toBe(true);    // bents multiply
    expect(tierSpans(4 as CrossingTier, 6)).toBe(false);   // one beam between footings does not
    for (let t = 0 as CrossingTier; t <= 6; t++) {
      expect(tierSpans(t as CrossingTier, 0.5)).toBe(true);   // everyone crosses a rill
    }
  });
});
