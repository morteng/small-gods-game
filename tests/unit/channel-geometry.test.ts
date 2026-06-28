// tests/unit/channel-geometry.test.ts — the kit's Channel/trough primitive.
// A recessed floor between two side walls (open flume), optionally capped (covered conduit).
// Replaces the aqueduct's deck+parapet fake. Pins: a real trough (floor BELOW the wall tops),
// the open vs covered prim count, and axis orientation.
import { describe, it, expect } from 'vitest';
import { channelPrims } from '@/blueprint/parts/channel';
import type { Vec3 } from '@/assetgen/types';

const AT: Vec3 = [0, 0, 0];

describe('channelPrims', () => {
  it('open flume = floor + two side walls (a real trough, floor recessed below the wall tops)', () => {
    const ps = channelPrims(AT, { lengthU: 6, axis: 'x', innerU: 1, floorU: 0.3, depthU: 0.6, wallU: 0.2, material: 'stone' });
    expect(ps.length).toBe(3);
    const floor = ps[0] as any;
    const wallA = ps[1] as any;
    // floor sits on the ground; walls start at the floor top and rise above it (trough depth).
    expect(floor.at[2]).toBeCloseTo(0, 6);
    expect(wallA.at[2]).toBeCloseTo(0.3, 6);                 // walls begin at floor top
    const wallTop = wallA.at[2] + wallA.size[2];
    expect(wallTop).toBeGreaterThan(floor.at[2] + floor.size[2]); // wall top above the floor surface
  });

  it('floor spans the full outer width = inner + 2·wall', () => {
    const ps = channelPrims(AT, { lengthU: 6, axis: 'x', innerU: 1, wallU: 0.2, material: 'stone' });
    const floor = ps[0] as any;
    expect(floor.size[1]).toBeCloseTo(1 + 2 * 0.2, 6);       // outer width on the cross axis (y)
  });

  it('the two walls leave an inner gap of exactly innerU between them', () => {
    const ps = channelPrims(AT, { lengthU: 6, axis: 'x', innerU: 1.4, wallU: 0.3, material: 'stone' });
    const wallA = ps[1] as any, wallB = ps[2] as any;
    const gap = wallB.at[1] - (wallA.at[1] + wallA.size[1]);
    expect(gap).toBeCloseTo(1.4, 6);
  });

  it('covered conduit adds a capstone lid over the trough', () => {
    const open = channelPrims(AT, { lengthU: 6, axis: 'x', innerU: 1, material: 'stone' });
    const covered = channelPrims(AT, { lengthU: 6, axis: 'x', innerU: 1, covered: true, material: 'stone' });
    expect(covered.length).toBe(open.length + 1);
  });

  it('runs along the y axis when asked', () => {
    const ps = channelPrims(AT, { lengthU: 5, axis: 'y', innerU: 1, material: 'stone' });
    expect((ps[0] as any).size[1]).toBeCloseTo(5, 6);        // length is on y
  });
});
