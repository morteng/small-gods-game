// M4 S1 — RuntimePoiStore: snapshot-authoritative runtime POIs, directory
// projection, physical-stamp reconcile primitives, and the two terrain-inertness
// guards (spike: docs/superpowers/2026-07-17-m4-runtime-poi-spike.md §3/§4/§7).
import { describe, it, expect } from 'vitest';
import {
  RuntimePoiStore, projectRuntimePois, reconcileRuntimePoiStamps,
  type RuntimePoiEntry,
} from '@/world/runtime-poi';
import { getHeightfield, clearHeightfieldCache } from '@/world/heightfield';
import { applyPoiInfluences } from '@/terrain/poi-influence';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { World } from '@/world/world';
import type { GameMap, POI, Tile, WorldSeed, TerrainField, TerrainConfig } from '@/core/types';
import type { Earthwork } from '@/blueprint/connectome/earthworks';
import type { PlacedBarrier } from '@/world/barrier';

function makeEntry(store: RuntimePoiStore, x = 5, y = 5): RuntimePoiEntry {
  const id = store.allocateId('castle');
  const entry: RuntimePoiEntry = {
    poi: { id, type: 'castle', name: `Keep ${id}`, position: { x, y }, runtime: true },
    provenance: { bornTick: 0, cause: 'test', complexTypeId: 'motte_and_bailey' },
    earthworks: [],
    barrierRuns: [],
  };
  store.add(entry);
  return entry;
}

function makeWs(pois: POI[] = []): WorldSeed {
  return {
    name: 'runtime-poi-test', size: { width: 10, height: 10 }, biome: 'temperate',
    pois, connections: [], constraints: [],
  } as unknown as WorldSeed;
}

describe('RuntimePoiStore', () => {
  it('allocates deterministic castle:NNNN ids that never match the causal-site prefix', () => {
    const store = new RuntimePoiStore();
    const a = store.allocateId();
    const b = store.allocateId();
    expect(a).toBe('castle:0001');
    expect(b).toBe('castle:0002');
    // `isSiteId` (fate-tools.ts) gates causal sites out of settlement behaviour by
    // the `causal:` prefix — a runtime castle must NOT trip it (spike §1.4).
    expect(a.startsWith('causal:')).toBe(false);
  });

  it('serialize/hydrate round-trips entries + the id counter, without aliasing', () => {
    const store = new RuntimePoiStore();
    const e1 = makeEntry(store, 3, 4);
    e1.earthworks.push({ kind: 'motte', centre: { x: 3, y: 4 }, topRadius: 4, height: 6, slope: 1.5, volume: 100, ownerPoiId: e1.poi.id } as Earthwork);
    const snap = store.serialize();

    const fresh = new RuntimePoiStore();
    fresh.hydrate(snap);
    expect(fresh.all()).toHaveLength(1);
    expect(fresh.byId('castle:0001')?.poi.name).toBe(e1.poi.name);
    expect(fresh.byId('castle:0001')?.earthworks[0].ownerPoiId).toBe('castle:0001');
    // No aliasing in either direction: the hydrated store owns clones.
    fresh.byId('castle:0001')!.poi.name = 'mutated';
    expect(snap.entries[0].poi.name).toBe(e1.poi.name);
    expect(e1.poi.name).not.toBe('mutated');
  });

  it('id counter is monotonic across hydrate — a re-found after a scrub never collides', () => {
    const store = new RuntimePoiStore();
    makeEntry(store);
    makeEntry(store);
    const snap = store.serialize();     // nextId = 3 captured
    const restored = new RuntimePoiStore();
    restored.hydrate(snap);
    expect(restored.allocateId()).toBe('castle:0003');
  });

  it('add() forces runtime: true (the flag every guard keys on)', () => {
    const store = new RuntimePoiStore();
    const id = store.allocateId();
    store.add({
      poi: { id, type: 'castle', position: { x: 1, y: 1 } },   // flag "forgotten"
      provenance: { bornTick: 0, cause: 'test', complexTypeId: 'motte_and_bailey' },
      earthworks: [], barrierRuns: [],
    });
    expect(store.byId(id)!.poi.runtime).toBe(true);
  });
});

