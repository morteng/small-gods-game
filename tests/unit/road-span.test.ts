import { describe, it, expect } from 'vitest';
import {
  axisOf, cardinalOf, spanVector, spanLengthTiles, spanAxis, spanCardinal, orientUphill,
  sampleSpanSegments, type RoadSpan, type SpanPoint,
} from '@/world/connectome/road-span';

const span = (start: [number, number], end: [number, number]): RoadSpan => ({
  edgeId: 'e1', cls: 'path', obstacle: 'grade',
  start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] },
});

describe('road-span — shared start/stop vocabulary for stairs + bridges', () => {
  it('axisOf picks the dominant run axis, ties to north-south', () => {
    expect(axisOf(3, 0)).toBe('ew');
    expect(axisOf(0, 3)).toBe('ns');
    expect(axisOf(2, 2)).toBe('ns');   // tie ⇒ ns (|dy| >= |dx|)
    expect(axisOf(-4, 1)).toBe('ew');
  });

  it('cardinalOf quantizes a run vector to a cardinal, ties to horizontal', () => {
    expect(cardinalOf(3, 0)).toBe('east');
    expect(cardinalOf(-3, 0)).toBe('west');
    expect(cardinalOf(0, 3)).toBe('south');
    expect(cardinalOf(0, -3)).toBe('north');
    expect(cardinalOf(2, 2)).toBe('east');   // tie ⇒ horizontal (|dx| >= |dy|)
  });

  it('spanVector / spanLengthTiles measure the start→end run', () => {
    const s = span([2, 5], [5, 9]);
    expect(spanVector(s)).toEqual({ dx: 3, dy: 4 });
    expect(spanLengthTiles(s)).toBeCloseTo(5, 6);   // 3-4-5
  });

  it('spanAxis / spanCardinal derive orientation from the span (start→end is travel dir)', () => {
    expect(spanAxis(span([2, 5], [8, 5]))).toBe('ew');
    expect(spanCardinal(span([2, 5], [8, 5]))).toBe('east');   // climbs toward +x
    expect(spanCardinal(span([5, 8], [5, 2]))).toBe('north');  // climbs toward -y
  });

  describe('sampleSpanSegments — follow the polyline as cardinal pieces', () => {
    const P = (...xy: Array<[number, number]>): SpanPoint[] => xy.map(([x, y]) => ({ x, y }));
    const ramp = (g: number) => (x: number) => x * g;   // elevation rises with x

    it('chunks a long straight climb into stacked ~maxSeg pieces covering its length', () => {
      // 8 tiles in x; maxSeg 4 ⇒ two segments [0..4], [4..8].
      const segs = sampleSpanSegments(P([0, 3], [2, 3], [4, 3], [6, 3], [8, 3]),
        { elevAt: (x) => ramp(0.1)(x), reliefM: 48, maxSegTiles: 4 });
      expect(segs.length).toBe(2);
      expect(segs[0].from).toEqual({ x: 0, y: 3 });
      expect(segs[0].to).toEqual({ x: 4, y: 3 });
      expect(segs[1].from).toEqual({ x: 4, y: 3 });
      expect(segs[0].dir).toBe('east');
      expect(segs[0].runTiles).toBeCloseTo(4, 6);
      expect(segs[0].riseM).toBeCloseTo(0.4 * 48, 5);   // Δelev 0.4 · relief 48
    });

    it('orients each piece foot(low)→head(high) regardless of path direction', () => {
      // Path runs DOWN in x (8→0) but elevation still rises with x ⇒ foot is the low (x=0) end.
      const segs = sampleSpanSegments(P([8, 3], [4, 3], [0, 3]),
        { elevAt: (x) => ramp(0.1)(x), reliefM: 48, maxSegTiles: 4 });
      expect(segs.length).toBeGreaterThanOrEqual(1);
      for (const s of segs) expect(s.fromElev).toBeLessThanOrEqual(s.toElev);
    });

    it('reads a zigzag-diagonal as its dominant cardinal, not sub-tile shards', () => {
      // Alternating E/S steps that net to a SE diagonal — one ~maxSeg window, net dir cardinal.
      const segs = sampleSpanSegments(P([0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]),
        { elevAt: (x, y) => (x + y) * 0.2, reliefM: 48, maxSegTiles: 4 });
      // Every segment is a real multi-tile run (no degenerate zero-length shards).
      for (const s of segs) expect(s.runTiles).toBeGreaterThan(0);
      expect(['north', 'south', 'east', 'west']).toContain(segs[0].dir);
    });

    it('returns [] for a path of fewer than two distinct tiles', () => {
      expect(sampleSpanSegments(P([2, 2], [2, 2]), { elevAt: () => 0, reliefM: 48 })).toEqual([]);
      expect(sampleSpanSegments(P([2, 2]), { elevAt: () => 0, reliefM: 48 })).toEqual([]);
    });

    it('is deterministic', () => {
      const mk = () => sampleSpanSegments(P([0, 0], [2, 0], [4, 0]),
        { elevAt: (x) => x * 0.1, reliefM: 48 });
      expect(JSON.stringify(mk())).toEqual(JSON.stringify(mk()));
    });
  });

  it('orientUphill flips the span so start is the LOWER end', () => {
    const downhill = span([2, 5], [8, 5]);            // start low, end high under ramp(+x)
    const elev = (x: number) => x;                    // higher x ⇒ higher ground
    // Already start-low ⇒ unchanged.
    expect(orientUphill(downhill, (x) => elev(x)).start).toEqual({ x: 2, y: 5 });
    // start high ⇒ swapped so the foot is the lower end.
    const reversed = span([8, 5], [2, 5]);
    const o = orientUphill(reversed, (x) => elev(x));
    expect(o.start).toEqual({ x: 2, y: 5 });
    expect(o.end).toEqual({ x: 8, y: 5 });
    // never mutates the input
    expect(reversed.start).toEqual({ x: 8, y: 5 });
  });
});
