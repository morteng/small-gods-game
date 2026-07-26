import { describe, it, expect } from 'vitest';
import { GarrisonOrders } from '@/sim/garrison';

/**
 * `GarrisonOrders` — the command-reachable half of Manning the Walls (W3), moved off
 * `GarrisonSystem`'s private fields onto `GameState.garrisonOrders` so `muster_garrison`/
 * `stand_down_garrison` can reach it (a command gets `ctx.state`, never a live system). The
 * round-trip/hydrate coverage that used to live in `garrison-system.test.ts`'s "snapshot seam"
 * describe block moves here — the store now owns its own serialize/hydrate contract, mirroring
 * `ContentionLedger` (`tests/unit/rival-contention.test.ts`). The full `GameState`-level scrub
 * (capture + restore preserving a standing order) is covered in `tests/unit/snapshot.test.ts`.
 */
describe('GarrisonOrders', () => {
  it('starts empty: no standing orders, nothing mustered', () => {
    const o = new GarrisonOrders();
    expect(o.hasStandingOrder('town')).toBe(false);
    expect(o.isMustered('town')).toBe(false);
    expect(o.serialize()).toEqual({ standing: [], mustered: [] });
  });

  it('raises and releases a standing order independently of the mustered bit', () => {
    const o = new GarrisonOrders();
    o.setStandingOrder('town', true);
    expect(o.hasStandingOrder('town')).toBe(true);
    expect(o.isMustered('town')).toBe(false);         // the system hasn't ticked yet

    o.setMustered('town', true);
    expect(o.isMustered('town')).toBe(true);

    o.setStandingOrder('town', false);
    expect(o.hasStandingOrder('town')).toBe(false);
    expect(o.isMustered('town')).toBe(true);          // releasing the order doesn't itself stand down
  });

  it('pruneMusteredExcept forgets muster state for settlements with no live ring, leaving orders alone', () => {
    const o = new GarrisonOrders();
    o.setStandingOrder('a', true);
    o.setMustered('a', true);
    o.setMustered('b', true);
    o.pruneMusteredExcept(new Set(['a']));
    expect(o.isMustered('a')).toBe(true);
    expect(o.isMustered('b')).toBe(false);
    expect(o.hasStandingOrder('a')).toBe(true);        // orders survive a ring's disappearance
  });

  it('serialize/hydrate round-trips both sets, sorted', () => {
    const o = new GarrisonOrders();
    o.setStandingOrder('b-town', true);
    o.setStandingOrder('a-town', true);
    o.setMustered('a-town', true);
    const dump = structuredClone(o.serialize());
    expect(dump).toEqual({ standing: ['a-town', 'b-town'], mustered: ['a-town'] });

    const revived = new GarrisonOrders();
    revived.hydrate(dump);
    expect(revived.hasStandingOrder('a-town')).toBe(true);
    expect(revived.hasStandingOrder('b-town')).toBe(true);
    expect(revived.isMustered('a-town')).toBe(true);
    expect(revived.isMustered('b-town')).toBe(false);
    expect(revived.serialize()).toEqual(dump);
  });

  it('static fromSnapshot builds an equivalent, independent instance', () => {
    const o = new GarrisonOrders();
    o.setStandingOrder('town', true);
    o.setMustered('town', true);
    const snap = o.serialize();

    const revived = GarrisonOrders.fromSnapshot(snap);
    expect(revived.serialize()).toEqual(snap);

    // Independent: mutating the revived store must never alias the original.
    revived.setStandingOrder('town', false);
    expect(o.hasStandingOrder('town')).toBe(true);
  });

  it('hydrate never throws on an absent snapshot field and resets cleanly', () => {
    const o = new GarrisonOrders();
    o.setStandingOrder('town', true);
    o.setMustered('town', true);
    expect(() => o.hydrate({ standing: [], mustered: [] })).not.toThrow();
    expect(o.hasStandingOrder('town')).toBe(false);
    expect(o.isMustered('town')).toBe(false);
    expect(o.serialize()).toEqual({ standing: [], mustered: [] });
  });

  it('hydrate never aliases the snapshot array it was given', () => {
    const o = new GarrisonOrders();
    const standing = ['town'];
    o.hydrate({ standing, mustered: [] });
    standing.push('another-town');
    expect(o.hasStandingOrder('another-town')).toBe(false);
  });
});
