// tests/unit/settlement-plan.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { planSettlement, orderedSlotsFor, SITE_FITNESS_PULL, WATER_TYPES } from '@/world/settlement-plan';
import { placeSettlement, findCentralPlacement } from '@/world/building-placer';
import { getZoneRule } from '@/map/poi-zones';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { blueprintOf } from '@/blueprint/entity';
import { World } from '@/world/world';
import { Random } from '@/core/noise';
import { makeTerrainProbe } from '@/world/terrain-affordance';
import type { GameMap, Tile, POI } from '@/core/types';

beforeAll(() => ensureBuildingTypesRegistered());

function grassTiles(w = 48, h = 48): Tile[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      ({ x, y, type: 'grass', walkable: true }) as unknown as Tile));
}

function emptyMap(tiles: Tile[][]): GameMap {
  return { tiles, width: tiles[0].length, height: tiles.length, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 },
    buildings: [] } as unknown as GameMap;
}

const CENTER = { x: 24, y: 24 };
const villageRule = getZoneRule('village');   // branching dirt roads
const cityRule = getZoneRule('city');         // grid stone roads

describe('planSettlement — road graph', () => {
  it('linear layout yields a through street along the dominant connection axis', () => {
    const rule = { ...villageRule, roadLayout: 'linear' as const };
    const plan = planSettlement(CENTER, rule, grassTiles(), [{ dx: 0, dy: 1 }], new Random(7));
    expect(plan.edges.length).toBe(2);                       // founding node splits the spine
    expect(plan.edges.every(e => e.kind === 'through')).toBe(true);
    // vertical axis: all road tiles share x
    for (const e of plan.edges) for (const t of e.tiles) expect(t.x).toBe(CENTER.x);
    expect(plan.nodes[0]).toMatchObject({ kind: 'founding', ...CENTER });
  });

  it('branching adds two perpendicular lanes at the founding node', () => {
    const plan = planSettlement(CENTER, villageRule, grassTiles(), [{ dx: 1, dy: 0 }], new Random(7));
    const lanes = plan.edges.filter(e => e.kind === 'lane');
    expect(lanes.length).toBe(2);
    for (const l of lanes) for (const t of l.tiles) expect(t.x).toBe(CENTER.x);
  });

  it('grid yields parallel lanes plus cross connectors', () => {
    const plan = planSettlement(CENTER, cityRule, grassTiles(), [{ dx: 1, dy: 0 }], new Random(7));
    const lanes = plan.edges.filter(e => e.kind === 'lane');
    expect(lanes.length).toBe(4);                            // 2 parallel + 2 cross
    const parallel = lanes.filter(l => l.tiles.every(t => t.y === l.tiles[0].y));
    expect(parallel.length).toBe(2);
    expect(new Set(parallel.map(l => l.tiles[0].y))).toEqual(new Set([CENTER.y - 3, CENTER.y + 3]));
  });

  it('never places road tiles on water and stays deterministic', () => {
    const tiles = grassTiles();
    for (let x = 0; x < 48; x++) tiles[26][x].type = 'river';
    const planA = planSettlement(CENTER, cityRule, tiles, [{ dx: 1, dy: 0 }], new Random(3));
    const planB = planSettlement(CENTER, cityRule, tiles, [{ dx: 1, dy: 0 }], new Random(3));
    for (const e of planA.edges) for (const t of e.tiles) {
      expect(WATER_TYPES.has(tiles[t.y][t.x].type)).toBe(false);
    }
    expect(planB).toEqual(planA);
  });

  it('no-road layouts produce an empty plan', () => {
    const plan = planSettlement(CENTER, getZoneRule('temple'), grassTiles(), [], new Random(7));
    expect(plan.edges).toEqual([]);
    expect(plan.slots).toEqual([]);
  });
});

