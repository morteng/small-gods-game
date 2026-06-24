// Probe: biome composition inside each authored climate region of default.json.
// Verifies the W-A region-aware climate fix — desert/steppe/swamp/forest regions
// should now express their authored identity, not the global temperate gradient.
// Mirrors map-generator's own terrain config so the classification matches worldgen.
import { readFileSync } from 'node:fs';
import { planWorldLayout } from '@/world/poi-layout';
import { generateTerrainFields, classifyBiomes } from '@/terrain/terrain-generator';
import { erodeElevation } from '@/terrain/erosion';
import { applyPoiInfluences } from '@/terrain/poi-influence';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledClimate } from '@/terrain/climate';
import { Biome } from '@/terrain/biomes';
import type { WorldSeed, TerrainConfig } from '@/core/types';

async function main() {
  const seed = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf-8')) as WorldSeed;
  const layout = planWorldLayout(seed);
  const W = layout.size.width, H = layout.size.height;
  const maxDim = Math.max(W, H);
  const config: TerrainConfig = {
    seed: 1234, width: W, height: H,
    elevationScale: 6.0 / maxDim, moistureScale: 8.0 / maxDim,
    seaLevel: 0.35, poleFalloff: true, continentWarp: 2.0,
    island: styledIslandSpec(seed) ?? undefined,
    climate: styledClimate(seed),
  } as TerrainConfig;
  const fields = generateTerrainFields(config);
  fields.elevation = erodeElevation(fields.elevation, W, H, { seed: 1234 });
  applyPoiInfluences(fields, layout.pois, config);
  const bm = classifyBiomes(fields, config);
  const biomes = bm.biomes;

  const NAME: Record<number, string> = {};
  for (const [k, v] of Object.entries(Biome)) if (typeof v === 'number') NAME[v as number] = k;

  for (const poi of layout.pois) {
    if (!poi.region) continue;
    const r = poi.region;
    const counts = new Map<number, number>();
    let n = 0;
    for (let y = Math.max(0, r.y_min); y <= Math.min(H - 1, r.y_max); y++) {
      for (let x = Math.max(0, r.x_min); x <= Math.min(W - 1, r.x_max); x++) {
        const b = biomes[y * W + x];
        counts.set(b, (counts.get(b) ?? 0) + 1); n++;
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([b, c]) => `${NAME[b] ?? b} ${Math.round((c / n) * 100)}%`).join(', ');
    console.log(`${(poi.type + ' ' + (poi.name ?? '')).padEnd(28)} → ${top}`);
  }
}
main();
