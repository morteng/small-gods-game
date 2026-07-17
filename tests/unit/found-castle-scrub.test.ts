// M4 S2 — the risky slice: found a castle at runtime, then prove the scrub
// reconcile in BOTH directions (spike §4 S2). The seam under test is the barrier
// dual representation — wall ENTITIES restore from Snapshot.entities while wall
// RUNS (+ earthworks) are map-level state reconciled from the RuntimePoiStore —
// and the REMOVAL direction of the deformation rebuild, which had never run
// before this slice. The composed-heightfield check runs twice: through the real
// memoized path (the end-to-end contract) AND through an unmemoized compose (so
// a cache hit can't mask a broken removal rebuild).
import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { foundCastle } from '@/world/found-castle';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { getComposedHeightfield } from '@/world/road-deformation';
import { DeformationStore, heightAt } from '@/world/terrain-deformation';
import { buildEarthworkDeformations } from '@/world/earthwork-deformation';
import { buildBarrierDeformations } from '@/world/barrier-deformation';
import { buildDitchDeformations } from '@/world/ditch-deformation';
import { heightMetresAt } from '@/world/heightfield';
import { toSaveFile, applySaveFile } from '@/core/save-file';
import type { GameMap, WorldSeed, Entity } from '@/core/types';

function makeWs(): WorldSeed {
  return {
    name: 'm4-s2-scrub', size: { width: 64, height: 64 }, biome: 'temperate',
    pois: [], connections: [], constraints: [],
  } as unknown as WorldSeed;
}

async function makeState() {
  const ws = makeWs();
  const { map, world } = await generateWithNoise(64, 64, 7, ws);
  const state = createState();
  state.map = map;
  state.world = world;
  state.worldSeed = ws;   // fresh-gen path: same reference as map.worldSeed
  return { state, map, world };
}

/** Lowest interior cell — guarantees the motte is genuinely needed, so the
 *  foundation always commits earthworks (mirrors place-complex.test.ts). */
function lowestCell(map: GameMap): { x: number; y: number } {
  let centre = { x: 32, y: 32 }, lowest = Infinity;
  for (let y = 12; y < 52; y++) for (let x = 12; x < 52; x++) {
    const h = heightMetresAt(map, x, y);
    if (h < lowest) { lowest = h; centre = { x, y }; }
  }
  return centre;
}

/** Compose the map's earthwork/barrier/ditch deformations WITHOUT the memoised
 *  store/field caches — a fresh store from the map's current arrays, sampled per
 *  tile — so the removal-direction rebuild is exercised for real (a cached
 *  pre-castle field can't fake a pass). */
function composeUnmemoized(map: GameMap): Float32Array {
  const store = new DeformationStore();
  store.add(...buildEarthworkDeformations(map.earthworks ?? []));
  store.add(...buildBarrierDeformations(map));
  store.add(...buildDitchDeformations(map));
  const out = new Float32Array(map.width * map.height);
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      out[ty * map.width + tx] = heightAt(map, store, tx, ty);
    }
  }
  return out;
}

