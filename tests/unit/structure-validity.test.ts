// tests/unit/structure-validity.test.ts
// The PURE analytic structural-validity core (scripts/lib/structure-validity.ts) — the ASCE
// Bridge Designer crossover slice — driven by synthetic heightfields. Deliberately NO world /
// no manifold / no renderer: the core takes an injected terrain sampler, so each rule is a tiny
// pure fixture. Tooling, not shipped geometry — no golden pins, no ART_RECIPE_VERSION bump.
import { describe, it, expect } from 'vitest';
import {
  BRIDGE_CLASS_MAX_SPAN_M,
  BRIDGE_CLASSES,
  maxSpanM,
  clearSpanM,
  sagProxyMmPerM,
  checkSpan,
  type BridgeClass,
} from '../../scripts/lib/structure-validity';

/** A terrain sampler with a raised bank at the origin (grade) and a contiguous low "channel"
 *  across columns [gapStart..gapEnd): a clear span the author loop must read. */
function channel(gapStart: number, gapEnd: number): (x: number, y: number) => number {
  return (x) => (x >= gapStart && x < gapEnd ? 0 : 10);
}

describe('class tables (BRIDGE_CLASSES / maxSpanM)', () => {
  it('enumerates exactly the four documented classes', () => {
    expect([...BRIDGE_CLASSES].sort()).toEqual(['arch', 'deck', 'stone', 'timber']);
  });

  it('has explicit, finite, positive max spans for every class', () => {
    for (const cls of BRIDGE_CLASSES) {
      const m = BRIDGE_CLASS_MAX_SPAN_M[cls];
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBeGreaterThan(0);
      // maxSpanM must agree with the table (single source of truth).
      expect(maxSpanM(cls)).toBe(m);
    }
  });

  it('ranks the classes sensibly (arch spans the most, timber the least)', () => {
    expect(BRIDGE_CLASS_MAX_SPAN_M.arch).toBeGreaterThan(BRIDGE_CLASS_MAX_SPAN_M.stone);
    expect(BRIDGE_CLASS_MAX_SPAN_M.stone).toBeGreaterThan(BRIDGE_CLASS_MAX_SPAN_M.deck);
    expect(BRIDGE_CLASS_MAX_SPAN_M.deck).toBeGreaterThan(BRIDGE_CLASS_MAX_SPAN_M.timber);
  });
});

describe('clearSpanM', () => {
  it('reports 0 on flat ground (no gap to cross)', () => {
    expect(clearSpanM({ x: 10, y: 10 }, { w: 5, h: 3 }, () => 7)).toBe(0);
  });

  it('measures a contiguous low channel in metres (2 m per tile), scan on the long axis', () => {
    // Gap across x = [4..10) is 6 tiles → 12 m clear span (origin at x=0 is the raised bank).
    const r = clearSpanM({ x: 0, y: 0 }, { w: 14, h: 1 }, channel(4, 10));
    expect(r).toBe(12);
  });

  it('uses the LONGEST contiguous run, not the widest axis count or a raggedy sum', () => {
    // Two 2-tile dips separated by dry ground ⇒ max run is 2 tiles = 4 m, not 8.
    const terrain = (x: number) => ((x >= 2 && x < 4) || (x >= 7 && x < 9) ? 0 : 10);
    expect(clearSpanM({ x: 0, y: 0 }, { w: 12, h: 1 }, terrain)).toBe(4);
  });

  it('scans the taller axis when the footprint is portrait', () => {
    // Portrait footprint (w=1, h=8): the gap runs down the y axis from y=[2..6) → 4 tiles = 8 m.
    const terrain = (_x: number, y: number) => (y >= 2 && y < 6 ? 0 : 10);
    expect(clearSpanM({ x: 0, y: 0 }, { w: 1, h: 8 }, terrain)).toBe(8);
  });
});

describe('sagProxyMmPerM', () => {
  it('is monotone increasing in span for every class', () => {
    for (const cls of BRIDGE_CLASSES) {
      const a = sagProxyMmPerM(5, cls);
      const b = sagProxyMmPerM(10, cls);
      const c = sagProxyMmPerM(15, cls);
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(c);
    }
  });

  it('ranks classes by stiffness: timber sags the most, arch the least, at equal span', () => {
    const span = 10;
    const sag = (cls: BridgeClass) => sagProxyMmPerM(span, cls);
    expect(sag('timber')).toBeGreaterThan(sag('deck'));
    expect(sag('deck')).toBeGreaterThan(sag('stone'));
    expect(sag('stone')).toBeGreaterThan(sag('arch'));
  });

  it('zero span yields zero sag', () => {
    expect(sagProxyMmPerM(0, 'arch')).toBe(0);
  });
});

describe('checkSpan', () => {
  // A 6-tile (12 m) channel over a 14-wide footprint — the shared fixture below.
  const terrain = channel(4, 10);

  it('reads ok within the envelope (arch spans 12 m comfortably)', () => {
    const r = checkSpan({ x: 0, y: 0 }, { w: 14, h: 1 }, terrain, 'arch');
    expect(r.status).toBe('ok');
    expect(r.suggested).toBeNull();
    expect(r.clearSpanM).toBe(12);
    expect(r.maxSpanM).toBe(BRIDGE_CLASS_MAX_SPAN_M.arch);
    expect(r.ratio).toBeCloseTo(12 / BRIDGE_CLASS_MAX_SPAN_M.arch, 3);
  });

  it('warns near the envelope and suggests an arch for a non-arch class', () => {
    // deck max 12 m, 12 m clear → ratio 1.0 → warn (not fail, not ok), suggest 'arch'.
    const r = checkSpan({ x: 0, y: 0 }, { w: 14, h: 1 }, terrain, 'deck');
    expect(r.status).toBe('warn');
    expect(r.suggested).toBe('arch');
  });

  it('fails when the clear span exceeds the class envelope, suggesting a remedy', () => {
    // timber max 8 m, 12 m clear → ratio 1.5 → fail, suggest arch.
    const r = checkSpan({ x: 0, y: 0 }, { w: 14, h: 1 }, terrain, 'timber');
    expect(r.status).toBe('fail');
    expect(r.suggested).toBe('arch');
  });

  it('suggests a mid-pier when the class is already the spanning arch', () => {
    // A 20-tile (40 m) channel exceeds even the arch envelope → warn/fail suggests 'mid-pier'.
    const big = checkSpan({ x: 0, y: 0 }, { w: 24, h: 1 }, channel(2, 22), 'arch');
    expect(big.clearSpanM).toBe(40);
    expect(big.status).not.toBe('ok');
    expect(big.suggested).toBe('mid-pier');
  });

  it('is deterministic and JSON-serialisable', () => {
    const a = checkSpan({ x: 0, y: 0 }, { w: 14, h: 1 }, terrain, 'stone');
    const b = checkSpan({ x: 0, y: 0 }, { w: 14, h: 1 }, terrain, 'stone');
    expect(a).toEqual(b);
    expect(() => JSON.stringify(a)).not.toThrow();
  });
});
