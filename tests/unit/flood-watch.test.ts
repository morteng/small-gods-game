import { describe, it, expect } from 'vitest';
import { buildFloodWatch } from '@/world/flood-watch';

const W = 32, H = 32;

/** A flood field with a disc of depth `d` around (cx,cy). */
function floodField(cx: number, cy: number, r: number, d: number): Float32Array {
  const f = new Float32Array(W * H);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r) continue;
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    f[y * W + x] = d;
  }
  return f;
}

describe('FloodWatch', () => {
  it('fires a single flooded edge when water rises over a place, not every poll', () => {
    const w = buildFloodWatch([{ id: 'town', name: 'Town', x: 16, y: 16, radius: 3 }], W, H);
    const wet = floodField(16, 16, 4, 1.5);

    const first = w.poll(wet);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ placeId: 'town', type: 'flooded' });
    expect(first[0].depthM).toBeCloseTo(1.5);
    expect(first[0].coverage).toBeGreaterThan(0);

    // Still flooded next poll → no repeat event (edge-triggered, not level).
    expect(w.poll(wet)).toHaveLength(0);
    expect(w.floodedPlaceIds()).toEqual(['town']);
  });

  it('fires a receded edge when the water drains back below the low threshold', () => {
    const w = buildFloodWatch([{ id: 'town', name: 'Town', x: 16, y: 16, radius: 3 }], W, H);
    w.poll(floodField(16, 16, 4, 1.5));        // flood it
    const dry = new Float32Array(W * H);        // fully drained
    const ev = w.poll(dry);
    expect(ev).toHaveLength(1);
    expect(ev[0].type).toBe('receded');
    expect(w.floodedPlaceIds()).toEqual([]);
  });

  it('hysteresis: a trickle just under the rise threshold does not flood', () => {
    const w = buildFloodWatch([{ id: 'town', name: 'Town', x: 16, y: 16, radius: 3 }], W, H);
    expect(w.poll(floodField(16, 16, 4, 0.2))).toHaveLength(0);   // 0.2 m < FLOOD_ON 0.3
    expect(w.floodedPlaceIds()).toEqual([]);
  });

  it('only the place under the water floods; a distant place stays dry', () => {
    const w = buildFloodWatch([
      { id: 'a', name: 'A', x: 6, y: 6, radius: 2 },
      { id: 'b', name: 'B', x: 26, y: 26, radius: 2 },
    ], W, H);
    const ev = w.poll(floodField(6, 6, 3, 2));
    expect(ev.map((e) => e.placeId)).toEqual(['a']);
  });

  it('reset clears latched state so the next rise re-fires', () => {
    const w = buildFloodWatch([{ id: 'town', name: 'Town', x: 16, y: 16, radius: 3 }], W, H);
    const wet = floodField(16, 16, 4, 1.5);
    expect(w.poll(wet)).toHaveLength(1);
    w.reset();
    expect(w.poll(wet)).toHaveLength(1);   // fires again after reset
  });
});
