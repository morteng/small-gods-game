import { describe, it, expect } from 'vitest';
import { GarrisonSystem } from '@/sim/systems/garrison-system';
import { GARRISON_RING_CAP, GARRISON_STAND_DOWN_IDX, ringGarrisonGeometry } from '@/sim/garrison';
import { tickNpcMovementEntities } from '@/sim/npc-movement';
import { walkZOf, stairClimbOf } from '@/world/tactical-positions';
import type { ContentionState } from '@/core/contention-types';
import type { ContentionLedger } from '@/sim/rival-contention';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import type { BarrierRun, PlacedBarrier } from '@/world/barrier';
import type { Entity, GameMap, NpcProperties, Tile } from '@/core/types';

// ── Fixture: one walled town ────────────────────────────────────────────────────────────────
// A crenellated stone ring with a real gate (so it has a mural stair) around a POI anchor at its
// centroid. Everything inside is walkable grass, so the `to_stair` approach is ordinary walking.

const RING: [number, number][] = [[4, 4], [24, 4], [24, 20], [4, 20], [4, 4]];
const CENTROID: [number, number] = [14, 12];
const POI_ID = 'town';
const BARRIER_ID = 'barrier:0001';

function ringRun(): BarrierRun {
  return {
    kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone',
    crenellated: true, centroid: CENTROID, gates: [{ t: 10, width: 3, kind: 'gate' }],
  };
}

function makeMap(opts: { barriers?: PlacedBarrier[] } = {}): GameMap {
  const w = 32, h = 32;
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
    worldSeed: { pois: [{ id: POI_ID, type: 'village', position: { x: CENTROID[0], y: CENTROID[1] } }] },
    barrierRuns: opts.barriers ?? [{ id: BARRIER_ID, run: ringRun() }],
  } as unknown as GameMap;
}

