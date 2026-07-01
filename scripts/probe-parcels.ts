// scripts/probe-parcels.ts — verify the Slice 2 parcel graph on real generated worlds.
// For each settlement plan: is the parcel model persisted? are all its buildings on the
// home bank? do far banks get labelled + crossings found? Uses an INDEPENDENT re-check of
// "on the home bank" (a fresh flood-fill) so we're not just trusting the code under test.
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '../src/map/map-generator';
import { WATER_TYPES } from '../src/core/constants';
import type { WorldSeed } from '../src/core/types';

async function main(): Promise<void> {
  const seeds = process.argv.slice(2).map(Number).filter(Number.isFinite);
  const useSeeds = seeds.length ? seeds : [12345, 777, 42];
  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;

  for (const seed of useSeeds) {
    const { map, world } = await generateWithNoise(ws.size.width, ws.size.height, seed, ws);
    const tiles = map.tiles;
    const isWater = (x: number, y: number) => WATER_TYPES.has(tiles[y]?.[x]?.type ?? '');

    // Independent flood-fill (NOT the code under test) of the home bank around a centre.
    const homeBank = (cx: number, cy: number, reach: number): Set<string> => {
      const icx = Math.round(cx), icy = Math.round(cy);
      const seen = new Set<string>();
      if (isWater(icx, icy)) return seen;
      const st: [number, number][] = [[icx, icy]]; seen.add(`${icx},${icy}`);
      while (st.length) {
        const [x, y] = st.pop()!;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
          if (Math.abs(nx - icx) > reach || Math.abs(ny - icy) > reach) continue;
          if (nx < 0 || ny < 0 || ny >= tiles.length || nx >= (tiles[0]?.length ?? 0)) continue;
          if (isWater(nx, ny)) continue;
          const k = `${nx},${ny}`; if (seen.has(k)) continue; seen.add(k); st.push([nx, ny]);
        }
      }
      return seen;
    };

    const plans = map.settlementPlans ?? [];
    let withParcels = 0, riverAdjacent = 0, straddlers = 0, withAdjacent = 0, withCrossing = 0, totalBuildings = 0;
    for (const plan of plans) {
      const near = homeBank(plan.center.x, plan.center.y, 40);
      // Does any water sit near this settlement? (river-adjacent)
      let touchesWater = false;
      for (const k of near) {
        const c = k.indexOf(','); const x = +k.slice(0, c), y = +k.slice(c + 1);
        if (isWater(x + 1, y) || isWater(x - 1, y) || isWater(x, y + 1) || isWater(x, y - 1)) { touchesWater = true; break; }
      }
      if (touchesWater) riverAdjacent++;
      if (plan.parcels) withParcels++;
      if (plan.parcels?.adjacent.length) withAdjacent++;
      if (plan.parcels?.crossings.length) withCrossing++;

      // Every building lot on this plan must sit on the home bank (independent check).
      const bank = homeBank(plan.center.x, plan.center.y, 60);
      for (const lot of plan.lots) {
        if (!lot.buildingId) continue;
        totalBuildings++;
        const off = lot.tiles.some((t: { x: number; y: number }) => !bank.has(`${t.x},${t.y}`) && !isWater(t.x, t.y));
        if (off) straddlers++;
      }
    }
    void world;
    console.log(`seed ${seed}: ${plans.length} settlements · ${riverAdjacent} river-adjacent · `
      + `${withParcels} carry a parcel graph · ${withAdjacent} have a far bank · ${withCrossing} have a crossing · `
      + `${totalBuildings} buildings · ${straddlers} off-home-bank`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
