import { describe, it, expect } from 'vitest';
import {
  createState, resetState, identityStableFields, GAME_STATE_FIELD_COUNT,
  type GameState,
} from '@/core/state';
import { RoadUseTally } from '@/world/road-use';
import { ContentionLedger } from '@/sim/rival-contention';
import { SettlementAggregateStore } from '@/sim/settlement-aggregates';
import { SettlementFluxTally } from '@/sim/settlement-flux';
import { FateSettlementDigestBaseline } from '@/sim/fate/settlement-digest-baseline';

/**
 * The guard behind in-process quit-to-title (UI v3 §3.4).
 *
 * `Game` wires a dozen collaborators around ONE `GameState`, so returning to the
 * title has to clear that object in place rather than replace it. The failure
 * mode that makes such a reset untrustworthy is a MISSED field leaving stale
 * world data alive in the "fresh" game. These tests make that mechanical:
 * identity is asserted for the containers subsystems hold references to, logical
 * emptiness is asserted for everything, and the field count is pinned so a new
 * `GameState` field cannot slip through unconsidered.
 */

/** Dirty every field we can reach through the public surface, so a reset that
 *  misses one is visible. */
function dirty(): GameState {
  const s = createState();
  s.map = { width: 4, height: 4, tiles: [] } as unknown as GameState['map'];
  s.worldSeed = { name: 'test-world' } as unknown as GameState['worldSeed'];
  s.world = { marker: 'stale-world' } as unknown as GameState['world'];
  s.visualMap = [['a']];
  s.blobMap = [[]] as unknown as GameState['blobMap'];
  s.biomeMap = { marker: 'stale' } as unknown as GameState['biomeMap'];
  s.terrainFields = { marker: 'stale' } as unknown as GameState['terrainFields'];
  s.selectedNpcId = 'npc-9';
  s.selectedBuildingId = 'bld-9';
  s.selectedCausalSiteId = 'site-9';
  s.selectedPoiId = 'poi-9';
  s.pinnedNpcId = 'npc-9';
  s.followNpc = true;
  s.debug = true;
  s.showLabels = false;
  s.showPoiMarkers = false;
  s.cameraFly = { tx: 3, ty: 4, zoom: 2 };
  s.cameraLock = { mode: 'follower', targetId: 'npc-9' as GameState['cameraLock']['targetId'] };
  s.waterLevelM = -3.5;
  s.generatedDecorations = [{ assetId: 'x' }] as unknown as GameState['generatedDecorations'];
  s.weather = { marker: 'stale' } as unknown as GameState['weather'];
  s.floodWatch = { marker: 'stale' } as unknown as GameState['floodWatch'];
  s.causalSites = { marker: 'stale' } as unknown as GameState['causalSites'];
  s.trample = { marker: 'stale' } as unknown as GameState['trample'];
  s.cohorts.set('poi-1', { marker: 'stale' } as unknown as never);
  s.roadUse = new RoadUseTally();
  s.roadUse.sinceTick = 12345;
  s.contention = new ContentionLedger();
  // Interaction scaling P1: both new stores are REPLACEABLE (restoreSnapshot
  // swaps them wholesale, like roadUse/contention) — dirty them so a reset that
  // missed either would leave the previous world's settlement numbers standing.
  s.settlementAggregates = new SettlementAggregateStore();
  s.settlementAggregates.replace(new Map([['poi-stale', {
    poiId: 'poi-stale',
    population: { named: 3, statistical: 30 },
    believers: {},
    needPressure: { safety: 0.1, prosperity: 0.2, community: 0.3, meaning: 0.4 },
    prayerPressure: 1,
  }]]), 4242);
  s.settlementFlux = new SettlementFluxTally();
  s.settlementFlux.sinceTick = 4242;
  s.settlementFlux.noteVisitor('poi-stale', 'poi-other');
  // Interaction scaling P5: the Fate belief-trend baseline is REPLACEABLE too
  // (no external closure holds it) — dirty it so a reset that missed it would
  // leave a stale settlement's meanFaith baseline feeding the next digest's trend.
  s.fateSettlementDigestBaseline = new FateSettlementDigestBaseline();
  s.fateSettlementDigestBaseline.set('poi-stale', new Map([['rival-1', 0.42]]));

  // identity-stable containers
  s.camera.x = 999; s.camera.y = 888; s.camera.zoom = 7;
  s.clock.setNow(500_000);
  s.eventLog.append({ type: 'spirit_birth', spiritId: 'rival-1', name: 'Stale', isPlayer: false });
  s.spirits.set('rival-1', { id: 'rival-1', name: 'Stale', isPlayer: false } as never);
  s.surfacedInbox.add('inbox-9');
  // Minimally VALID payloads (each store's `hydrate` walks its entries), so the
  // fixture exercises the real clearing path rather than throwing inside it.
  s.plotThreads.hydrate([{ id: 1, contributingEvents: [{ eventId: 7 }] } as never]);
  s.staging.hydrate([{ id: 1 } as never]);
  s.chronicle.hydrate([{ day: 1, title: 'A', body: 'B' } as never]);
  s.runtimePois.hydrate({ entries: [{ id: 'rp1' } as never], nextId: 9 });
  s.crossingTiers.hydrate({ entries: [{ crossingId: 'c1', tier: 1 } as never] });
  s.adoptions.hydrate({ entries: [{ key: 'a1' } as never] });
  return s;
}