/** A resident soldier of the town, standing at (x,y). */
function addSoldier(world: World, id: string, x: number, y: number, poiId = POI_ID): Entity {
  const p = initNpcProps(id, 'soldier', id.charCodeAt(id.length - 1) * 31);
  p.homePoiId = poiId;
  p.homeX = x; p.homeY = y;
  const e: Entity = { id, kind: 'npc', x, y, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

/** A ledger-getter stub whose rung the test drives directly — the system only calls `stateOf`. */
function ledgerAt(get: () => ContentionState): () => ContentionLedger {
  const ledger = { stateOf: () => get() } as unknown as ContentionLedger;
  return () => ledger;
}

function makeCtx(world: World, now = 0) {
  const clock = new SimClock();
  return { world, spirits: new Map(), log: new EventLog(clock), clock, rng: createRng(7), dt: 2000, now };
}

const propsOf = (world: World, id: string): NpcProperties =>
  npcProps(world.registry.get(id)!);

/** The 60 Hz movement tick, run until `done` or `maxTicks` is exhausted. Returns the tick count. */
function runMovement(
  world: World, map: GameMap, rng: ReturnType<typeof createRng>,
  maxTicks: number, done?: () => boolean,
): number {
  const stepMs = 1000 / 60;
  for (let i = 0; i < maxTicks; i++) {
    if (done?.()) return i;
    tickNpcMovementEntities(world, map, stepMs, rng);
  }
  return maxTicks;
}

/** A world with `n` resident soldiers already standing at the foot of the mural stair (so the
 *  ordinary `to_stair` walk is one tick and the tests spend their ticks on the on-wall phases). */
function walledTown(n: number): { world: World; map: GameMap } {
  const map = makeMap();
  const world = new World(map);
  const climb = stairClimbOf(ringRun())!;
  for (let i = 0; i < n; i++) {
    addSoldier(world, `sol${String(i).padStart(2, '0')}`, Math.floor(climb.bottom[0]) + 0.5, Math.floor(climb.bottom[1]) + 0.5);
  }
  return { world, map };
}

describe('GarrisonSystem — muster ladder', () => {
  it('musters at schism and does not at tension', () => {
    const map = makeMap();
    const world = new World(map);
    addSoldier(world, 'sol0', 14, 14);
    let rung: ContentionState = 'tension';
    const sys = new GarrisonSystem(ledgerAt(() => rung));

    sys.tick(makeCtx(world));
    expect(sys.rosterOf(POI_ID)!.mustered).toBe(false);
    expect(sys.rosterOf(POI_ID)!.members).toEqual([]);
    expect(propsOf(world, 'sol0').garrison).toBeUndefined();

    rung = 'schism';
    sys.tick(makeCtx(world, 1));
    expect(sys.rosterOf(POI_ID)!.mustered).toBe(true);
    expect(sys.rosterOf(POI_ID)!.members).toEqual(['sol0']);
    expect(propsOf(world, 'sol0').garrison?.phase).toBe('to_stair');
  });

  it('holds the muster through tension (the ladder owns the hysteresis) and stands down at calm', () => {
    const map = makeMap();
    const world = new World(map);
    addSoldier(world, 'sol0', 14, 14);
    let rung: ContentionState = 'schism';
    const sys = new GarrisonSystem(ledgerAt(() => rung));

    sys.tick(makeCtx(world));
    expect(sys.isMustered(POI_ID)).toBe(true);

    rung = 'tension';                       // easing, but not calm — the walls stay manned
    sys.tick(makeCtx(world, 1));
    expect(sys.isMustered(POI_ID)).toBe(true);
    expect(sys.rosterOf(POI_ID)!.members).toEqual(['sol0']);

    rung = 'calm';
    sys.tick(makeCtx(world, 2));
    expect(sys.isMustered(POI_ID)).toBe(false);
    expect(sys.rosterOf(POI_ID)!.members).toEqual([]);
    // He never left the ground, so standing down simply releases him.
    expect(propsOf(world, 'sol0').garrison).toBeUndefined();
  });

  it('a standing order musters a calm town, and releasing it stands the garrison down', () => {
    const map = makeMap();
    const world = new World(map);
    addSoldier(world, 'sol0', 14, 14);
    const sys = new GarrisonSystem(ledgerAt(() => 'calm'));

    sys.tick(makeCtx(world));
    expect(sys.isMustered(POI_ID)).toBe(false);

    sys.setStandingOrder(POI_ID, true);
    sys.tick(makeCtx(world, 1));
    expect(sys.rosterOf(POI_ID)!.standingOrder).toBe(true);
    expect(sys.rosterOf(POI_ID)!.members).toEqual(['sol0']);

    sys.setStandingOrder(POI_ID, false);
    sys.tick(makeCtx(world, 2));
    expect(sys.isMustered(POI_ID)).toBe(false);
  });

  it('raises no roster for a settlement with no garrisonable ring', () => {
    const flat: BarrierRun = { ...ringRun(), crenellated: false };
    const map = makeMap({ barriers: [{ id: BARRIER_ID, run: flat }] });
    const world = new World(map);
    addSoldier(world, 'sol0', 14, 14);
    const sys = new GarrisonSystem(ledgerAt(() => 'holy_war'));
    sys.tick(makeCtx(world));
    expect(sys.rosterOf(POI_ID)).toBeUndefined();
    expect(propsOf(world, 'sol0').garrison).toBeUndefined();
  });
});

describe('GarrisonSystem — roster (the proto-Group)', () => {
  it('posts at most min(stations, ring cap) soldiers, and only residents', () => {
    const map = makeMap();
    const world = new World(map);
    for (let i = 0; i < GARRISON_RING_CAP + 4; i++) addSoldier(world, `sol${String(i).padStart(2, '0')}`, 14, 14);
    addSoldier(world, 'stranger', 14, 15, 'elsewhere');       // resident of another town
    const sys = new GarrisonSystem(ledgerAt(() => 'schism'));
    sys.tick(makeCtx(world));

    const roster = sys.rosterOf(POI_ID)!;
    const stations = ringGarrisonGeometry(ringRun()).stations.length;
    expect(stations).toBeGreaterThan(GARRISON_RING_CAP);
    expect(roster.members).toHaveLength(Math.min(GARRISON_RING_CAP, stations));
    expect(roster.members).not.toContain('stranger');
    expect(propsOf(world, 'stranger').garrison).toBeUndefined();
  });

  it('is deterministic: the same world yields the same roster and the same station assignment', () => {
    const build = () => {
      const map = makeMap();
      const world = new World(map);
      for (let i = 0; i < 6; i++) addSoldier(world, `sol${String(i).padStart(2, '0')}`, 10 + i, 14);
      const sys = new GarrisonSystem(ledgerAt(() => 'holy_war'));
      sys.tick(makeCtx(world));
      return { world, roster: sys.rosterOf(POI_ID)! };
    };
    const a = build(), b = build();
    expect(a.roster.members).toEqual(b.roster.members);
    const posts = (r: typeof a) => r.roster.members.map((id) => propsOf(r.world, id).garrison!.stationIdx);
    expect(posts(a)).toEqual(posts(b));
    expect(new Set(posts(a)).size).toBe(a.roster.members.length);  // every man gets his own post
  });

  it('holds membership in the roster, never scattered across NPCs', () => {
    const map = makeMap();
    const world = new World(map);
    addSoldier(world, 'sol0', 14, 14);
    const sys = new GarrisonSystem(ledgerAt(() => 'schism'));
    sys.tick(makeCtx(world));
    const roster = sys.rosterOf(POI_ID)!;
    expect(roster.poiId).toBe(POI_ID);
    expect(roster.barrierId).toBe(BARRIER_ID);
    // The NPC carries ONLY the transient phase-machine scratch.
    expect(Object.keys(propsOf(world, 'sol0').garrison!).sort())
      .toEqual(['barrierId', 'phase', 'stationIdx', 't']);
  });
});

describe('GarrisonSystem — the phase machine', () => {
  it('progresses to_stair → climb → walk → stationed when the movement tick is driven', () => {
    const { world, map } = walledTown(1);
    new GarrisonSystem(ledgerAt(() => 'schism')).tick(makeCtx(world));

    const seen: string[] = [];
    const p = propsOf(world, 'sol00');
    const rng = createRng(3);
    runMovement(world, map, rng, 40000, () => {
      const phase = p.garrison?.phase;
      if (phase && seen[seen.length - 1] !== phase) seen.push(phase);
      return phase === 'stationed';
    });
    expect(seen).toEqual(['to_stair', 'climb', 'walk', 'stationed']);
  });

  it('walks the ORDINARY ground to the stair foot before it takes over (the to_stair fall-through)', () => {
    const map = makeMap();
    const world = new World(map);
    addSoldier(world, 'sol00', 18.5, 17.5);                // across the town from the stair
    new GarrisonSystem(ledgerAt(() => 'schism')).tick(makeCtx(world));

    const p = propsOf(world, 'sol00');
    const climb = stairClimbOf(ringRun())!;
    expect(p.garrison!.phase).toBe('to_stair');

    let walkedOnGround = false;
    const rng = createRng(5);
    runMovement(world, map, rng, 40000, () => {
      if (p.garrison?.phase === 'to_stair' && p.currentPath) walkedOnGround = true;
      return p.garrison?.phase === 'climb';
    });
    expect(walkedOnGround).toBe(true);                      // it really used tile pathfinding
    expect(p.garrison?.phase).toBe('climb');
    const e = world.registry.get('sol00')!;
    expect(Math.hypot(e.x - climb.bottom[0], e.y - climb.bottom[1])).toBeLessThan(1.5);
  });

  it('a stationed soldier stands at his post at the run\'s walk height, facing outward', () => {
    const { world, map } = walledTown(1);
    const sys = new GarrisonSystem(ledgerAt(() => 'schism'));
    sys.tick(makeCtx(world));

    const p = propsOf(world, 'sol00');
    const rng = createRng(3);
    runMovement(world, map, rng, 40000, () => p.garrison?.phase === 'stationed');
    expect(p.garrison?.phase).toBe('stationed');

    const geo = ringGarrisonGeometry(ringRun());
    const station = geo.stations[p.garrison!.stationIdx];
    const e = world.registry.get('sol00')!;
    expect(e.x).toBeCloseTo(station.x, 9);
    expect(e.y).toBeCloseTo(station.y, 9);
    expect(p.wallZ).toBeCloseTo(walkZOf(ringRun()), 9);
    expect(p.wallZ).toBeCloseTo(station.walkZ, 9);
  });

  it('carries no wallZ while grounded — before the climb and again after coming down', () => {
    const { world, map } = walledTown(1);
    let rung: ContentionState = 'schism';
    const sys = new GarrisonSystem(ledgerAt(() => rung));
    const p = propsOf(world, 'sol00');
    const rng = createRng(3);

    sys.tick(makeCtx(world));
    expect(p.garrison!.phase).toBe('to_stair');
    expect(p.wallZ).toBeUndefined();                      // still on the ground

    runMovement(world, map, rng, 40000, () => p.garrison?.phase === 'stationed');
    expect(p.wallZ).toBeGreaterThan(0);

    rung = 'calm';                                        // stand down
    sys.tick(makeCtx(world, 1));
    expect(p.garrison!.stationIdx).toBe(GARRISON_STAND_DOWN_IDX);
    runMovement(world, map, rng, 60000, () => p.garrison === undefined);
    expect(p.garrison).toBeUndefined();
    expect(p.wallZ).toBeUndefined();                      // grounded again
  });

  it('never puts a soldier on an unwalkable wall tile via pathfinding (on-wall travel is parametric)', () => {
    const { world, map } = walledTown(1);
    const sys = new GarrisonSystem(ledgerAt(() => 'schism'));
    sys.tick(makeCtx(world));
    const p = propsOf(world, 'sol00');
    const rng = createRng(3);
    runMovement(world, map, rng, 40000, () => {
      // Above grade the NPC must never be carrying a tile path: the allure is not walkable.
      if ((p.wallZ ?? 0) > 0) expect(p.currentPath).toBeUndefined();
      return p.garrison?.phase === 'stationed';
    });
    expect(p.garrison?.phase).toBe('stationed');
  });
});

describe('GarrisonSystem — snapshot seam', () => {
  it('round-trips standing orders and the muster hysteresis side', () => {
    const map = makeMap();
    const world = new World(map);
    addSoldier(world, 'sol0', 14, 14);
    const sys = new GarrisonSystem(ledgerAt(() => 'schism'));
    sys.setStandingOrder(POI_ID, true);
    sys.tick(makeCtx(world));
    const dump = structuredClone(sys.serialize());

    const revived = new GarrisonSystem(ledgerAt(() => 'tension'));
    revived.hydrate(dump);
    expect(revived.hasStandingOrder(POI_ID)).toBe(true);
    expect(revived.isMustered(POI_ID)).toBe(true);
    expect(revived.serialize()).toEqual(dump);
  });

  it('serializes ONLY what cannot be rederived (orders + muster side), never the roster', () => {
    const map = makeMap();
    const world = new World(map);
    addSoldier(world, 'sol0', 14, 14);
    const sys = new GarrisonSystem(ledgerAt(() => 'holy_war'));
    sys.tick(makeCtx(world));
    expect(Object.keys(sys.serialize() as object).sort()).toEqual(['mustered', 'standing']);
  });

  it('hydrate(undefined) fully resets and never throws (old save / hand-built snapshot)', () => {
    const map = makeMap();
    const world = new World(map);
    addSoldier(world, 'sol0', 14, 14);
    const sys = new GarrisonSystem(ledgerAt(() => 'schism'));
    sys.setStandingOrder(POI_ID, true);
    sys.tick(makeCtx(world));

    expect(() => sys.hydrate(undefined)).not.toThrow();
    expect(sys.hasStandingOrder(POI_ID)).toBe(false);
    expect(sys.isMustered(POI_ID)).toBe(false);
    expect(sys.rosterOf(POI_ID)).toBeUndefined();
    expect(sys.serialize()).toEqual({ standing: [], mustered: [] });
  });

  it('a hydrated muster survives a `tension` tick — the discarded timeline cannot un-man the wall', () => {
    const map = makeMap();
    const world = new World(map);
    addSoldier(world, 'sol0', 14, 14);
    const sys = new GarrisonSystem(ledgerAt(() => 'tension'));
    sys.hydrate({ standing: [], mustered: [POI_ID] });
    sys.tick(makeCtx(world));
    expect(sys.rosterOf(POI_ID)!.mustered).toBe(true);
  });
});

describe('GarrisonSystem — replay determinism', () => {
  it('two runs from the same seed produce identical rosters and identical positions', () => {
    const run = () => {
      const { world, map } = walledTown(4);
      const sys = new GarrisonSystem(ledgerAt(() => 'schism'));
      const rng = createRng(12345);
      for (let step = 0; step < 30; step++) {
        sys.tick(makeCtx(world, step));
        runMovement(world, map, rng, 120);               // 2 s of movement per system tick (0.5 Hz)
      }
      const roster = sys.rosterOf(POI_ID)!;
      return {
        members: roster.members,
        state: roster.members.map((id) => {
          const e = world.registry.get(id)!;
          const p = npcProps(e);
          return { id, x: e.x, y: e.y, wallZ: p.wallZ ?? null, phase: p.garrison?.phase ?? null, t: p.garrison?.t ?? null };
        }),
      };
    };
    const a = run(), b = run();
    expect(a.members).toEqual(b.members);
    expect(a.state).toEqual(b.state);
  });
});
