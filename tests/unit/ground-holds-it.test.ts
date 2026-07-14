// WCV 98 — "the ground must be able to HOLD what stands on it", asserted on real worlds.
//
//   * no rock glued to a cliff FACE (slope gate);
//   * no land species standing in the water the player SEES (water habitat) — while the
//     two populations that BELONG in water survive: riffle boulders, and emergent reeds
//     at a shallow margin;
//   * the alpine scatter is not gutted by the gates (the WCV-97 density holds).
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '@/map/map-generator';
import { planWorldLayout } from '@/world/poi-layout';
import { getRenderWaterMask } from '@/world/render-water';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { siteMetrics } from '@/terrain/terrain-generator';
import { worldStyleOf } from '@/core/world-style';
import { isRockKind } from '@/world/entity-kinds';
import { isEmergentSpecies, waterHabitatOf } from '@/world/water-habitat';
import { collectRockPads, ROCK_PAD_STRIDE } from '@/world/rock-deformation';
import type { GameMap, WorldSeed, Entity } from '@/core/types';
import type { World } from '@/world/world';

const SEEDS = [12345, 777];
/** The steepest ground the hills brush's ROCK band tolerates (hills.ts ROCK_SLOPE.maxSlopeM). */
const ROCK_SLOPE_CEILING_M = 1.8;
const DEEP = new Set(['deep_water', 'ocean']);

const worlds = new Map<number, { map: GameMap; world: World }>();

beforeAll(async () => {
  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  for (const seed of SEEDS) {
    const layout = planWorldLayout(ws);
    const laidOut = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
    worlds.set(seed, await generateWithNoise(layout.size.width, layout.size.height, seed, laidOut));
  }
}, 240_000);

function slopeFn(map: GameMap): (x: number, y: number) => number {
  const style = worldStyleOf(map.worldSeed);
  const elev = getHeightfield(map.seed, map.width, map.height,
    styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed));
  return (x, y) => siteMetrics(elev, x, y, map.width, map.height, ELEVATION_SEA_LEVEL, style.mountainRelief).slopeM;
}

const nature = (world: World): Entity[] =>
  world.registry.all().filter((e) => e.tags?.includes('vegetation') || isRockKind(e.kind) || e.kind === 'standing_stone');

describe.each(SEEDS)('ground-holds-it — seed %i', (seed) => {
  it('no BRUSH-scattered rock sits on ground steeper than its band ceiling (no cliff-face rocks)', () => {
    const { map, world } = worlds.get(seed)!;
    const slopeAt = slopeFn(map);
    const offenders = world.registry.all()
      .filter((e) => e.id.startsWith('hills-') && isRockKind(e.kind))
      .filter((e) => slopeAt(Math.floor(e.x), Math.floor(e.y)) >= ROCK_SLOPE_CEILING_M);
    expect(offenders.map((e) => `${e.kind}@${e.x.toFixed(1)},${e.y.toFixed(1)}`)).toEqual([]);
  });

  it('the slope gate does NOT gut the alpine scatter (WCV-97 density holds)', () => {
    const { world } = worlds.get(seed)!;
    const rocks = world.registry.all().filter((e) => e.id.startsWith('hills-') && isRockKind(e.kind));
    // Pre-gate the same worlds carried 2500 (12345) / 3637 (777) brush rocks; the gate is a
    // tail cut, not a cull. A floor well under those numbers still catches a regression that
    // silently empties the uplands.
    expect(rocks.length).toBeGreaterThan(1800);
  });

  it('NO land species stands in the water the player sees', () => {
    const { map, world } = worlds.get(seed)!;
    const isWater = getRenderWaterMask(map);
    const offenders = nature(world)
      .filter((e) => waterHabitatOf(e.kind, e.tags ?? []) === 'land')
      .filter((e) => isWater(Math.floor(e.x), Math.floor(e.y)));
    expect(offenders.map((e) => e.kind)).toEqual([]);
  });

  it('a BRUSH rock in a mountain tarn is not deliberate either — only the riparian pass puts stone in water', () => {
    const { map, world } = worlds.get(seed)!;
    const isWater = getRenderWaterMask(map);
    const wetBrushRocks = world.registry.all()
      .filter((e) => e.id.startsWith('hills-') && isRockKind(e.kind))
      .filter((e) => isWater(Math.floor(e.x), Math.floor(e.y)));
    expect(wetBrushRocks.map((e) => e.kind)).toEqual([]);
  });

  it('emergent species (reed/bulrush/sedge) stand only at a shallow MARGIN, never in open water', () => {
    const { map, world } = worlds.get(seed)!;
    const isWater = getRenderWaterMask(map);
    const emergents = nature(world).filter((e) => isEmergentSpecies(e.kind));
    expect(emergents.length).toBeGreaterThan(0);   // the reedbeds survive the gate
    for (const e of emergents) {
      const x = Math.floor(e.x), y = Math.floor(e.y);
      if (!isWater(x, y)) continue;                // on the dry bank: always fine
      expect(DEEP.has(map.tiles[y][x].type)).toBe(false);   // never open/deep water
      const atMargin = !isWater(x - 1, y) || !isWater(x + 1, y) || !isWater(x, y - 1) || !isWater(x, y + 1);
      expect(atMargin).toBe(true);                 // a reed bed rings the water, it doesn't raft
    }
  });

  it('the in-water RIFFLE BOULDERS survive (the gate must not delete a feature we want)', () => {
    const { map, world } = worlds.get(seed)!;
    const isWater = getRenderWaterMask(map);
    const riffle = world.registry.all()
      .filter((e) => isRockKind(e.kind) && (e.tags?.includes('waterPlaced') ?? false))
      .filter((e) => isWater(Math.floor(e.x), Math.floor(e.y)));
    expect(riffle.length).toBeGreaterThan(20);
  });

  it('riparian TREES sit on dry bank cells only — never in the channel', () => {
    const { map, world } = worlds.get(seed)!;
    const isWater = getRenderWaterMask(map);
    const wetTrees = world.registry.all()
      .filter((e) => e.id.startsWith('riparian-') && (e.tags?.includes('tree') ?? false))
      .filter((e) => isWater(Math.floor(e.x), Math.floor(e.y)));
    expect(wetTrees.map((e) => e.kind)).toEqual([]);
  });

  it('the map DECLARES its rock pads, and they match the surviving rocks exactly', () => {
    const { map, world } = worlds.get(seed)!;
    expect(map.rockPads?.length).toBeGreaterThan(0);
    // The declaration is a harvest of the FINAL entity set — re-harvesting must reproduce it.
    expect(collectRockPads(world.registry.all())).toEqual(map.rockPads);
    expect(map.rockPads!.length % ROCK_PAD_STRIDE).toBe(0);
  });
});
