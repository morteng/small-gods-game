/** Hydrology parity gate: does worldgen build ONE water, or two?
 *
 *  `snapDrySettlementsOffWater` mutates `poi.position` IN PLACE partway through
 *  `generateWithNoise` (src/map/map-generator.ts) — a settlement standing in a lake walks to
 *  dry shore. Everything stamped BEFORE that (biome/water tiles, the river raster, the roads
 *  routed around them) derives from elevation with POI plateaus at LAYOUT positions;
 *  everything derived AFTER — `getHeightfield` (keyed on `poiHeightSignature`),
 *  `getHydrologyResult`, the water network, the render-water ribbon, and the `renderWaterAt`
 *  predicate the crossing seater seats banks with — rebuilds elevation from the SNAPPED
 *  positions. Two hydrologies, one world: the tile truth and the drawn truth disagree, and
 *  bridges get seated against water the player never sees.
 *
 *  This probe generates the world (which performs the snap), then recomputes hydrology twice
 *  from the same recipe — once from the pre-snap POI positions, once from the post-snap ones —
 *  and diffs `waterType`. It EXITS NON-ZERO when any cell differs, so it works as a gate.
 *
 *  Caveat, deliberate: the recompute here does not re-site beaver weirs (the generator adds
 *  them mid-hydrology). Both sides use the identical weir-less recipe, so the DIFF is a
 *  faithful measure of the snap's effect even though neither side is byte-equal to the
 *  generator's own final hydrology.
 *
 *  Also dumps, at the sites you name, every water truth at once (tile `type`/`baseType`,
 *  post-gen hydrology `waterType`, the drawn ribbon value, water-network lake membership) —
 *  which is how you tell "the lake moved" from "the lake was never drawn".
 *
 *  Usage: npx tsx scripts/probe-hydrology-parity.ts [world] [seed] [x,y ...]
 *         e.g. npx tsx scripts/probe-hydrology-parity.ts default 777 213,194 213,200
 */
import { readFileSync } from 'node:fs';
import { planWorldLayout } from '@/world/poi-layout';
import { generateWithNoise } from '@/map/map-generator';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { getHydrologyResult } from '@/world/hydrology-store';
import { getWaterNetwork } from '@/world/water-network-store';
import { buildRenderWaterTypeMemo } from '@/render/gpu/render-water-mask';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { generateHydrology, buildVolcanoScorchMask, styledRiverFlowThreshold } from '@/terrain/hydrology';
import { worldStyleOf } from '@/core/world-style';
import type { WorldSeed, POI, TerrainField } from '@/core/types';

const LAKE = 2;   // WaterType.Lake, as it lands in the hydrology/ribbon arrays

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const worldName = args[0] ?? 'default';
  const seed = Number(args[1] ?? 777);
  const cells: [number, number][] = args.slice(2).map((a) => {
    const [x, y] = a.split(',').map(Number);
    return [x, y] as [number, number];
  }).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

  const ws = JSON.parse(readFileSync(`public/data/worlds/${worldName}.json`, 'utf8')) as WorldSeed;
  const layout = planWorldLayout(ws);
  const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
  const poisBefore = JSON.parse(JSON.stringify(laidOut.pois)) as POI[];
  const W = laidOut.size.width, H = laidOut.size.height;
  // `laidOut.pois` is the array the generator mutates in place — that is the whole point.
  const { map } = await generateWithNoise(W, H, seed, laidOut, {});

  const beforeById = new Map(poisBefore.map((p) => [p.id ?? `${p.type}@${p.position.x},${p.position.y}`, p]));
  const moved: string[] = [];
  for (const b of laidOut.pois) {
    const a = beforeById.get(b.id ?? '');
    if (!a?.position || !b?.position) continue;
    if (a.position.x !== b.position.x || a.position.y !== b.position.y) {
      moved.push(`${b.id ?? b.type} (${a.position.x},${a.position.y})->(${b.position.x},${b.position.y})`);
    }
  }
  console.log(`\n${worldName}/${seed}: pois before ${poisBefore.length} after ${laidOut.pois.length}; POIs moved by snap: ${moved.length}`);
  for (const m of moved) console.log('  ' + m);

  const hydroFor = (pois: POI[]) => {
    const wsX = { ...laidOut, pois };
    const elevation = getHeightfield(seed, W, H, styledIslandSpec(wsX), pois, styledShapeSpec(wsX));
    const fields: TerrainField = {
      elevation, moisture: new Float32Array(elevation.length), temperature: new Float32Array(elevation.length),
    };
    const scorchMask = buildVolcanoScorchMask(pois, W, H, elevation, ELEVATION_SEA_LEVEL,
      worldStyleOf(wsX).mountainRelief);
    return generateHydrology(fields, { seed, width: W, height: H, seaLevel: ELEVATION_SEA_LEVEL }, {
      scorchMask, riverFlowThreshold: styledRiverFlowThreshold(wsX, W, H),
    });
  };
  const pre = hydroFor(poisBefore);
  const post = hydroFor(laidOut.pois);
  let diff = 0, lakeGained = 0, lakeLost = 0;
  for (let i = 0; i < pre.waterType.length; i++) {
    if (pre.waterType[i] !== post.waterType[i]) {
      diff++;
      if (post.waterType[i] === LAKE && pre.waterType[i] !== LAKE) lakeGained++;
      if (pre.waterType[i] === LAKE && post.waterType[i] !== LAKE) lakeLost++;
    }
  }
  console.log(`waterType cells differing pre-snap vs post-snap: ${diff} (lake gained ${lakeGained}, lake lost ${lakeLost})`);

  // The drawn truth, for scale: what the post-gen stores and the renderer's ribbon actually hold.
  const hy = getHydrologyResult(map);
  const ribbon = buildRenderWaterTypeMemo(map);
  const net = getWaterNetwork(map);
  const lakeCells = new Set<number>();
  for (const l of net.lakes) for (const c of l.cells) lakeCells.add(c);
  let hyLake = 0; for (let i = 0; i < hy.waterType.length; i++) if (hy.waterType[i] === LAKE) hyLake++;
  let ribLake = 0; for (let i = 0; i < ribbon.length; i++) if (ribbon[i] === LAKE) ribLake++;
  console.log(`post-gen: hydrology ponds ${hy.ponds?.length ?? 0} | network lakes ${net.lakes.length} (${lakeCells.size} cells) | hy.waterType Lake ${hyLake} | ribbon Lake ${ribLake}`);

  if (cells.length) {
    console.log('\n-- per-cell water truths (pre/post = the two hydrologies above)');
    for (const [x, y] of cells) {
      const i = y * W + x;
      const t = map.tiles[y]?.[x] as unknown as { type?: string; baseType?: string } | undefined;
      console.log(`(${x},${y}) pre=${pre.waterType[i]} post=${post.waterType[i]} | tile=${t?.type} base=${t?.baseType ?? '-'} hyWT=${hy.waterType[i]} ribbon=${ribbon[i]} netLake=${lakeCells.has(i)}`);
    }
  }

  if (diff > 0) {
    console.log(`\nFAIL: ${worldName}/${seed} builds TWO hydrologies (${diff} waterType cells differ pre-snap vs post-snap).`);
    process.exitCode = 1;
  } else {
    console.log(`\nOK: ${worldName}/${seed} builds one hydrology (0 waterType cells differ).`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