describe('projectRuntimePois', () => {
  it('reconciles the directory: authored ∪ store, orphans removed, idempotent', () => {
    const store = new RuntimePoiStore();
    const authored: POI = { id: 'village_1', type: 'village', position: { x: 2, y: 2 } };
    // A STALE projection (e.g. a save whose worldSeed carried a castle the
    // restored store no longer has) must be dropped as an orphan.
    const stale: POI = { id: 'castle:0099', type: 'castle', position: { x: 8, y: 8 }, runtime: true };
    const ws = makeWs([authored, stale]);

    const live = makeEntry(store, 5, 5);
    projectRuntimePois(store, [ws]);
    expect(ws.pois.map(p => p.id)).toEqual(['village_1', live.poi.id]);
    expect(ws.pois.find(p => p.id === live.poi.id)?.runtime).toBe(true);

    projectRuntimePois(store, [ws]);   // idempotent
    expect(ws.pois.map(p => p.id)).toEqual(['village_1', live.poi.id]);

    store.reset();                      // scrub-back analogue
    projectRuntimePois(store, [ws]);
    expect(ws.pois.map(p => p.id)).toEqual(['village_1']);
  });

  it('reconciles BOTH worldSeed clones (state + map diverge on the load path)', () => {
    const store = new RuntimePoiStore();
    const wsState = makeWs();
    const wsMap = makeWs();
    makeEntry(store);
    projectRuntimePois(store, [wsState, wsMap, null, wsState /* dupes tolerated */]);
    expect(wsState.pois).toHaveLength(1);
    expect(wsMap.pois).toHaveLength(1);
  });
});

describe('reconcileRuntimePoiStamps', () => {
  const ew = (owner?: string): Earthwork =>
    ({ kind: 'motte', centre: { x: 5, y: 5 }, topRadius: 3, height: 4, slope: 1.5, volume: 50, ownerPoiId: owner } as Earthwork);
  const run = (id: string, owner?: string): PlacedBarrier =>
    ({ id, run: { kind: 'palisade', path: [[0, 0], [1, 0]], gates: [], height: 1, thickness: 1, material: 'timber' }, ownerPoiId: owner });

  it('drops orphaned owned entries, keeps unowned, re-appends the store stamps', () => {
    const store = new RuntimePoiStore();
    const entry = makeEntry(store);
    entry.earthworks.push(ew(entry.poi.id));
    entry.barrierRuns.push(run('live-ring', entry.poi.id));

    const map = {
      earthworks: [ew(undefined), ew('castle:0099')],          // authored + orphan
      barrierRuns: [run('gen-ring'), run('ghost', 'castle:0099')],
    } as unknown as GameMap;

    reconcileRuntimePoiStamps(map, store);
    expect(map.earthworks!.map(e => e.ownerPoiId)).toEqual([undefined, entry.poi.id]);
    expect(map.barrierRuns!.map(b => b.id)).toEqual(['gen-ring', 'live-ring']);

    // Removal direction: an empty store leaves only the unowned entries.
    store.reset();
    reconcileRuntimePoiStamps(map, store);
    expect(map.earthworks!.map(e => e.ownerPoiId)).toEqual([undefined]);
    expect(map.barrierRuns!.map(b => b.id)).toEqual(['gen-ring']);
  });

  it('never materialises empty arrays on maps that lack the fields (stub parity)', () => {
    const map = {} as GameMap;
    reconcileRuntimePoiStamps(map, new RuntimePoiStore());
    expect(map.earthworks).toBeUndefined();
    expect(map.barrierRuns).toBeUndefined();
  });
});

// ── Snapshot integration: scrub-back un-exists a runtime POI ─────────────────

function attachWorld(state: ReturnType<typeof createState>): void {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 10; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 10; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'void' });
    tiles.push(row);
  }
  const ws = makeWs([{ id: 'village_1', type: 'village', position: { x: 2, y: 2 } }]);
  const map: GameMap = {
    tiles, width: 10, height: 10, villages: [], seed: 1, success: true,
    worldSeed: ws, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.worldSeed = ws;   // same reference on the fresh-gen path (both reconciled anyway)
  state.world = new World(map);
}

