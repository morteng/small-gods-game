// M4 S3 — SIM ADOPTION of a runtime castle (spike §4 S3, consumer map §2).
//
// The spike's load-bearing finding: the settlement-grade systems key off NPC
// `homePoiId`, not the POI table — so a founded castle joins the sim the moment
// a garrison is homed there. This file PROVES that end-to-end on a real
// generated world:
//   • settlement events roll at the castle (forced-event path, deterministic);
//   • LordSystem crowns a noble homed there (the M3 seat arrives automatically)
//     and counts the garrison soldiers;
//   • Fate's drift guard admits the castle (describeLordsForFate enumerates it,
//     set_lord_stance validates) and the PROJECTED name rides the digest;
//   • the M6 Peace of God can bind the castle's lord (proclaim_peace end-to-end
//     through the command executor);
//   • perception's statistical-tier anchor resolves the PROJECTED table entry
//     (the §1.2 "silently skipped" fragility, closed by projection);
//   • a runtime POI founded AFTER WaterDynamics init is storm-targetable
//     (the §1.7 init-time poiPos gap, closed by the live-directory fallback).
//
// Per §7 Decision 3 the castle gets a NAMED garrison only — no statistical
// cohort band is seeded (rival claims keying off cohorts.keys() therefore skip
// a fresh castle by design; not asserted here, it is the absence of a thing).
import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { foundCastle } from '@/world/found-castle';
import { createState } from '@/core/state';
import { createRng } from '@/core/rng';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { World } from '@/world/world';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { heightMetresAt } from '@/world/heightfield';
import { LordSystem } from '@/sim/systems/lord-system';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { PerceptionSystem, cohortPerceptionReach } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { emptySettlementCohorts, beliefContribution, dominantCohortBelief } from '@/sim/cohorts';
import { RuntimePoiStore, projectRuntimePois } from '@/world/runtime-poi';
import { describeLordsForFate } from '@/game/fate/fate-context';
import { setLordStancePrecondition } from '@/sim/command/authoring-verbs';
import { executeCommand } from '@/sim/command/command-system';
import { WaterDynamics } from '@/render/gpu/water-dynamics';
import type { GameMap, WorldSeed, Entity, Tile, NpcRole } from '@/core/types';
import type { SystemContext } from '@/core/scheduler';

function makeWs(): WorldSeed {
  return {
    name: 'm4-s3-adoption', size: { width: 64, height: 64 }, biome: 'temperate',
    pois: [], connections: [], constraints: [],
  } as unknown as WorldSeed;
}

async function makeState() {
  const ws = makeWs();
  const { map, world } = await generateWithNoise(64, 64, 7, ws);
  const state = createState();
  state.map = map;
  state.world = world;
  state.worldSeed = ws;
  return { state, map, world };
}

/** Lowest interior cell — same siting as found-castle-scrub.test.ts, so the
 *  foundation always commits (the motte is genuinely needed). */
function lowestCell(map: GameMap): { x: number; y: number } {
  let centre = { x: 32, y: 32 }, lowest = Infinity;
  for (let y = 12; y < 52; y++) for (let x = 12; x < 52; x++) {
    const h = heightMetresAt(map, x, y);
    if (h < lowest) { lowest = h; centre = { x, y }; }
  }
  return centre;
}

