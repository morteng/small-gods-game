import { describe, it, expect } from 'vitest';
import {
  easeInOut, arcPoint, freePerchIndex, startLeaving, BirdField,
  type Bird, type PerchPoint,
} from '@/studio/bird-field';

// Deterministic PRNG (mulberry32) so the wall-clock flock is reproducible in tests.
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERCHES: PerchPoint[] = [
  { x: 100, y: 40 }, { x: 140, y: 30 }, { x: 180, y: 44 }, { x: 220, y: 36 },
];

// Drive a field for n frames of `dt` ms with fixed conditions.
function run(f: BirdField, points: PerchPoint[], frames: number, dt = 50, wind: 'calm' | 'breeze' | 'gust' = 'calm', on = true): void {
  for (let i = 0; i < frames; i++) f.step(points, dt, wind, on);
}

describe('bird-field arc interpolation', () => {
  it('easeInOut hits the endpoints and is monotonic', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const e = easeInOut(t);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
  });

  it('arcPoint returns the exact endpoints (lift cancels at both ends)', () => {
    const a = arcPoint(10, 20, 90, 60, 30, 0);
    expect(a).toEqual({ x: 10, y: 20 });
    const b = arcPoint(10, 20, 90, 60, 30, 1);
    expect(b.x).toBeCloseTo(90, 6);
    expect(b.y).toBeCloseTo(60, 6);
  });

  it('arcPoint x-progress is monotonic and the apex is lifted', () => {
    let prevX = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const p = arcPoint(0, 0, 100, 0, 40, t);
      expect(p.x).toBeGreaterThanOrEqual(prevX);
      prevX = p.x;
    }
    // Midpoint sits above the straight line (screen-y up = negative) by the lift.
    expect(arcPoint(0, 0, 100, 0, 40, 0.5).y).toBeCloseTo(-40, 6);
  });
});

describe('bird-field perch assignment', () => {
  it('freePerchIndex skips claimed sockets and reports −1 when full', () => {
    expect(freePerchIndex([0, 2], 3, () => 0)).toBe(1);
    expect(freePerchIndex([0, 1, 2], 3, () => 0)).toBe(-1);
    // −1 sentinels (leaving birds) free their socket.
    expect(freePerchIndex([-1, 0], 2, () => 0)).toBe(1);
  });

  it('no two birds ever claim the same perch (invariant across the run)', () => {
    const f = new BirdField(prng(7));
    let maxCount = 0;
    for (let i = 0; i < 4000; i++) {
      f.step(PERCHES, 50, 'calm', true);
      const idx = f.all.filter((b) => b.phase !== 'leaving').map((b) => b.perchIdx);
      expect(new Set(idx).size).toBe(idx.length);          // distinct EVERY frame
      expect(f.count).toBeLessThanOrEqual(3);              // capped at MAX_BIRDS
      maxCount = Math.max(maxCount, f.count);
    }
    expect(maxCount).toBe(3);                               // the flock does fill up
  });
});

describe('bird-field lifecycle transitions', () => {
  it('a perched bird whose socket falls out of range departs (no snap)', () => {
    const f = new BirdField(prng(3));
    // Land at least one bird on the 4-perch subject.
    let guard = 0;
    while (!f.all.some((b) => b.phase === 'perched') && guard++ < 5000) f.step(PERCHES, 50, 'calm', true);
    expect(f.all.some((b) => b.phase === 'perched')).toBe(true);
    const highIdx = f.all.filter((b) => b.phase !== 'leaving').some((b) => b.perchIdx >= 2);
    // Re-roll to fewer anchors: any bird bound to idx ≥ 2 must now be leaving.
    f.step(PERCHES.slice(0, 2), 50, 'calm', true);
    if (highIdx) {
      expect(f.all.some((b) => b.phase === 'leaving')).toBe(true);
    }
    // Every surviving non-leaving bird now points at a valid socket.
    for (const b of f.all) if (b.phase !== 'leaving') expect(b.perchIdx).toBeLessThan(2);
  });

  it('startLeaving flushes in place (current position preserved, socket released)', () => {
    const b: Bird = {
      phase: 'perched', x: 123, y: 45, fromX: 0, fromY: 0, toX: 0, toY: 0,
      perchIdx: 2, t: 0.5, dur: 1500, lift: 20, sit: 5000, hop: 0, hopCd: 0, flap: 0, face: 1, seed: 1,
    };
    startLeaving(b, prng(11));
    expect(b.phase).toBe('leaving');
    expect(b.perchIdx).toBe(-1);
    expect(b.fromX).toBe(123);      // exit arc starts at the current position — no teleport
    expect(b.fromY).toBe(45);
    expect(b.t).toBe(0);
  });

  it('a gale flushes every bird to leaving and blocks new spawns', () => {
    const f = new BirdField(prng(9));
    run(f, PERCHES, 1500, 50, 'calm', true);     // build a flock
    expect(f.count).toBeGreaterThan(0);
    const before = f.count;
    f.step(PERCHES, 50, 'gust', true);
    for (const b of f.all) expect(b.phase).toBe('leaving');
    // Keep gusting: no bird ever lands, count only drains toward zero.
    run(f, PERCHES, 100, 50, 'gust', true);
    expect(f.count).toBeLessThanOrEqual(before);
    expect(f.all.every((b) => b.phase === 'leaving')).toBe(true);
  });

  it('turning the dial off DRAINS the flock (leaving, not a hard clear/teleport)', () => {
    const f = new BirdField(prng(21));
    run(f, PERCHES, 1500, 50, 'calm', true);
    expect(f.count).toBeGreaterThan(0);
    const before = f.count;
    const pos = f.all.map((b) => ({ x: b.x, y: b.y }));
    f.step(PERCHES, 50, 'calm', false);          // dial off
    expect(f.count).toBe(before);                // not cleared — still draining
    for (const b of f.all) expect(b.phase).toBe('leaving');
    // No teleport: after one 50ms frame each bird has barely moved off its spot.
    f.all.forEach((b, i) => { expect(Math.hypot(b.x - pos[i].x, b.y - pos[i].y)).toBeLessThan(30); });
  });
});
