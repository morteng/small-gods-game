import { describe, expect, it } from 'vitest';
import {
  GAIT_LIMP,
  GAIT_MARCH,
  GAIT_NORMAL,
  GAIT_STYLES,
  GAIT_SWAY,
  gaitFrameAt,
  planGait,
} from '@/render/paperdoll/gait';

describe('planGait', () => {
  it('normal style = uniform base cadence, zero offsets', () => {
    const plan = planGait(GAIT_NORMAL, 8, 150);
    expect(plan.frames).toHaveLength(8);
    expect(plan.cycleMs).toBeCloseTo(1200, 6);
    for (const f of plan.frames) {
      expect(f.durMs).toBe(150);
      expect(f.dx).toBe(0);
      expect(f.dy).toBe(0);
    }
  });

  it('tempo scales every duration; timing weights apply per frame', () => {
    const plan = planGait({ name: 't', tempo: 2, timing: [1, 0.5] }, 4, 100);
    expect(plan.frames.map((f) => f.durMs)).toEqual([200, 100, 200, 100]);
    expect(plan.cycleMs).toBeCloseTo(600, 6);
  });

  it('timing and offsets cycle when shorter than the frame count', () => {
    const plan = planGait({ name: 'c', timing: [1, 2], offsets: [[3, -1]] }, 5, 10);
    expect(plan.frames.map((f) => f.durMs)).toEqual([10, 20, 10, 20, 10]);
    for (const f of plan.frames) {
      expect(f.dx).toBe(3);
      expect(f.dy).toBe(-1);
    }
  });

  it('rejects degenerate input', () => {
    expect(() => planGait(GAIT_NORMAL, 0, 150)).toThrow();
    expect(() => planGait(GAIT_NORMAL, 8, 0)).toThrow();
    expect(() => planGait({ name: 'bad', timing: [1, 0] }, 4, 100)).toThrow();
  });
});

describe('gaitFrameAt', () => {
  const plan = planGait({ name: 't', timing: [1, 3] }, 2, 100); // 100ms, 300ms → cycle 400

  it('selects by accumulated duration, not frame index', () => {
    expect(gaitFrameAt(plan, 0).frame).toBe(0);
    expect(gaitFrameAt(plan, 99).frame).toBe(0);
    expect(gaitFrameAt(plan, 100).frame).toBe(1);
    expect(gaitFrameAt(plan, 399).frame).toBe(1);
  });

  it('wraps the cycle, including negative times', () => {
    expect(gaitFrameAt(plan, 400).frame).toBe(0); // 400 → 0
    expect(gaitFrameAt(plan, 550).frame).toBe(1); // 550 → 150, past frame 0's 100ms
    expect(gaitFrameAt(plan, -350).frame).toBe(0); // -350 → 50
    expect(gaitFrameAt(plan, -100).frame).toBe(1); // -100 → 300
  });

  it('returns the frame offsets alongside the index', () => {
    const p = planGait({ name: 'o', offsets: [[1, 2], [-1, -2]] }, 2, 100);
    expect(gaitFrameAt(p, 150)).toMatchObject({ frame: 1, dx: -1, dy: -2 });
  });

  it('is deterministic', () => {
    expect(gaitFrameAt(plan, 1234.5)).toEqual(gaitFrameAt(plan, 1234.5));
  });
});

describe('presets', () => {
  it('registry holds unique, well-formed styles with normal first', () => {
    expect(GAIT_STYLES[0]).toBe(GAIT_NORMAL);
    const names = new Set(GAIT_STYLES.map((s) => s.name));
    expect(names.size).toBe(GAIT_STYLES.length);
    for (const s of GAIT_STYLES) {
      // Every preset must expand cleanly over the real 8-frame walk at 150ms.
      const plan = planGait(s, 8, 150);
      expect(plan.frames).toHaveLength(8);
      for (const f of plan.frames) expect(f.durMs).toBeGreaterThan(0);
    }
  });

  it('limp is asymmetric and slower; march is uniform and brisker; sway drifts laterally', () => {
    const limp = planGait(GAIT_LIMP, 8, 150);
    const march = planGait(GAIT_MARCH, 8, 150);
    const sway = planGait(GAIT_SWAY, 8, 150);
    const normal = planGait(GAIT_NORMAL, 8, 150);

    // Limp: the two half-cycles have very different durations, and it dips.
    const firstHalf = limp.frames.slice(0, 4).reduce((a, f) => a + f.durMs, 0);
    const secondHalf = limp.frames.slice(4).reduce((a, f) => a + f.durMs, 0);
    expect(firstHalf).toBeGreaterThan(secondHalf * 2);
    expect(limp.cycleMs).toBeGreaterThan(normal.cycleMs);
    expect(Math.max(...limp.frames.map((f) => f.dy))).toBeGreaterThan(0);

    // March: every duration equal, faster than normal, bobs upward.
    expect(new Set(march.frames.map((f) => f.durMs)).size).toBe(1);
    expect(march.cycleMs).toBeLessThan(normal.cycleMs);
    expect(Math.min(...march.frames.map((f) => f.dy))).toBeLessThan(0);

    // Sway: lateral motion in both directions, slower than normal.
    expect(Math.max(...sway.frames.map((f) => f.dx))).toBeGreaterThan(0);
    expect(Math.min(...sway.frames.map((f) => f.dx))).toBeLessThan(0);
    expect(sway.cycleMs).toBeGreaterThan(normal.cycleMs);
  });
});
