import { describe, it, expect } from 'vitest';
import type { Snapshot } from '@/core/snapshot';
import { SnapshotStore } from '@/core/snapshot';

function fakeSnap(tick: number): Snapshot {
  return { tick, rng: [0, 0, 0, 0], entities: [], activeEvents: [], spirits: [] };
}

describe('SnapshotStore', () => {
  it('evicts oldest first when capacity is exceeded', () => {
    const store = new SnapshotStore({ capacity: 3 });
    store.push(fakeSnap(0));
    store.push(fakeSnap(10));
    store.push(fakeSnap(20));
    store.push(fakeSnap(30));
    const all = store.list();
    expect(all.length).toBe(3);
    expect(all[0].tick).toBe(10);
    expect(all[2].tick).toBe(30);
  });

  it('nearestAtOrBefore returns the highest tick <= target, or null', () => {
    const store = new SnapshotStore({ capacity: 5 });
    store.push(fakeSnap(0));
    store.push(fakeSnap(10));
    store.push(fakeSnap(20));
    expect(store.nearestAtOrBefore(15)!.tick).toBe(10);
    expect(store.nearestAtOrBefore(20)!.tick).toBe(20);
    expect(store.nearestAtOrBefore(100)!.tick).toBe(20);
    expect(store.nearestAtOrBefore(-1)).toBeNull();
  });

  it('truncateAfter drops snapshots with tick > target', () => {
    const store = new SnapshotStore({ capacity: 5 });
    store.push(fakeSnap(0));
    store.push(fakeSnap(10));
    store.push(fakeSnap(20));
    store.push(fakeSnap(30));
    store.truncateAfter(15);
    expect(store.list().map(s => s.tick)).toEqual([0, 10]);
  });
});
