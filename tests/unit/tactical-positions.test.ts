import { describe, it, expect } from 'vitest';
import {
  walkZOf, stairPlacementOf, wallStations, arcLengthPoint,
} from '@/world/tactical-positions';
import { BARRIER_DEFAULTS, type BarrierRun, type BarrierGate } from '@/world/barrier';
import { MASONRY_MIN_CREST, parapetHeight } from '@/assetgen/geometry/battlement';
// A TEST may import render (only `src/sim/` may not) — the parity pin below asserts the leaf's
// stair placement against what the render source actually composes.
import { runElements } from '@/render/parametric-barrier-source';

const wall = (path: [number, number][], gates: BarrierGate[] = []): BarrierRun =>
  ({ kind: 'wall', path, ...BARRIER_DEFAULTS.wall, gates });

const RING: [number, number][] = [[0, 0], [14, 0], [14, 10], [0, 10], [0, 0]];
const CENTROID: [number, number] = [7, 5];
const crenRing = (gates: BarrierGate[] = []): BarrierRun =>
  ({ kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone', crenellated: true, centroid: CENTROID, gates });

describe('walkZOf', () => {
  it('matches height − parapetHeight(height) exactly for a crenellated run', () => {
    const run = crenRing();
    expect(walkZOf(run)).toBeCloseTo(run.height - parapetHeight(run.height), 12);
  });

  it('floors a stub run at the crest the stones are actually BUILT to', () => {
    // The curtain geometry floors a masonry run at MASONRY_MIN_CREST, so a run authored shorter
    // than that is drawn taller than it asked for. Taking the raw height here would put the sim's
    // walk (and its stations, and the stair's top step) below the stones the renderer draws.
    const stub: BarrierRun = { ...crenRing(), height: MASONRY_MIN_CREST / 4 };
    expect(walkZOf(stub)).toBeCloseTo(MASONRY_MIN_CREST - parapetHeight(MASONRY_MIN_CREST), 12);
    expect(walkZOf(stub)).toBeGreaterThan(stub.height);
  });

  it('is 0 for an uncrenellated run (nothing to garrison — no protected walk)', () => {
    const run: BarrierRun = { kind: 'wall', path: RING, height: 3, thickness: 1, material: 'stone', crenellated: false, centroid: CENTROID, gates: [] };
    expect(walkZOf(run)).toBe(0);
  });
});

describe('stairPlacementOf — parity with the render source', () => {
  it('returns exactly the point/dir/inward the rendered stair element is composed at', () => {
    const ring = crenRing([{ t: 7, width: 3 }]);
    const placement = stairPlacementOf(ring);
    expect(placement).not.toBeNull();
    const stairEl = runElements(ring).find((e) => e.key.startsWith('stair:'));
    expect(stairEl).toBeDefined();
    expect(stairEl!.refX).toBeCloseTo(placement!.foot[0], 9);
    expect(stairEl!.refY).toBeCloseTo(placement!.foot[1], 9);
    expect(placement!.walkZ).toBeCloseTo(ring.height - parapetHeight(ring.height), 12);
  });

  it('is null on a gateless ring (nothing to key the flight to)', () => {
    expect(stairPlacementOf(crenRing())).toBeNull();
  });

  it('is null without a ring centroid (open run / unknown inside)', () => {
    const noCentroid: BarrierRun = { kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone', crenellated: true, gates: [{ t: 7, width: 3 }] };
    expect(stairPlacementOf(noCentroid)).toBeNull();
  });

  it('is null on an uncrenellated run', () => {
    const flat: BarrierRun = { kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone', crenellated: false, centroid: CENTROID, gates: [{ t: 7, width: 3 }] };
    expect(stairPlacementOf(flat)).toBeNull();
  });
});

describe('wallStations', () => {
  it('is deterministic (same run in ⇒ same stations out)', () => {
    const ring = crenRing([{ t: 7, width: 3 }]);
    expect(wallStations(ring)).toEqual(wallStations(ring));
  });

  it('tags every station with the `wall_station` discriminant (the open TacticalPosition union)', () => {
    const stations = wallStations(crenRing());
    expect(stations.length).toBeGreaterThan(0);
    for (const s of stations) expect(s.kind).toBe('wall_station');
  });

  it('is ordered along the path — segIdx never decreases', () => {
    const stations = wallStations(crenRing());
    expect(stations.length).toBeGreaterThan(0);
    for (let i = 1; i < stations.length; i++) {
      expect(stations[i].segIdx).toBeGreaterThanOrEqual(stations[i - 1].segIdx);
    }
  });

  it('every outward vector points AWAY from the ring centroid', () => {
    const [cx, cy] = CENTROID;
    for (const s of wallStations(crenRing())) {
      const dot = (s.x - cx) * s.outward[0] + (s.y - cy) * s.outward[1];
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('holds consecutive spacing on one straight leg near the requested spacing', () => {
    const stations = wallStations(crenRing(), 2).filter((s) => s.segIdx === 0);   // leg y=0, x:0→14
    expect(stations.length).toBeGreaterThan(1);
    for (let i = 1; i < stations.length; i++) {
      const d = Math.hypot(stations[i].x - stations[i - 1].x, stations[i].y - stations[i - 1].y);
      expect(d).toBeCloseTo(2, 9);
    }
  });

  it('skips stations inside a gate span', () => {
    // Gate centred at t=7, width 3 on leg 0 (y=0, x runs 0→14, so t === x) ⇒ span [5.5, 8.5].
    const stations = wallStations(crenRing([{ t: 7, width: 3 }]), 2).filter((s) => s.segIdx === 0);
    for (const s of stations) expect(s.x > 8.5 || s.x < 5.5).toBe(true);
  });

  it('skips stations inside a gap span', () => {
    const stations = wallStations(crenRing([{ t: 7, width: 3, kind: 'gap' }]), 2).filter((s) => s.segIdx === 0);
    for (const s of stations) expect(s.x > 8.5 || s.x < 5.5).toBe(true);
  });

  it('an uncrenellated run yields walkZ 0 and no stations', () => {
    const flat: BarrierRun = { kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone', crenellated: false, centroid: CENTROID, gates: [] };
    expect(walkZOf(flat)).toBe(0);
    expect(wallStations(flat)).toEqual([]);
  });

  it('yields no stations without a ring centroid (no notion of "outward" without an inside)', () => {
    const noCentroid: BarrierRun = { kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone', crenellated: true, gates: [] };
    expect(wallStations(noCentroid)).toEqual([]);
  });
});

describe('arcLengthPoint', () => {
  const straight = wall([[0, 0], [10, 0]]);

  it('resolves the path endpoints', () => {
    expect(arcLengthPoint(straight, 0)).toEqual([0, 0]);
    expect(arcLengthPoint(straight, 10)).toEqual([10, 0]);
  });

  it('resolves the midpoint', () => {
    expect(arcLengthPoint(straight, 5)).toEqual([5, 0]);
  });
});