describe('resetState — in-process world teardown', () => {
  it('pins the GameState field count so a new field forces a decision', () => {
    // If this fails: you added a field to GameState. Decide whether subsystems
    // hold a direct reference to it (→ add it to IDENTITY_STABLE and clear it in
    // place in resetState) or whether it can simply be replaced (→ nothing to do,
    // the loop covers it). Then bump GAME_STATE_FIELD_COUNT in the same commit.
    expect(Object.keys(createState()).length).toBe(GAME_STATE_FIELD_COUNT);
  });

  it('every identity-stable name is a real GameState field', () => {
    const keys = new Set(Object.keys(createState()));
    for (const k of identityStableFields()) expect(keys.has(k as string)).toBe(true);
  });

  it('PRESERVES object identity for every identity-stable field', () => {
    const s = dirty();
    const before = new Map<string, unknown>();
    for (const k of identityStableFields()) before.set(k as string, (s as unknown as Record<string, unknown>)[k as string]);
    resetState(s);
    for (const k of identityStableFields()) {
      // Subsystems built once in the Game constructor hold these references; a
      // swap here would leave them driving a dead object.
      expect((s as unknown as Record<string, unknown>)[k as string]).toBe(before.get(k as string));
    }
  });

  it('clears the identity-stable containers to their fresh CONTENTS', () => {
    const s = dirty();
    resetState(s);
    const fresh = createState();

    expect(s.clock.now()).toBe(fresh.clock.now());
    // the log is back to exactly what a fresh state seeds (the player's birth)
    expect(s.eventLog.size()).toBe(fresh.eventLog.size());
    expect(s.eventLog.since(0).map(e => e.event)).toEqual(fresh.eventLog.since(0).map(e => e.event));
    // the stale rival spirit is gone; the player is back
    expect([...s.spirits.keys()]).toEqual([...fresh.spirits.keys()]);
    expect(s.spirits.get('player')).toEqual(fresh.spirits.get('player'));
    expect(s.camera).toEqual(fresh.camera);
    expect(s.surfacedInbox.size).toBe(0);
    expect(s.plotThreads.serialize()).toEqual(fresh.plotThreads.serialize());
    expect(s.staging.serialize()).toEqual(fresh.staging.serialize());
    expect(s.fateArcs.serialize()).toEqual(fresh.fateArcs.serialize());
    expect(s.chronicle.serialize()).toEqual(fresh.chronicle.serialize());
    expect(s.runtimePois.serialize()).toEqual(fresh.runtimePois.serialize());
    expect(s.crossingTiers.serialize()).toEqual(fresh.crossingTiers.serialize());
    expect(s.adoptions.serialize()).toEqual(fresh.adoptions.serialize());
  });

  it('replaces every non-identity-stable field with its fresh value', () => {
    const s = dirty();
    resetState(s);
    const fresh = createState();
    for (const key of Object.keys(fresh)) {
      if (identityStableFields().has(key as keyof GameState)) continue;
      const got = (s as unknown as Record<string, unknown>)[key];
      const want = (fresh as unknown as Record<string, unknown>)[key];
      // `rng`, `roadUse` and `contention` are class instances a fresh state
      // rebuilds identically — toEqual compares their own enumerable state, which
      // is exactly the "is this world data gone?" question we care about.
      expect(got, `field '${key}' survived resetState with stale data`).toEqual(want);
    }
  });

  it('leaves no trace of the previous world behind', () => {
    const s = dirty();
    resetState(s);
    // the load-bearing ones, asserted by name so a failure reads plainly
    expect(s.map).toBeNull();
    expect(s.world).toBeNull();
    expect(s.worldSeed).toBeNull();
    expect(s.visualMap).toBeNull();
    expect(s.blobMap).toBeNull();
    expect(s.biomeMap).toBeNull();
    expect(s.terrainFields).toBeNull();
    expect(s.weather).toBeNull();
    expect(s.floodWatch).toBeNull();
    expect(s.causalSites).toBeNull();
    expect(s.trample).toBeNull();
    expect(s.cohorts.size).toBe(0);
    expect(s.selectedNpcId).toBeNull();
    expect(s.selectedBuildingId).toBeNull();
    expect(s.selectedCausalSiteId).toBeNull();
    expect(s.selectedPoiId).toBeNull();
    expect(s.pinnedNpcId).toBeNull();
    expect(s.cameraFly).toBeNull();
    expect(s.followNpc).toBe(false);
    expect(s.cameraLock).toEqual({ mode: 'free' });
    expect(s.waterLevelM).toBe(0);
    expect(s.generatedDecorations).toEqual([]);
    expect(s.roadUse.sinceTick).toBe(-1);
    expect(s.settlementAggregates.computedTick).toBe(-1);
    expect(s.settlementAggregates.size()).toBe(0);
    expect(s.settlementFlux.sinceTick).toBe(-1);
    expect(s.settlementFlux.activePairs()).toBe(0);
    expect(s.fateSettlementDigestBaseline.size()).toBe(0);
  });

  it('keeps event-log SUBSCRIBERS attached across the reset', () => {
    // Autosave and the chronicler subscribe once, at construction. A reset that
    // dropped subscribers would silently stop persisting the next world.
    const s = createState();
    let seen = 0;
    s.eventLog.subscribe(() => { seen++; });
    resetState(s);
    s.eventLog.append({ type: 'spirit_birth', spiritId: 'p2', name: 'N', isPlayer: false });
    expect(seen).toBe(1);
  });

  it('is idempotent — resetting twice equals resetting once', () => {
    const a = dirty(); resetState(a);
    const b = dirty(); resetState(b); resetState(b);
    for (const key of Object.keys(createState())) {
      if (key === 'eventLog' || key === 'clock') continue; // compared via API below
      expect((b as unknown as Record<string, unknown>)[key]).toEqual((a as unknown as Record<string, unknown>)[key]);
    }
    expect(b.eventLog.size()).toBe(a.eventLog.size());
    expect(b.clock.now()).toBe(a.clock.now());
  });

  it('a reset state is usable — the player can act again', () => {
    const s = dirty();
    resetState(s);
    const player = s.spirits.get('player');
    expect(player).toBeDefined();
    expect(player!.isPlayer).toBe(true);
    expect(player!.power).toBeGreaterThan(0); // the slice-1 stipend is back
    // and the RNG is a working, freshly-seeded stream
    expect(s.rng.getState()).toEqual(createState().rng.getState());
    const first = s.rng.next();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });

  it('produces the SAME rng stream a fresh state would', () => {
    // Determinism is the whole contract: a world started after quit-to-title must
    // roll identically to one started from a cold boot.
    const s = dirty();
    s.rng.next(); s.rng.next(); s.rng.next();
    resetState(s);
    const fresh = createState();
    expect([s.rng.next(), s.rng.next(), s.rng.next()])
      .toEqual([fresh.rng.next(), fresh.rng.next(), fresh.rng.next()]);
  });
});
