import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker } from '@/llm/cost-tracker';

const JUNE = () => new Date(2026, 5, 6); // month is 0-indexed → June

beforeEach(() => localStorage.clear());

describe('CostTracker', () => {
  it('accumulates paid cost across session/month/all-time and counts calls', () => {
    const t = new CostTracker(JUNE);
    t.record({ cost: 0.01 });
    t.record({ cost: 0.02 });
    const s = t.snapshot();
    expect(s.sessionUsd).toBeCloseTo(0.03);
    expect(s.monthUsd).toBeCloseTo(0.03);
    expect(s.allTimeUsd).toBeCloseTo(0.03);
    expect(s.calls).toBe(2);
  });

  it('counts cache hits without adding cost or calls', () => {
    const t = new CostTracker(JUNE);
    t.record({ cacheStatus: 'HIT' });
    const s = t.snapshot();
    expect(s.cacheHits).toBe(1);
    expect(s.sessionUsd).toBe(0);
    expect(s.calls).toBe(0);
  });

  it('rolls over the month bucket but preserves all-time', () => {
    let now = new Date(2026, 5, 30); // June 30
    const t = new CostTracker(() => now);
    t.record({ cost: 0.05 });
    now = new Date(2026, 6, 1); // July 1
    t.record({ cost: 0.02 });
    const s = t.snapshot();
    expect(s.monthUsd).toBeCloseTo(0.02);
    expect(s.allTimeUsd).toBeCloseTo(0.07);
    expect(s.month).toBe('2026-07');
  });

  it('persists month + all-time across instances; session does not persist', () => {
    const t1 = new CostTracker(JUNE);
    t1.record({ cost: 0.04 });
    const t2 = new CostTracker(JUNE);
    const s = t2.snapshot();
    expect(s.allTimeUsd).toBeCloseTo(0.04);
    expect(s.monthUsd).toBeCloseTo(0.04);
    expect(s.sessionUsd).toBe(0);
  });

  it('notifies subscribers on record', () => {
    const t = new CostTracker(JUNE);
    const seen: number[] = [];
    t.subscribe((s) => seen.push(s.sessionUsd));
    t.record({ cost: 0.01 });
    expect(seen).toEqual([0.01]);
  });
});
