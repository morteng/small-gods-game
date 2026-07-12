// Throwaway probe: generate the default world on 2 seeds and count R5 boulder pads
// + contact-dirt tiles, cross-checked against the live entity set.
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '@/map/map-generator';
import { planWorldLayout } from '@/world/poi-layout';
import { buildBoulderPadDeformations, BOULDER_PAD_MIN_SCALE } from '@/world/boulder-deformation';
import type { WorldSeed } from '@/core/types';

const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;

async function main(): Promise<void> {
for (const seed of [12345, 777]) {
  const layout = planWorldLayout(ws);
  const laidOut = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
  const { map, world } = await generateWithNoise(layout.size.width, layout.size.height, seed, laidOut);
  const pads = buildBoulderPadDeformations(map);
  const boulders = world.registry.all().filter((e) => e.kind === 'granite-boulder');
  const big = boulders.filter((e) => ((e.properties as { scale?: number }).scale ?? 1) >= BOULDER_PAD_MIN_SCALE);
  let dirtUnder = 0;
  for (const e of big) {
    const t = map.tiles[Math.floor(e.y)]?.[Math.floor(e.x)];
    if (t?.type === 'dirt') dirtUnder++;
  }
  console.log(`seed ${seed}: boulders=${boulders.length} big=${big.length} pads=${pads.length} dirtUnderBig=${dirtUnder}`);
  // Dirt-ring pads (soft ground) mid-map are the best viewing candidates.
  const dirtPads = pads.filter((p) => {
    const [x, y] = p.id.replace('pad:boulder:', '').split(',').map(Number);
    return map.tiles[y]?.[x]?.type === 'dirt' && y > 20 && y < map.height - 20;
  });
  console.log(`  viewable dirt-ring pads: ${dirtPads.slice(0, 8).map((p) => p.id).join(' ')}`);
}
}
main().catch((e) => { console.error(e); process.exit(1); });