/** Home an NPC at the castle: role + homePoiId + a devotion the M6 pool can draw. */
function homeNpc(
  world: World, id: string, role: NpcRole, poiId: string,
  at: { x: number; y: number }, devotion = 0.3,
): Entity {
  const props = initNpcProps(id, role, 7);
  props.homePoiId = poiId;
  props.homeX = at.x; props.homeY = at.y;
  props.beliefs.player.faith = 0.5;
  props.beliefs.player.devotion = devotion;
  const e: Entity = { id, kind: 'npc', x: at.x, y: at.y, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function sysCtx(state: ReturnType<typeof createState>, seed = 1): SystemContext {
  return {
    world: state.world!, spirits: state.spirits, log: state.eventLog,
    clock: state.clock, rng: createRng(seed), dt: 1000, now: state.clock.now(),
  };
}

describe('castle sim adoption (M4 S3)', () => {
  it('garrison homed at the castle → events roll, a lord rises, Fate admits him, the Peace binds him', async () => {
    const { state, map, world } = await makeState();
    state.clock.advance(1000);

    const res = foundCastle(world, map, state, {
      centre: lowestCell(map), seed: 7, era: 'medieval', cause: 'lord:test', name: 'Hardknot Keep',
    })!;
    expect(res).toBeTruthy();
    const castleId = res.poiId;
    const c = res.poi.position!;

    // NAMED garrison only (§7 Decision 3): a noble + two soldiers homed there.
    const noble = homeNpc(world, 'noble-1', 'noble', castleId, { x: c.x + 1, y: c.y + 1 });
    homeNpc(world, 'soldier-1', 'soldier', castleId, { x: c.x + 2, y: c.y + 1 });
    homeNpc(world, 'soldier-2', 'soldier', castleId, { x: c.x + 2, y: c.y + 2 });

    // ── Settlement events adopt the poiId the moment residents exist ─────────
    world.forcedEvents.set(castleId, 'raiders');
    new SettlementEventSystem().tick(sysCtx(state, 2));
    const active = world.activeEvents.get(castleId);
    expect(active).toBeTruthy();
    expect(active![0].type).toBe('raiders');
    expect(active![0].poiId).toBe(castleId);

    // ── LordSystem: the M3 seat arrives automatically (attachment) ────────────
    new LordSystem().tick(sysCtx(state, 3));
    const seat = world.lords.get(castleId);
    expect(seat).toBeTruthy();
    expect(seat!.npcId).toBe(noble.id);
    expect(seat!.garrison).toBe(2);
    const risen = state.eventLog.since(0).map(a => a.event)
      .filter(e => e.type === 'lord_risen' && e.poiId === castleId);
    expect(risen).toHaveLength(1);

    // ── Fate's drift guard + the PROJECTED display name ───────────────────────
    const { text, lordPoiIds } = describeLordsForFate(state);
    expect(lordPoiIds.has(castleId)).toBe(true);
    expect(text).toContain('Hardknot Keep');           // table entry, not a raw id
    expect(setLordStancePrecondition(
      { verb: 'set_lord_stance', source: 'fate', target: { kind: 'settlement', poiId: castleId }, payload: { tithe: 0.1 }, seq: 0 },
      { world, spirits: state.spirits, log: state.eventLog },
    )).toBeNull();

    // ── M6: the Peace of God binds the castle's armed men ─────────────────────
    // Congregation devotion pool = 3 × 0.3 = 0.9 ≥ PROCLAIM_PEACE_DEVOTION_COST.
    const result = executeCommand(
      { verb: 'proclaim_peace', source: 'player', target: { kind: 'settlement', poiId: castleId }, seq: 1 },
      { world, spirits: state.spirits, log: state.eventLog, rng: createRng(4), now: state.clock.now() },
    );
    expect(result.status).toBe('applied');
    expect(seat!.peace).toBeTruthy();
    expect(seat!.peace!.sworn).toContain(noble.id);     // the lord swore
    expect(seat!.peace!.sworn).toContain('soldier-1');  // and his men
    expect(seat!.peace!.sworn).toContain('soldier-2');
    expect(npcProps(noble).role).toBe('noble');
  });

  it('a runtime castle founded AFTER WaterDynamics init is storm-targetable (floodPoi live fallback)', async () => {
    const { state, map, world } = await makeState();
    const wd = new WaterDynamics(map);                  // init-time poiPos: empty directory
    const res = foundCastle(world, map, state, {
      centre: lowestCell(map), seed: 7, era: 'medieval', cause: 'lord:test',
    })!;
    expect(res).toBeTruthy();
    // The init-time map missed it; the live-directory fallback resolves it.
    const cells = wd.floodPoi(res.poiId, 4, 0.5);
    expect(cells).toBeGreaterThan(0);
    expect(wd.hasFlood()).toBe(true);
    // A genuinely unknown id still declines cleanly.
    expect(wd.floodPoi('castle:9999', 4, 0.5)).toBe(0);
  });
});

// ── Perception statistical anchor: the projection closes §1.2's silent skip ────

function makeGrassMap(w: number, h: number, ws: WorldSeed): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'void' });
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: ws, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

describe('perception anchors on a projected runtime POI (M4 S3)', () => {
  it('a cohort keyed by a runtime poiId opens its reach disc at the projected position', () => {
    const ws = { name: 'p', size: { width: 24, height: 24 }, biome: 'temperate', pois: [], connections: [], constraints: [] } as unknown as WorldSeed;
    const map = makeGrassMap(24, 24, ws);
    const world = new World(map);

    // A runtime castle, projected into the directory (no NPC believers at all —
    // any realization can only come from the statistical anchor).
    const store = new RuntimePoiStore();
    const id = store.allocateId('castle');
    store.add({
      poi: { id, type: 'castle', name: 'Anchor Keep', position: { x: 12, y: 12 }, runtime: true },
      provenance: { bornTick: 0, cause: 'test', complexTypeId: 'motte_and_bailey' },
      earthworks: [], barrierRuns: [],
    });
    projectRuntimePois(store, [ws]);

    // A statistical congregation at the castle (adult band, believers of 'player').
    const sc = emptySettlementCohorts(id);
    const adult = sc.bands.findIndex(b => b.ageMin >= 16);
    sc.bands[adult].count = 12;
    sc.bands[adult].belief['player'] = {
      sumFaith: 12 * 0.5, sumU: 12 * 0.3, sumD: 0,
      sumContribution: 12 * beliefContribution({ faith: 0.5, understanding: 0.3, devotion: 0 }),
      believerCount: 12, durableCount: 0,
    };
    expect(cohortPerceptionReach(dominantCohortBelief(sc)!)).toBeGreaterThan(0);
    const cohorts = new Map([[id, sc]]);

    const sys = new PerceptionSystem(identityOracle, () => map, undefined, () => cohorts);
    expect(map.tiles[12][12].state).toBe('void');
    sys.tick({
      world, log: new EventLog(new SimClock()), clock: new SimClock(),
      spirits: new Map(), rng: createRng(0), dt: 500, now: 1,
    });
    expect(map.tiles[12][12].state).toBe('realized');   // the anchor resolved

    // Control — the §1.2 fragility: WITHOUT the projection (an id the table
    // lacks) the same cohort is silently skipped and nothing realizes.
    const ws2 = { ...ws, pois: [] } as WorldSeed;
    const map2 = makeGrassMap(24, 24, ws2);
    const sys2 = new PerceptionSystem(identityOracle, () => map2, undefined, () => cohorts);
    sys2.tick({
      world: new World(map2), log: new EventLog(new SimClock()), clock: new SimClock(),
      spirits: new Map(), rng: createRng(0), dt: 500, now: 1,
    });
    expect(map2.tiles[12][12].state).toBe('void');
  });
});
