// Throwaway probe (rock settling round):
//  (1) is the hills-brush rock scatter re-derivable purely from the FINAL map?
//  (2) what slope does a scattered rock actually sit on? (calibrates the P0 slope gate)
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '@/map/map-generator';
import { planWorldLayout } from '@/world/poi-layout';
import { placeVegetation } from '@/world/brushes/vegetation-placer';
import { ALPINE_PARAMS } from '@/world/brushes/hills';
import { siteMetrics } from '@/terrain/terrain-generator';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { worldStyleOf } from '@/core/world-style';
import type { WorldSeed, Entity } from '@/core/types';

const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
const ROCKS = new Set(['boulder', 'rock_pile', 'pebbles', 'standing_stone']);
const ALPINE_TILES = new Set(['hills', 'mountain', 'peak', 'rocky']);

function pct(sorted: number[], p: number): string {
  if (!sorted.length) return 'n/a';
  return (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0).toFixed(2);
}

async function main(): Promise<void> {
  for (const seed of [12345, 777]) {
    const layout = planWorldLayout(ws);
    const laidOut = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
    const { map, world } = await generateWithNoise(layout.size.width, layout.size.height, seed, laidOut);

    const style = worldStyleOf(map.worldSeed);
    const elev = getHeightfield(map.seed, map.width, map.height,
      styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed));
    const slopeAt = (x: number, y: number): number =>
      siteMetrics(elev, x, y, map.width, map.height, ELEVATION_SEA_LEVEL, style.mountainRelief).slopeM;

    const live = world.registry.all().filter((e) => e.id.startsWith('hills-') && ROCKS.has(e.kind));
    const liveKey = new Set(live.map((e) => `${e.kind}@${e.x.toFixed(4)},${e.y.toFixed(4)}`));

    // (1) Re-derivability: replay placeVegetation over the FINAL tiles, whole-map region.
    const ctx = { world: world.asReadOnly(), tiles: map, style };
    const redrv: Entity[] = placeVegetation(
      { x: 0, y: 0, w: map.width, h: map.height }, seed, ctx, ALPINE_PARAMS,
    ).filter((e) => ROCKS.has(e.kind));
    const redrvKey = new Set(redrv.map((e) => `${e.kind}@${e.x.toFixed(4)},${e.y.toFixed(4)}`));
    let inBoth = 0;
    for (const k of liveKey) if (redrvKey.has(k)) inBoth++;
    console.log(`seed ${seed}: liveRocks=${liveKey.size} redrvRocks=${redrvKey.size} match=${inBoth} onlyLive=${liveKey.size - inBoth} onlyRedrv=${redrvKey.size - inBoth}`);

    // (2) Slope under each rock, vs the slope of all alpine ground (the population it drew from).
    const rockSlopes = live.map((e) => slopeAt(Math.floor(e.x), Math.floor(e.y))).sort((a, b) => a - b);
    const groundSlopes: number[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (ALPINE_TILES.has(map.tiles[y][x].type)) groundSlopes.push(slopeAt(x, y));
      }
    }
    groundSlopes.sort((a, b) => a - b);
    const over = (t: number): string =>
      `${((rockSlopes.filter((s) => s >= t).length / rockSlopes.length) * 100).toFixed(1)}%`;
    console.log(`  rock slopeM  p50=${pct(rockSlopes, 0.5)} p75=${pct(rockSlopes, 0.75)} p90=${pct(rockSlopes, 0.9)} p95=${pct(rockSlopes, 0.95)} p99=${pct(rockSlopes, 0.99)} max=${rockSlopes[rockSlopes.length - 1]?.toFixed(2)}`);
    console.log(`  alpineGround p50=${pct(groundSlopes, 0.5)} p90=${pct(groundSlopes, 0.9)} p99=${pct(groundSlopes, 0.99)} max=${groundSlopes[groundSlopes.length - 1]?.toFixed(2)} (cells=${groundSlopes.length})`);
    console.log(`  rocks on slope ≥1.5=${over(1.5)} ≥2.0=${over(2.0)} ≥2.5=${over(2.5)} ≥3.0=${over(3.0)} ≥4.0=${over(4.0)} ≥6.0=${over(6.0)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