describe('runtime POIs across snapshot restore', () => {
  it('a scrub to before the foundation un-lists the POI from every directory', () => {
    const s = createState();
    attachWorld(s);
    const before = captureSnapshot(s);

    const entry = makeEntry(s.runtimePois, 5, 5);
    projectRuntimePois(s.runtimePois, [s.worldSeed, s.map!.worldSeed]);
    expect(s.worldSeed!.pois.some(p => p.id === entry.poi.id)).toBe(true);
    const after = captureSnapshot(s);

    restoreSnapshot(s, before);
    expect(s.runtimePois.all()).toHaveLength(0);
    expect(s.worldSeed!.pois.some(p => p.id === entry.poi.id)).toBe(false);
    expect(s.map!.worldSeed!.pois.some(p => p.id === entry.poi.id)).toBe(false);
    expect(s.worldSeed!.pois.some(p => p.id === 'village_1')).toBe(true);   // authored intact

    restoreSnapshot(s, after);   // scrub forward: the projection re-asserts
    expect(s.runtimePois.byId(entry.poi.id)).toBeTruthy();
    expect(s.worldSeed!.pois.some(p => p.id === entry.poi.id)).toBe(true);
  });

  it('a pre-M4 snapshot (no runtimePois field) restores to an empty store + clean directory', () => {
    const s = createState();
    attachWorld(s);
    const entry = makeEntry(s.runtimePois, 5, 5);
    projectRuntimePois(s.runtimePois, [s.worldSeed, s.map!.worldSeed]);
    const snap = captureSnapshot(s);
    delete snap.runtimePois;   // simulate an older save's snapshot
    restoreSnapshot(s, snap);
    expect(s.runtimePois.all()).toHaveLength(0);
    expect(s.worldSeed!.pois.some(p => p.id === entry.poi.id)).toBe(false);
  });
});

// ── The two terrain-inertness guards (spike §1.5 / §3.3) ─────────────────────

describe('runtime POIs are heightfield-inert', () => {
  const runtimeCastle: POI = { id: 'castle:0001', type: 'castle', position: { x: 10, y: 10 }, runtime: true };
  const authoredCastle: POI = { id: 'castle_gen', type: 'castle', position: { x: 10, y: 10 } };
  const mountain: POI = { id: 'mt', type: 'mountain', position: { x: 24, y: 24 } };

  it('poiHeightSignature: adding a runtime castle changes neither the memo key nor the array identity', () => {
    clearHeightfieldCache();
    const base = getHeightfield(3, 32, 32, null, [mountain], null);
    const withRuntime = getHeightfield(3, 32, 32, null, [mountain, runtimeCastle], null);
    expect(withRuntime).toBe(base);   // memo HIT — same key, same Float32Array instance

    // Control (proves the guard is what makes it inert): an AUTHORED castle has an
    // elevation cap → new key → a different array instance.
    const withAuthored = getHeightfield(3, 32, 32, null, [mountain, authoredCastle], null);
    expect(withAuthored).not.toBe(base);
  });

  it('applyPoiInfluences: a runtime castle moves NO field; an authored one does', () => {
    const w = 32, h = 32;
    const mk = (): TerrainField => ({
      elevation: new Float32Array(w * h).fill(0.9),   // above the 0.68 castle cap
      moisture: new Float32Array(w * h).fill(0.5),
      temperature: new Float32Array(w * h).fill(0.5),
    });
    const config: TerrainConfig = { seed: 3, width: w, height: h };

    const baseline = mk();
    const inert = mk();
    applyPoiInfluences(inert, [runtimeCastle], config);
    expect(inert.elevation).toEqual(baseline.elevation);       // byte-identical: no influence
    expect(inert.moisture).toEqual(baseline.moisture);
    expect(inert.temperature).toEqual(baseline.temperature);

    const capped = mk();
    applyPoiInfluences(capped, [authoredCastle], config);
    expect(capped.elevation).not.toEqual(baseline.elevation);  // the cap bit — control
  });
});