describe('planSettlement — frontage slots', () => {
  it('every slot sits beside its road tile, perpendicular to the edge', () => {
    const plan = planSettlement(CENTER, villageRule, grassTiles(), [{ dx: 1, dy: 0 }], new Random(7));
    expect(plan.slots.length).toBeGreaterThan(0);
    for (const s of plan.slots) {
      const edge = plan.edges[s.edge];
      expect(edge.tiles.some(t => t.x === s.roadX && t.y === s.roadY)).toBe(true);
      expect(Math.abs(s.side[0]) + Math.abs(s.side[1])).toBe(1);
    }
  });

  it('orderedSlotsFor filters to door-opposing sides and respects affinity', () => {
    const plan = planSettlement(CENTER, villageRule, grassTiles(), [{ dx: 1, dy: 0 }], new Random(7));
    // south door (facing [0,1]) wants slots on the NORTH side of a road ([0,-1])
    const south = orderedSlotsFor(plan, [0, 1], { affinity: 'center' }, new Random(1));
    expect(south.length).toBeGreaterThan(0);
    for (const s of south) expect(s.side).toEqual([0, -1]);
    // centre affinity: first candidate is nearer the founding node than the last
    expect(south[0].dist).toBeLessThanOrEqual(south[south.length - 1].dist);
    const edgey = orderedSlotsFor(plan, [0, 1], { affinity: 'edge' }, new Random(1));
    expect(edgey[0].dist).toBeGreaterThanOrEqual(edgey[edgey.length - 1].dist);
  });
});

describe('orderedSlotsFor — terrain fitness re-ranking (site-fitness live-wiring)', () => {
  const plan = planSettlement(CENTER, villageRule, grassTiles(), [{ dx: 1, dy: 0 }], new Random(7));
  const facing: [number, number] = [0, 1];
  const rule = { affinity: 'center' as const };
  const xy = (s: { roadX: number; roadY: number }) => [s.roadX, s.roadY] as const;

  it('omitting fitnessAt is byte-identical to a zero fitness (rng draw order unchanged)', () => {
    const none = orderedSlotsFor(plan, facing, rule, new Random(5));
    const zero = orderedSlotsFor(plan, facing, rule, new Random(5), () => 0);
    expect(zero).toEqual(none);
  });

  it('a uniform fitness leaves the ordering unchanged (a constant shift on every key)', () => {
    const base = orderedSlotsFor(plan, facing, rule, new Random(1));
    const flat = orderedSlotsFor(plan, facing, rule, new Random(1), () => 0.7);
    expect(flat.map(xy)).toEqual(base.map(xy));
  });

  it('rewarding a slot pulls it ahead of an equal-distance rival (PULL dwarfs the jitter gap)', () => {
    const base = orderedSlotsFor(plan, facing, rule, new Random(1));
    // Two slots at equal dist differ in the baseline only by jitter (< 1.5);
    // SITE_FITNESS_PULL (=3) on the later one guarantees it overtakes.
    let earlier: typeof base[number] | undefined, later: typeof base[number] | undefined;
    for (let i = 0; i < base.length && !later; i++)
      for (let j = i + 1; j < base.length; j++)
        if (base[i].dist === base[j].dist
          && (base[i].roadX !== base[j].roadX || base[i].roadY !== base[j].roadY)) {
          earlier = base[i]; later = base[j]; break;
        }
    expect(SITE_FITNESS_PULL).toBeGreaterThan(1.5);
    expect(later, 'symmetric layout should yield an equal-distance slot pair').toBeDefined();
    const reranked = orderedSlotsFor(plan, facing, rule, new Random(1),
      (tx, ty) => (tx === later!.roadX && ty === later!.roadY ? 1 : 0));
    const ie = reranked.findIndex(s => s.roadX === earlier!.roadX && s.roadY === earlier!.roadY);
    const il = reranked.findIndex(s => s.roadX === later!.roadX && s.roadY === later!.roadY);
    expect(il).toBeLessThan(ie);
  });
});

describe('findCentralPlacement — terrain-aware focus siting', () => {
  const fp = { w: 1, h: 1 };
  const fitsAll = () => true;

  it('without fitnessAt, returns the dead-centre first fit', () => {
    expect(findCentralPlacement(10, 10, fp, fitsAll, 5)).toEqual({ tileX: 10, tileY: 10 });
  });

  it('with fitnessAt, climbs within the slack onto the best-sited fit', () => {
    const best = { x: 12, y: 10 };  // r=2 ring from centre — inside the slack
    const o = findCentralPlacement(10, 10, fp, fitsAll, 5,
      (x, y) => (x === best.x && y === best.y ? 1 : 0));
    expect(o).toEqual({ tileX: best.x, tileY: best.y });
  });

  it('honours the slack: a far better site beyond it is NOT chosen (stays central)', () => {
    const far = { x: 20, y: 10 };  // r=10 — past the +2 slack from the r=0 first hit
    const o = findCentralPlacement(10, 10, fp, fitsAll, 30,
      (x, y) => (x === far.x && y === far.y ? 1 : 0));
    expect(o).not.toEqual({ tileX: far.x, tileY: far.y });
    expect(Math.abs(o!.tileX - 10) + Math.abs(o!.tileY - 10)).toBeLessThanOrEqual(2);
  });
});

