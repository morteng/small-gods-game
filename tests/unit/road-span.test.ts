import { describe, it, expect } from 'vitest';
import {
  axisOf, cardinalOf, spanVector, spanLengthTiles, spanAxis, spanCardinal, orientUphill,
  type RoadSpan,
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
