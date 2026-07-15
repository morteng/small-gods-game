// Ad-hoc probe: generate the default world and report the ground-cover FILL outcome —
// how many tufts were sown, total entity count, and the top vegetation kinds. Throwaway.
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '../src/map/map-generator';
import type { WorldSeed } from '../src/core/types';
import { planWorldLayout } from '../src/world/poi-layout';

async function main(): Promise<void> {
  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const layout = planWorldLayout(ws);
  const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
  const seed = Number(process.argv[2] ?? 12345);

  const t0 = Date.now();
  const { map, world } = await generateWithNoise(layout.size.width, layout.size.height, seed, laidOut);
  const ms = Date.now() - t0;

  const all = world.registry.all();
  const byBrush = new Map<string, number>();
  const byKind = new Map<string, number>();
  for (const e of all) {
    const brush = String(e.id).split('-')[0];
    byBrush.set(brush, (byBrush.get(brush) ?? 0) + 1);
    byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  }
  const fillCount = byBrush.get('grassfill') ?? 0;

  const tileCount = map.width * map.height;
  console.log(`world ${map.width}x${map.height} = ${tileCount} tiles, seed ${seed}, gen ${ms}ms`);
  console.log(`total entities: ${all.length}`);
  console.log(`grassfill tufts: ${fillCount}  (${(100 * fillCount / tileCount).toFixed(1)}% of tiles)`);
  const topKinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log('top kinds:', topKinds.map(([k, n]) => `${k}:${n}`).join('  '));
}
main().catch((e) => { console.error(e); process.exit(1); });
