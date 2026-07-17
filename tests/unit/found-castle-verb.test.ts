// M4 S4 — the `found_castle` authoring verb (spike §4 S4).
//
// The lord's act, coached by Fate/dev: deterministic siting (siteSelect over a
// REAL candidate lattice — the spike's "feed it N hilltops"), the one-castle-
// per-seat gate, garrison rehoming through the S3-proven homePoiId seam,
// replay determinism from a snapshot, rejection paths that leave no partial
// state, and the spike §8.3 memo-key caveat: same-count stamp sets at
// DIFFERENT sites must not share a composed-heightfield cache entry.
import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { createState } from '@/core/state';
import { createRng } from '@/core/rng';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { World } from '@/world/world';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { executeCommand, previewCommand } from '@/sim/command/command-system';
import { GARRISON_SOLDIERS } from '@/sim/command/castle-verbs';
import { foundCastle, chooseCastleSite } from '@/world/found-castle';
import { RuntimePoiStore, reconcileRuntimePoiStamps } from '@/world/runtime-poi';
import { getComposedHeightfield } from '@/world/road-deformation';
import { heightMetresAt } from '@/world/heightfield';
import { makeLordState } from '@/sim/lord';
import { initNpcProps, npcProps, getNpc } from '@/world/npc-helpers';
import { isWaterTile } from '@/world/land-snap';
import type { GameMap, WorldSeed, Entity, Tile, NpcRole } from '@/core/types';
import type { ApplyCtx, Command } from '@/sim/command/types';

function makeWs(w = 96, h = 96): WorldSeed {
  return {
    name: 'm4-s4-verb', size: { width: w, height: h }, biome: 'temperate',
    pois: [], connections: [], constraints: [],
  } as unknown as WorldSeed;
}

async function makeTown(seed = 7) {
  const ws = makeWs();
  const { map, world } = await generateWithNoise(96, 96, seed, ws);
  const state = createState();
  state.map = map;
  state.world = world;
  state.worldSeed = ws;
  // An authored settlement in the directory (position is all the verb reads).
  ws.pois.push({ id: 'town_1', type: 'village', name: 'Milford', position: { x: 48, y: 48 } });
  return { state, map, world, ws };
}

