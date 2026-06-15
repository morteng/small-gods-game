import { describe, it, expect } from 'vitest';
import { bootMark, getBootProfile, FpsMeter } from '@/dev/profile';

describe('boot profile', () => {
  it('reports per-phase deltas between marks and resets on "start"', () => {
    bootMark('start');
    bootMark('engine');
    bootMark('renderer');
    const phases = getBootProfile();
    expect(phases.map(p => p.phase)).toEqual(['engine', 'renderer']);
    // Each row carries a numeric ms delta and a cumulative sinceStartMs.
    for (const p of phases) {
      expect(typeof p.ms).toBe('number');
      expect(p.sinceStartMs).toBeGreaterThanOrEqual(0);
    }
    // A fresh 'start' clears the prior run.
    bootMark('start');
    expect(getBootProfile()).toEqual([]);
  });
});

describe('FpsMeter', () => {
  it('reports idle before any frame and computes stats after frames', () => {
    const m = new FpsMeter();
    expect(m.stats().idle).toBe(true);
    // Two frames close in time → non-idle, finite render stats.
    m.frame(4);
    m.frame(5);
    const s = m.stats();
    expect(s.renderMs).toBeGreaterThan(0);
    expect(s.frames).toBeGreaterThanOrEqual(1);
  });

  it('reset() clears samples back to idle', () => {
    const m = new FpsMeter();
    m.frame(3); m.frame(3);
    m.reset();
    expect(m.stats().idle).toBe(true);
  });
});