describe('foundCastle (M4 S2)', () => {
  it('founds a first-class, ownership-tagged castle', async () => {
    const { state, map, world } = await makeState();
    state.clock.advance(1234);           // ms — ticks derived by the clock
    const bornTick = state.clock.now();
    const centre = lowestCell(map);

    const res = foundCastle(world, map, state, {
      centre, seed: 7, era: 'medieval', cause: 'lord:test',
    });
    expect(res).toBeTruthy();
    expect(res!.poiId).toBe('castle:0001');

    // Physical stamp committed AND owned.
    const ownedEw = (map.earthworks ?? []).filter(e => e.ownerPoiId === res!.poiId);
    const ownedRuns = (map.barrierRuns ?? []).filter(b => b.ownerPoiId === res!.poiId);
    expect(ownedEw.length).toBeGreaterThan(0);          // motte/ditch on the lowest cell
    expect(ownedRuns.length).toBe(2);                   // both palisade rings
    // The store entry records the same stamp (source of truth for the reconcile).
    const entry = state.runtimePois.byId(res!.poiId)!;
    expect(entry.earthworks).toHaveLength(ownedEw.length);
    expect(entry.barrierRuns).toHaveLength(ownedRuns.length);
    expect(entry.provenance).toEqual({ bornTick, cause: 'lord:test', complexTypeId: 'motte_and_bailey' });
    expect(bornTick).toBeGreaterThan(0);

    // Entities minted under the poiId prefix (two castles can never collide).
    const ents = world.query({}) as Entity[];
    const castleEnts = ents.filter(e => String(e.id).startsWith(`${res!.poiId}:`));
    expect(castleEnts.filter(e => e.kind.endsWith('_run')).length).toBe(2);
    expect(castleEnts.some(e => String(e.id).includes('castle_keep'))).toBe(true);

    // Directory projection: a real, runtime-flagged POI in the canonical table.
    const listed = state.worldSeed!.pois.find(p => p.id === res!.poiId);
    expect(listed).toBeTruthy();
    expect(listed!.runtime).toBe(true);
    expect(map.worldSeed!.pois.some(p => p.id === res!.poiId)).toBe(true);
  });

  it('scrub before the foundation un-builds the castle; scrub forward rebuilds it byte-consistently', async () => {
    const { state, map, world } = await makeState();
    state.clock.advance(1000);

    // Pre-castle reference: composed field through BOTH paths + map arrays.
    const preField = getComposedHeightfield(map).slice();
    const preUnmemo = composeUnmemoized(map);
    const before = captureSnapshot(state);

    state.clock.advance(1000);
    const centre = lowestCell(map);
    const res = foundCastle(world, map, state, {
      centre, seed: 7, era: 'medieval', cause: 'lord:test',
    })!;
    expect(res).toBeTruthy();
    const after = captureSnapshot(state);

    // The castle genuinely moved the ground (else the removal test proves nothing).
    const postField = getComposedHeightfield(map).slice();
    const postUnmemo = composeUnmemoized(map);
    expect(postField).not.toEqual(preField);
    expect(postUnmemo).not.toEqual(preUnmemo);
    const postOwnedEw = structuredClone((map.earthworks ?? []).filter(e => e.ownerPoiId === res.poiId));
    const postOwnedRuns = structuredClone((map.barrierRuns ?? []).filter(b => b.ownerPoiId === res.poiId));
    expect(postOwnedEw.length).toBeGreaterThan(0);
    expect(postOwnedRuns.length).toBe(2);

    // ── REMOVAL direction (never exercised before this slice) ──────────────
    restoreSnapshot(state, before);
    const m = state.map!;
    expect((m.earthworks ?? []).some(e => e.ownerPoiId)).toBe(false);
    expect((m.barrierRuns ?? []).some(b => b.ownerPoiId)).toBe(false);
    // Entities gone with the snapshot (restore rebuilds the World — use state.world).
    expect((state.world!.query({}) as Entity[]).some(e => String(e.id).startsWith(`${res.poiId}:`))).toBe(false);
    // Directory clean, store empty.
    expect(state.worldSeed!.pois.some(p => p.id === res.poiId)).toBe(false);
    expect(m.worldSeed!.pois.some(p => p.id === res.poiId)).toBe(false);
    expect(state.runtimePois.all()).toHaveLength(0);
    // The ground healed: unmemoized rebuild (the honest check) AND the live
    // memoized path both byte-match the pre-castle field — no wall footings, no
    // motte, no ditch left carved into the terrain.
    expect(composeUnmemoized(m)).toEqual(preUnmemo);
    expect(getComposedHeightfield(m).slice()).toEqual(preField);

    // ── FORWARD direction: the walls come back, byte-consistent ────────────
    restoreSnapshot(state, after);
    const m2 = state.map!;
    const ewBack = (m2.earthworks ?? []).filter(e => e.ownerPoiId === res.poiId);
    const runsBack = (m2.barrierRuns ?? []).filter(b => b.ownerPoiId === res.poiId);
    expect(structuredClone(ewBack)).toEqual(postOwnedEw);
    expect(structuredClone(runsBack)).toEqual(postOwnedRuns);
    // The dual-representation seam: barrier ENTITIES (snapshot) and barrier RUNS
    // (store reconcile) in lockstep — every owned run has its entity, every
    // castle ring entity has its run, no ghost walls / floating footings.
    const ents = state.world!.query({}) as Entity[];
    const entIds = new Set(ents.map(e => String(e.id)));
    for (const b of runsBack) expect(entIds.has(b.id)).toBe(true);
    const ringEnts = ents.filter(e => String(e.id).startsWith(`${res.poiId}:`) && e.kind.endsWith('_run'));
    expect(ringEnts.length).toBe(runsBack.length);
    expect(ents.some(e => String(e.id).includes('castle_keep'))).toBe(true);
    // Directory + store back; the ground carries the motte again, byte-identical.
    expect(state.worldSeed!.pois.some(p => p.id === res.poiId)).toBe(true);
    expect(state.runtimePois.byId(res.poiId)).toBeTruthy();
    expect(composeUnmemoized(m2)).toEqual(postUnmemo);
    expect(getComposedHeightfield(m2).slice()).toEqual(postField);
  });

  it('save → load → scrub: the castle survives the save and still un-builds cleanly', async () => {
    const { state, map, world } = await makeState();
    state.clock.advance(500);
    const before = captureSnapshot(state);
    state.clock.advance(500);
    const res = foundCastle(world, map, state, {
      centre: lowestCell(map), seed: 7, era: 'medieval', cause: 'lord:test',
    })!;
    expect(res).toBeTruthy();

    const loaded = createState();
    expect(applySaveFile(loaded, toSaveFile(state, 1))).toBe(true);

    // The save's worldSeed carried the projection verbatim; hydrate+reconcile
    // re-asserts it exactly once (no dupes, no orphans) on BOTH worldSeed clones,
    // which are DISTINCT objects on the load path.
    expect(loaded.worldSeed).not.toBe(loaded.map!.worldSeed);
    expect(loaded.worldSeed!.pois.filter(p => p.id === res.poiId)).toHaveLength(1);
    expect(loaded.map!.worldSeed!.pois.filter(p => p.id === res.poiId)).toHaveLength(1);
    expect(loaded.runtimePois.byId(res.poiId)).toBeTruthy();
    expect((loaded.map!.earthworks ?? []).some(e => e.ownerPoiId === res.poiId)).toBe(true);
    expect((loaded.map!.barrierRuns ?? []).filter(b => b.ownerPoiId === res.poiId)).toHaveLength(2);
    expect((loaded.world!.query({}) as Entity[]).some(e => String(e.id).startsWith(`${res.poiId}:`))).toBe(true);

    // Scrub the LOADED world to before the foundation: fully un-built.
    restoreSnapshot(loaded, before);
    expect(loaded.runtimePois.all()).toHaveLength(0);
    expect(loaded.worldSeed!.pois.some(p => p.id === res.poiId)).toBe(false);
    expect(loaded.map!.worldSeed!.pois.some(p => p.id === res.poiId)).toBe(false);
    expect((loaded.map!.earthworks ?? []).some(e => e.ownerPoiId)).toBe(false);
    expect((loaded.map!.barrierRuns ?? []).some(b => b.ownerPoiId)).toBe(false);
    expect((loaded.world!.query({}) as Entity[]).some(e => String(e.id).startsWith(`${res.poiId}:`))).toBe(false);
  });
});
