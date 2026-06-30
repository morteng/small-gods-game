// scripts/place-complex-check.ts
// End-to-end (no-GPU) check that a motte-and-bailey actually lands on a terrain patch:
// expandComplex → complexToPlan → siteComplex earthworks → barrier rings + buildings,
// committed to a real World+GameMap. Confirms the dormant fort layer composes into a
// placeable thing, the motte raises the ground, and the rings + keep exist.
//
//   npx tsx scripts/place-complex-check.ts
import { generateWithNoise } from '../src/map/map-generator';
import { placeComplexOnPatch } from '../src/world/place-complex';
import { getComposedHeightfield } from '../src/world/road-deformation';
import { heightMetresAt } from '../src/world/heightfield';
import { worldStyleOf } from '../src/core/world-style';
import type { Entity, WorldSeed } from '../src/core/types';

async function main(): Promise<void> {
  const ws: WorldSeed = {
    name: 'site-patch', size: { width: 64, height: 64 }, biome: 'temperate',
    pois: [], connections: [], constraints: [],
  } as unknown as WorldSeed;
  const { map, world } = await generateWithNoise(64, 64, 7, ws);
  const W = map.width;
  const relief = worldStyleOf(map.worldSeed).mountainRelief;

  // Drive the demo from a LOW interior cell so the motte is genuinely needed (a hill would
  // correctly get no mound). A real studio lets the seed/user choose; this proves the carve.
  let centre = { x: 32, y: 32 }, lowest = Infinity;
  for (let y = 12; y < 52; y++) for (let x = 12; x < 52; x++) {
    const h = heightMetresAt(map, x, y);
    if (h < lowest) { lowest = h; centre = { x, y }; }
  }
  console.log(`centre ${centre.x},${centre.y}; natural height there ${heightMetresAt(map, centre.x, centre.y).toFixed(2)} m (motteHeight target 8 m)`);

  const before = getComposedHeightfield(map).slice();

  const res = placeComplexOnPatch(world, map, {
    complexTypeId: 'motte_and_bailey', centre, seed: 7, era: 'medieval',
  });

  const after = getComposedHeightfield(map); // re-keyed by the store version bump

  console.log(`barrier rings placed: ${res.barriers.length} (ids ${res.barrierIds.join(', ')})`);
  console.log(`buildings placed: ${res.buildingIds.length} → ${res.buildingIds.join(', ')}`);
  if (res.skippedBuildings.length) console.log(`buildings that did NOT resolve: ${res.skippedBuildings.join(', ')}`);
  console.log(`earthworks: ${res.placed?.earthworks.length ?? 0}, netVolume ${res.placed?.netVolume.toFixed(3) ?? 'n/a'} (≈0 = spoil conserved)`);

  const riseM = (after[centre.y * W + centre.x] - before[centre.y * W + centre.x]) * relief;
  console.log(`ground rise at motte centre: ${riseM.toFixed(2)} m`);

  // Count barrier + building entities actually in the world.
  const ents = world.query({}) as Entity[];
  const barrierEnts = ents.filter((e) => e.kind.endsWith('_run')).length;
  const buildingEnts = ents.filter((e) => !!(e.properties as Record<string, unknown>)?.blueprint).length;
  console.log(`world entities — barriers: ${barrierEnts}, buildings: ${buildingEnts}`);

  const ok = res.barriers.length >= 1 && res.buildingIds.length >= 1 && riseM > 0.5 && barrierEnts >= 1 && buildingEnts >= 1;
  console.log(ok ? 'PASS: a motte-and-bailey is placed, the motte rises, rings + keep render-ready'
                 : 'FAIL: see numbers above');
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