function addNpc(world: World, id: string, role: NpcRole, poiId: string, x = 48, y = 48): Entity {
  const props = initNpcProps(id, role, 3);
  props.homePoiId = poiId;
  props.homeX = x; props.homeY = y;
  const e: Entity = { id, kind: 'npc', x, y, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function seatLord(world: World, poiId: string, nobleId: string): void {
  world.lords.set(poiId, makeLordState(getNpc(world, nobleId)!));
}

function applyCtx(state: ReturnType<typeof createState>, seed = 11): ApplyCtx {
  return {
    world: state.world!, spirits: state.spirits, log: state.eventLog,
    rng: createRng(seed), now: state.clock.now(), state,
  };
}

const CMD: Omit<Command, 'seq'> = {
  verb: 'found_castle', source: 'fate', target: { kind: 'settlement', poiId: 'town_1' },
};

describe('found_castle verb (M4 S4)', () => {
  it('rejects without a seated lord; with one, founds a castle, rehomes the garrison, logs the event', async () => {
    const { state, map, world, ws } = await makeTown();
    state.clock.advance(1000);

    // No seat → invalid_target (mortal power: only a lord builds).
    expect(previewCommand({ ...CMD, seq: 0 }, applyCtx(state))).toBe('invalid_target');

    const noble = addNpc(world, 'noble-1', 'noble', 'town_1');
    for (let i = 0; i < 6; i++) addNpc(world, `soldier-${i}`, 'soldier', 'town_1');
    seatLord(world, 'town_1', noble.id);

    const res = executeCommand({ ...CMD, seq: 1, payload: { name: 'Fist Keep' } }, applyCtx(state));
    expect(res.status).toBe('applied');

    // The runtime POI exists, provenance-gated to the founding seat.
    const entry = state.runtimePois.all()[0];
    expect(entry).toBeTruthy();
    expect(entry.provenance.foundedFromPoiId).toBe('town_1');
    expect(entry.provenance.cause).toBe('lord:noble-1');
    expect(entry.poi.name).toBe('Fist Keep');
    const castleId = entry.poi.id;
    expect(ws.pois.some(p => p.id === castleId && p.runtime)).toBe(true);

    // Deterministic siting: on dry land, outside the town, inside the lattice band.
    const c = entry.poi.position!;
    expect(isWaterTile(map, c.x, c.y)).toBe(false);
    const d = Math.hypot(c.x - 48, c.y - 48);
    expect(d).toBeGreaterThanOrEqual(20 + 6 - 1);        // outerR + clearance (motte_and_bailey)
    expect(d).toBeLessThanOrEqual(20 + 6 + 16 + 2);      // outermost band

    // Garrison rehomed: the lord + GARRISON_SOLDIERS men; the rest stay home.
    expect(npcProps(getNpc(world, noble.id)!).homePoiId).toBe(castleId);
    const soldierHomes = Array.from({ length: 6 }, (_, i) => npcProps(getNpc(world, `soldier-${i}`)!).homePoiId);
    expect(soldierHomes.filter(h => h === castleId)).toHaveLength(GARRISON_SOLDIERS);
    expect(soldierHomes.filter(h => h === 'town_1')).toHaveLength(6 - GARRISON_SOLDIERS);

    // The event is on the log (chronicler-consumed).
    const ev = state.eventLog.since(0).map(a => a.event).find(e => e.type === 'castle_founded');
    expect(ev).toBeTruthy();
    expect(ev).toMatchObject({ poiId: castleId, fromPoiId: 'town_1', lordNpcId: 'noble-1', name: 'Fist Keep' });

    // One castle per seat: a second issue is rejected, in preview AND execute.
    expect(previewCommand({ ...CMD, seq: 2 }, applyCtx(state))).toBe('precondition_failed');
    expect(executeCommand({ ...CMD, seq: 2 }, applyCtx(state)).status).toBe('rejected');
  });

  it('replays deterministically: same snapshot + same rng ⇒ identical castle id, site, and stamp', async () => {
    const { state, world } = await makeTown();
    state.clock.advance(500);
    const noble = addNpc(world, 'noble-1', 'noble', 'town_1');
    seatLord(world, 'town_1', noble.id);
    const before = captureSnapshot(state);

    const r1 = executeCommand({ ...CMD, seq: 1 }, applyCtx(state, 42));
    expect(r1.status).toBe('applied');
    const e1 = structuredClone(state.runtimePois.all()[0]);

    restoreSnapshot(state, before);
    expect(state.runtimePois.all()).toHaveLength(0);      // scrub un-founded it

    const r2 = executeCommand({ ...CMD, seq: 1 }, applyCtx(state, 42));
    expect(r2.status).toBe('applied');
    const e2 = structuredClone(state.runtimePois.all()[0]);

    expect(e2.poi.id).toBe(e1.poi.id);                    // counter restored by the snapshot
    expect(e2.poi.position).toEqual(e1.poi.position);
    expect(e2.earthworks).toEqual(e1.earthworks);
    expect(e2.barrierRuns).toEqual(e1.barrierRuns);
  });

  it('declines cleanly when no candidate site survives the land filter — no partial state', () => {
    // A world that is water everywhere except a too-small island: the lattice
    // margin (outer ring + 2) rejects every candidate.
    const w = 60, h = 60;
    const tiles: Tile[][] = [];
    for (let y = 0; y < h; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < w; x++) {
        const island = Math.abs(x - 30) <= 4 && Math.abs(y - 30) <= 4;
        row.push({ type: island ? 'grass' : 'shallow_water', x, y, walkable: island, state: 'realized' });
      }
      tiles.push(row);
    }
    const ws = makeWs(w, h);
    ws.pois.push({ id: 'town_1', type: 'village', position: { x: 30, y: 30 } });
    const map: GameMap = {
      tiles, width: w, height: h, villages: [], seed: 1, success: true,
      worldSeed: ws, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    };
    const state = createState();
    state.map = map;
    state.worldSeed = ws;
    state.world = new World(map);
    const noble = addNpc(state.world, 'noble-1', 'noble', 'town_1', 30, 30);
    seatLord(state.world, 'town_1', noble.id);

    expect(chooseCastleSite(map, { x: 30, y: 30 }, { seed: 1 })).toBeNull();
    const res = executeCommand({ ...CMD, seq: 1 }, applyCtx(state));
    expect(res).toEqual({ status: 'rejected', verb: 'found_castle', source: 'fate', reason: 'precondition_failed' });

    // NO partial state: store, stamps, entities, directory, garrison all untouched.
    expect(state.runtimePois.all()).toHaveLength(0);
    expect(map.earthworks ?? []).toHaveLength(0);
    expect(map.barrierRuns ?? []).toHaveLength(0);
    expect((state.world.query({}) as Entity[]).filter(e => String(e.id).startsWith('castle:'))).toHaveLength(0);
    expect(ws.pois.some(p => p.runtime)).toBe(false);
    expect(npcProps(getNpc(state.world, noble.id)!).homePoiId).toBe('town_1');
    expect(state.eventLog.since(0).map(a => a.event).some(e => e.type === 'castle_founded')).toBe(false);
  });
});

// ── The spike §8.3 caveat: same-count stamps at different sites must re-key ────

describe('deformation memo keys owned stamps by identity, not count (M4 S4)', () => {
  it('two same-count castle stamps at different sites compose different heightfields', async () => {
    const ws = makeWs(64, 64);
    const { map, world } = await generateWithNoise(64, 64, 7, ws);

    // Two genuinely different LOW sites (both need a motte ⇒ same earthwork mix).
    const low = (x0: number, x1: number): { x: number; y: number } => {
      let c = { x: x0, y: 32 }, lowest = Infinity;
      for (let y = 24; y < 44; y++) for (let x = x0; x < x1; x++) {
        const hm = heightMetresAt(map, x, y);
        if (hm < lowest) { lowest = hm; c = { x, y }; }
      }
      return c;
    };
    const siteA = low(24, 30);
    const siteB = low(38, 44);
    expect(siteA).not.toEqual(siteB);

    const found = (centre: { x: number; y: number }) => {
      const s = createState();
      s.map = map; s.world = world; s.worldSeed = ws;
      const r = foundCastle(world, map, s, { centre, seed: 7, era: 'medieval', cause: 'lord:test' })!;
      expect(r).toBeTruthy();
      return s;
    };

    // Castle at A → composed field fA. Strip the stamp (the scrub-back path),
    // then castle at B from a FRESH store — same id (castle:0001), same counts.
    const sA = found(siteA);
    const fA = getComposedHeightfield(map).slice();
    const countsA = {
      e: map.earthworks!.length,
      r: map.barrierRuns!.length,
    };
    reconcileRuntimePoiStamps(map, new RuntimePoiStore());
    expect(map.earthworks!.some(e => e.ownerPoiId)).toBe(false);
    // The reconcile strips MAP arrays only; in the real scrub path the World is
    // rebuilt from the snapshot. Mirror that here by removing A's entities so
    // B can mint under the same (deliberately colliding) id prefix.
    for (const e of world.query({}) as Entity[]) {
      if (String(e.id).startsWith('castle:0001:')) world.removeEntity(String(e.id));
    }

    const sB = found(siteB);
    const fB = getComposedHeightfield(map).slice();

    // The collision precondition genuinely holds: identical ids AND counts —
    // the old count-only key would serve fA's cache entry for B's map.
    expect(sB.runtimePois.all()[0].poi.id).toBe(sA.runtimePois.all()[0].poi.id);
    expect(map.earthworks!.length).toBe(countsA.e);
    expect(map.barrierRuns!.length).toBe(countsA.r);

    expect(fB).not.toEqual(fA);                            // the honest re-key
  });
});