describe('placeSettlement — plan execution', () => {
  const poi: POI = { id: 'v1', type: 'village', name: 'Test', position: CENTER } as unknown as POI;

  function run(seed = 11, rule = villageRule, tiles = grassTiles()) {
    const world = new World(emptyMap(tiles));
    const result = placeSettlement(poi, rule, tiles, world.registry, [{ dx: 1, dy: 0 }], new Random(seed), 'medieval', world);
    return { world, result, tiles };
  }

  it('terrain-aware wiring is live: passing the map relocates buildings vs the distance-only path', () => {
    // The synthetic seed-1 heightfield carries ~15 m of relief, so site fitness varies
    // across the lots. Same POI / rule / rng seed — the ONLY difference is whether the
    // placer is handed a terrain probe — so any divergence is the live wiring at work.
    const place = (withMap: boolean): string[] => {
      const t = grassTiles();
      const world = new World(emptyMap(t));
      const r = placeSettlement(
        poi, villageRule, t, world.registry, [{ dx: 1, dy: 0 }], new Random(11),
        'medieval', world, 1, undefined, withMap ? emptyMap(t) : undefined,
      );
      return r.entities
        .filter(e => blueprintOf(e)?.rb.class === 'building')
        .map(e => `${e.x},${e.y}`).sort();
    };
    const flat = place(false);
    const terrained = place(true);
    expect(terrained.length).toBeGreaterThan(0);
    expect(terrained.length).toBe(flat.length);     // same roster, only positions move
    expect(terrained).not.toEqual(flat);            // terrain changed at least one site
    expect(place(true)).toEqual(terrained);          // …and the terrain-aware path is deterministic
  });

  it('terrain-aware siting lifts the PROMINENT building onto higher ground vs the distance-only path', () => {
    // The liveness test above proves the wiring MOVES buildings; this proves it moves
    // them in the RIGHT direction — the focus (church/manor) should crown a more
    // prominent site than the distance-only baseline picks. Across a spread of seeds
    // (each a different synthetic relief) the strong majority must improve, and at
    // least one strictly so — calibration (SITE_FITNESS_PULL) that's too weak to bite
    // would fail this.
    const FOCI = new Set(['parish-church', 'manor']);
    const bigVillage = { ...villageRule, buildingCount: { min: 8, max: 8 } };
    const focusProminence = (seed: number, withMap: boolean): number | null => {
      const t = grassTiles();
      const map = emptyMap(t); map.seed = seed;
      const world = new World(map);
      const r = placeSettlement(
        poi, bigVillage, t, world.registry, [{ dx: 1, dy: 0 }], new Random(seed),
        'medieval', world, seed, undefined, withMap ? (() => { const m = emptyMap(t); m.seed = seed; return m; })() : undefined,
      );
      const focus = r.entities.find(e => {
        const p = blueprintOf(e)?.rb.preset; return p !== undefined && FOCI.has(p);
      });
      if (!focus) return null;
      const fp = blueprintOf(focus)!.collision.footprint;
      const a = makeTerrainProbe(map).affordanceAt(focus.x + Math.floor(fp.w / 2), focus.y + Math.floor(fp.h / 2));
      return typeof a.prominence === 'number' ? a.prominence : null;
    };

    const seeds = [1, 2, 3, 7, 11, 19, 23, 31];
    let improved = 0, strictly = 0, compared = 0;
    for (const s of seeds) {
      const flat = focusProminence(s, false), terr = focusProminence(s, true);
      if (flat === null || terr === null) continue;
      compared++;
      if (terr >= flat - 1e-9) improved++;
      if (terr > flat + 1e-9) strictly++;
    }
    expect(compared).toBeGreaterThanOrEqual(6);            // foci actually placed
    expect(improved / compared).toBeGreaterThanOrEqual(0.8); // strong majority climb (or hold)
    expect(strictly).toBeGreaterThan(0);                    // the pull genuinely bites
  });

  it('slot-placed buildings front a road: walking out of the door reaches one within 2 tiles', () => {
    const { result } = run();
    // result.entities now carries civic props too (S5) — restrict to buildings.
    // Open-frame buildings (the market stall has no walls/door) carry no doorCells;
    // the "door fronts a road" invariant only applies to buildings WITH a door.
    const buildings = result.entities
      .filter(e => blueprintOf(e)?.rb.class === 'building')
      .filter(e => (blueprintOf(e)!.collision.doorCells.length ?? 0) > 0);
    expect(buildings.length).toBeGreaterThan(0);
    const roadSet = new Set(result.roadTiles.map(rt => `${rt.x},${rt.y}`));
    let fronting = 0;
    for (const e of buildings) {
      const bp = blueprintOf(e)!;
      const [dlx, dly] = bp.collision.doorCells[0].split(',').map(Number);
      const doorX = e.x + dlx, doorY = e.y + dly;
      // a road tile within Chebyshev distance 2 of the door (door may sit
      // behind the preset's own yard strip)
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dx = -2; dx <= 2 && !near; dx++) {
          if (roadSet.has(`${doorX + dx},${doorY + dy}`)) near = true;
        }
      }
      if (near) fronting++;
    }
    // most buildings front a road (fallback placements may not)
    expect(fronting / buildings.length).toBeGreaterThanOrEqual(0.5);
  });

  it('building structure cells never cover road tiles and footprints never overlap', () => {
    const { result } = run();
    const roadSet = new Set(result.roadTiles.map(rt => `${rt.x},${rt.y}`));
    const seen = new Set<string>();
    for (const e of result.entities.filter(e => blueprintOf(e)?.rb.class === 'building')) {
      const bp = blueprintOf(e)!;
      // A SOLID structure cell on a road is the bug. A DOOR cell ON a road is
      // correct — the door fronts the road (same semantics as the spatial-invariant
      // integration net's INV3 and `tileBlockedByBuilding`).
      const doors = new Set(bp.collision.doorCells);
      for (let dy = 0; dy < bp.collision.footprint.h; dy++) {
        for (let dx = 0; dx < bp.collision.footprint.w; dx++) {
          const k = `${e.x + dx},${e.y + dy}`;
          if (!doors.has(`${dx},${dy}`)) expect(roadSet.has(k), `structure on road at ${k}`).toBe(false);
          expect(seen.has(k), `overlap at ${k}`).toBe(false);
          seen.add(k);
        }
      }
    }
  });

  it('docks only place within 2 tiles of water (site rule enforced)', () => {
    const portPoi = { ...poi, id: 'p1', type: 'port' } as unknown as POI;
    const rule = getZoneRule('port');
    // No water anywhere → the dock must NOT place at all.
    const dryTiles = grassTiles();
    const dryWorld = new World(emptyMap(dryTiles));
    const dry = placeSettlement(portPoi, rule, dryTiles, dryWorld.registry, [], new Random(5), 'medieval', dryWorld);
    expect(dry.entities.filter(e => blueprintOf(e)?.rb.preset === 'dock')).toEqual([]);
    // Water nearby → dock places, within 2 tiles of it.
    const wetTiles = grassTiles();
    for (let x = 0; x < 48; x++) wetTiles[28][x].type = 'shallow_water';
    const wetWorld = new World(emptyMap(wetTiles));
    const wet = placeSettlement(portPoi, rule, wetTiles, wetWorld.registry, [], new Random(5), 'medieval', wetWorld);
    const docks = wet.entities.filter(e => blueprintOf(e)?.rb.preset === 'dock');
    expect(docks.length).toBeGreaterThan(0);
    for (const d of docks) {
      const bp = blueprintOf(d)!;
      expect(Math.abs(d.y + bp.collision.footprint.h - 1 - 28) <= 2 || Math.abs(d.y - 28) <= 2).toBe(true);
    }
  });

  it('is deterministic: same seed produces identical layout', () => {
    const a = run(42);
    const b = run(42);
    expect(b.result.roadTiles).toEqual(a.result.roadTiles);
    expect(b.result.entities.map(e => [e.id, e.x, e.y]))
      .toEqual(a.result.entities.map(e => [e.id, e.x, e.y]));
  });

  it('returns the plan alongside entities and roads', () => {
    const { result } = run();
    expect(result.plan.nodes[0].kind).toBe('founding');
    expect(result.plan.edges.length).toBeGreaterThan(0);
  });

  // ── S3: center-first nucleated grammar ──────────────────────────────────────
  const bigVillage = { ...villageRule, buildingCount: { min: 8, max: 8 } };

  it('S3 — a large village places its foci (church + manor) anchored at the centre', () => {
    // The foci are placed FIRST, so they claim the most central frontage; the
    // closest-to-centre building should be a focus, not a dwelling.
    const { result } = run(11, bigVillage);
    const buildings = result.entities.filter(e => blueprintOf(e)?.rb.class === 'building');
    const presets = new Set(buildings.map(e => blueprintOf(e)!.rb.preset));
    expect(presets.has('parish-church')).toBe(true);
    expect(presets.has('manor')).toBe(true);

    const c = result.plan.center;
    const dist = (e: typeof buildings[number]) => {
      const fp = blueprintOf(e)!.collision.footprint;
      return Math.hypot(e.x + fp.w / 2 - c.x, e.y + fp.h / 2 - c.y);
    };
    const FOCI = new Set(['parish-church', 'manor']);
    const foci = buildings.filter(e => FOCI.has(blueprintOf(e)!.rb.preset!));
    const dwellings = buildings.filter(e => !FOCI.has(blueprintOf(e)!.rb.preset!));
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    // The foci sit in a central precinct — closer to the founding node, on average,
    // than the dwellings that fill in around them.
    expect(mean(foci.map(dist))).toBeLessThan(mean(dwellings.map(dist)));
  });

  it('S3 — a hamlet below the focus threshold is dwellings-only (no church/manor)', () => {
    const hamlet = { ...villageRule, buildingCount: { min: 3, max: 3 } };
    const { result } = run(11, hamlet);
    const presets = result.entities
      .filter(e => blueprintOf(e)?.rb.class === 'building')
      .map(e => blueprintOf(e)!.rb.preset);
    expect(presets).not.toContain('parish-church');
    expect(presets).not.toContain('manor');
  });

  // ── S3b: village green (central open common) ─────────────────────────────────
  it('S3b — a large village reserves a central green, with the well at its heart', () => {
    const { result, tiles } = run(11, bigVillage);
    const greens = result.plan.civics.filter(c => c.type === 'green');
    expect(greens.length).toBe(1);
    const green = greens[0];
    expect(green.w).toBeGreaterThanOrEqual(3);

    // The green is a CENTRAL common: its centre sits closer to the founding node
    // than the mean building does (the dwellings ring it, they don't beat it to
    // the middle).
    const c = result.plan.center;
    const gcx = green.x + (green.w >> 1), gcy = green.y + (green.h >> 1);
    const greenDist = Math.hypot(gcx - c.x, gcy - c.y);
    const buildings = result.entities.filter(e => blueprintOf(e)?.rb.class === 'building');
    const bDist = buildings.map(e => {
      const fp = blueprintOf(e)!.collision.footprint;
      return Math.hypot(e.x + fp.w / 2 - c.x, e.y + fp.h / 2 - c.y);
    });
    const meanBuilding = bDist.reduce((s, v) => s + v, 0) / bDist.length;
    expect(greenDist).toBeLessThan(meanBuilding);

    // The green is painted as tended meadow (reads against the worn lanes). The
    // single tile under the well prop is cleared to grass (hidden by the well).
    let meadow = 0;
    for (let dy = 0; dy < green.h; dy++) {
      for (let dx = 0; dx < green.w; dx++) {
        if (tiles[green.y + dy][green.x + dx].type === 'meadow') meadow++;
      }
    }
    expect(meadow).toBeGreaterThanOrEqual(green.w * green.h - 1);

    // The well stands inside the green.
    const well = result.plan.civics.find(c2 => c2.type === 'well');
    expect(well).toBeDefined();
    expect(well!.x).toBeGreaterThanOrEqual(green.x);
    expect(well!.x).toBeLessThan(green.x + green.w);
    expect(well!.y).toBeGreaterThanOrEqual(green.y);
    expect(well!.y).toBeLessThan(green.y + green.h);
  });

  it('S3b — no building footprint covers the green', () => {
    const { result } = run(11, bigVillage);
    const green = result.plan.civics.find(c => c.type === 'green');
    expect(green).toBeDefined();
    const greenSet = new Set<string>();
    for (let dy = 0; dy < green!.h; dy++) {
      for (let dx = 0; dx < green!.w; dx++) greenSet.add(`${green!.x + dx},${green!.y + dy}`);
    }
    for (const e of result.entities.filter(e => blueprintOf(e)?.rb.class === 'building')) {
      const bp = blueprintOf(e)!;
      for (let dy = 0; dy < bp.collision.footprint.h; dy++) {
        for (let dx = 0; dx < bp.collision.footprint.w; dx++) {
          expect(greenSet.has(`${e.x + dx},${e.y + dy}`), `building on green at ${e.x + dx},${e.y + dy}`).toBe(false);
        }
      }
    }
  });

  it('S3b — a hamlet below the focus threshold has no green', () => {
    const hamlet = { ...villageRule, buildingCount: { min: 3, max: 3 } };
    const { result } = run(11, hamlet);
    expect(result.plan.civics.some(c => c.type === 'green')).toBe(false);
  });
});
