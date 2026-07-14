// Throwaway probe: WHO puts nature entities on water tiles, and on what?
// Groups every nature entity standing on a water-family tile by (brush, kind, tileType)
// so the fix lands on the pass that is actually at fault.
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '@/map/map-generator';
import { planWorldLayout } from '@/world/poi-layout';
import { getRenderWaterMask } from '@/world/render-water';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import type { WorldSeed } from '@/core/types';

const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
const WATER = new Set(['deep_water', 'shallow_water', 'river', 'ocean', 'lake']);

async function main(): Promise<void> {
  for (const seed of [12345, 777]) {
    const layout = planWorldLayout(ws);
    const laidOut = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
    const { map, world } = await generateWithNoise(layout.size.width, layout.size.height, seed, laidOut);
    const renderWater = getRenderWaterMask(map);

    const byKey = new Map<string, number>();
    let total = 0, renderWet = 0;
    for (const e of world.registry.all()) {
      const def = tryGetEntityKindDef(e.kind);
      if (!def || def.category !== 'vegetation') continue;
      const tx = Math.floor(e.x), ty = Math.floor(e.y);
      const t = map.tiles[ty]?.[tx];
      const onTileWater = !!t && WATER.has(t.type);
      const onRenderWater = renderWater(tx, ty);
      if (!onTileWater && !onRenderWater) continue;
      total++;
      if (onRenderWater) renderWet++;
      const brush = e.id.split('-')[0];
      const k = `${brush} | ${e.kind} @ ${t?.type}${onRenderWater ? ' [renderWet]' : ''}`;
      byKey.set(k, (byKey.get(k) ?? 0) + 1);
    }
    console.log(`\nseed ${seed}: nature entities on water = ${total} (renderWater=${renderWet})`);
    for (const [k, n] of [...byKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 26)) {
      console.log(`   ${String(n).padStart(4)}  ${k}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
