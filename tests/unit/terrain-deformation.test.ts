/**
 * Shared terrain-deformation channel — `heightAt = baseSeedHeight ⊕ deformations`.
 * Verifies the four blend ops, the store (cull / versioning / removeSource), brush
 * footprints, and the load-bearing parity invariant (empty store ⇒ heightAt == base).
 */
import { describe, it, expect } from 'vitest';
import type { GameMap } from '@/core/types';
import {
  DeformationStore,
  heightAt,
  baseHeightAt,
  frustumDeformation,
  annulusDeformation,
  discDeformation,
  polylineDeformation,
} from '@/world/terrain-deformation';

const map = { seed: 7, width: 48, height: 48 } as unknown as GameMap;
const C = { x: 24, y: 24 };
const base = (x: number, y: number) => baseHeightAt(map, x, y);

describe('parity — empty store is identity', () => {
  it('heightAt == baseHeightAt everywhere with no deformations', () => {
    const store = new DeformationStore();
    for (const [x, y] of [[24, 24], [10, 30], [40, 5], [0, 0]] as const) {
      expect(heightAt(map, store, x, y)).toBe(base(x, y));
    }
  });
});

describe('blend ops', () => {
  it('raise (motte): centre rises by amount; outside the footprint is untouched', () => {
    const store = new DeformationStore();
    store.add(frustumDeformation({ id: 'm', source: 'earthwork:motte', cx: C.x, cy: C.y, topRadius: 3, height: 6, slope: 1.5 }));
    expect(heightAt(map, store, C.x, C.y) - base(C.x, C.y)).toBeCloseTo(6, 6);
    // far outside the base radius (3 + 1.5*6 = 12) → identity
    expect(heightAt(map, store, C.x + 20, C.y)).toBe(base(C.x + 20, C.y));
  });

  it('carve (ditch): the ring drops by amount; the centre inside the ring is untouched', () => {
    const store = new DeformationStore();
    store.add(annulusDeformation({ id: 'd', source: 'earthwork:ditch', cx: C.x, cy: C.y, r: 10, width: 4, amount: 3, op: 'carve' }));
    expect(heightAt(map, store, C.x + 10, C.y) - base(C.x + 10, C.y)).toBeCloseTo(-3, 6);
    expect(heightAt(map, store, C.x, C.y)).toBe(base(C.x, C.y)); // centre is outside the band
  });

  it('add (rampart): the ring gains height additively', () => {
    const store = new DeformationStore();
    store.add(annulusDeformation({ id: 'r', source: 'earthwork:rampart', cx: C.x, cy: C.y, r: 8, width: 4, amount: 2, op: 'add' }));
    expect(heightAt(map, store, C.x + 8, C.y) - base(C.x + 8, C.y)).toBeCloseTo(2, 6);
  });

  it('level (pad): inside the disc the ground is set toward an absolute target', () => {
    const store = new DeformationStore();
    const target = base(C.x, C.y) + 5;
    store.add(discDeformation({ id: 'p', source: 'settlement:pad', cx: C.x, cy: C.y, radius: 4, target }));
    expect(heightAt(map, store, C.x, C.y)).toBeCloseTo(target, 6);
  });
});

describe('composition — motte with a ditch', () => {
  it('raises the core and carves the surrounding ring, leaving the rest of the base', () => {
    const store = new DeformationStore();
    store.add(frustumDeformation({ id: 'm', source: 'earthwork:motte', cx: C.x, cy: C.y, topRadius: 3, height: 6, slope: 1.5 }));
    store.add(annulusDeformation({ id: 'd', source: 'earthwork:ditch', cx: C.x, cy: C.y, r: 14, width: 4, amount: 3, op: 'carve' }));
    expect(heightAt(map, store, C.x, C.y) - base(C.x, C.y)).toBeCloseTo(6, 6); // core up
    expect(heightAt(map, store, C.x + 14, C.y) - base(C.x + 14, C.y)).toBeCloseTo(-3, 6); // ditch down
    expect(heightAt(map, store, C.x + 30, C.y)).toBe(base(C.x + 30, C.y)); // untouched ground
  });
});

describe('DeformationStore', () => {
  it('bumps version, culls by AABB, and removes by source', () => {
    const store = new DeformationStore();
    const v0 = store.version;
    store.add(frustumDeformation({ id: 'm', source: 'earthwork:motte', cx: C.x, cy: C.y, topRadius: 3, height: 6, slope: 1.5 }));
    expect(store.version).toBeGreaterThan(v0);
    expect(store.at(C.x, C.y)).toHaveLength(1); // covers the centre
    expect(store.at(0, 0)).toHaveLength(0); // AABB cull
    store.removeSource('earthwork:motte');
    expect(store.size).toBe(0);
    expect(heightAt(map, store, C.x, C.y)).toBe(base(C.x, C.y));
  });

  it('composes deterministically in (priority, id) order', () => {
    const a = new DeformationStore();
    const b = new DeformationStore();
    const d1 = discDeformation({ id: 'a', source: 's', cx: C.x, cy: C.y, radius: 5, target: 10, priority: 20 });
    const d2 = discDeformation({ id: 'b', source: 's', cx: C.x, cy: C.y, radius: 5, target: 20, priority: 20 });
    a.add(d1, d2);
    b.add(d2, d1); // added in the opposite order
    expect(heightAt(map, a, C.x, C.y)).toBe(heightAt(map, b, C.x, C.y)); // order-independent result
  });
});

describe('polyline brush (roads/rivers)', () => {
  it('carves along the line and leaves tiles beyond its reach', () => {
    const store = new DeformationStore();
    store.add(polylineDeformation({
      id: 'river', source: 'river:incision',
      points: [{ x: 5, y: 24 }, { x: 40, y: 24 }], halfWidth: 1, amount: 4, op: 'carve',
    }));
    expect(heightAt(map, store, 20, 24) - base(20, 24)).toBeCloseTo(-4, 6); // on the line
    expect(heightAt(map, store, 20, 40)).toBe(base(20, 40)); // far from the line
  });
});
