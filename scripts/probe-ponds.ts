// Throwaway calibration probe (rivers R3): generate the default world across many
// seeds and report the pond distribution the depression-hierarchy keep-rule produces
// (count per seed + area/depth histograms + a few sample spill/outlet coords).
//
// Run: npx tsx scripts/probe-ponds.ts
//
// GOTCHA (load-bearing, from project memory): an offline probe must pass
// generateWithNoise the FULL worldSeed MERGED with planWorldLayout output
// ({...ws, size, pois, connections}). The bare layout generates a DIFFERENT world.
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '@/map/map-generator';
import { planWorldLayout } from '@/world/poi-layout';
import { getHydrologyResult, clearHydrologyCache } from '@/world/hydrology-store';
import { TERRAIN_RELIEF_M } from '@/world/heightfield';
import type { WorldSeed } from '@/core/types';

const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;

// 18 seeds — a spread wide enough to calibrate counts without a batch cost.
const SEEDS = [12345, 777, 999, 1, 42, 2024, 314159, 8675309, 101, 555,
               13, 27, 88, 246, 1337, 4242, 90210, 70707];

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

async function main(): Promise<void> {
  const perSeedCounts: number[] = [];
  const allAreas: number[] = [];
  const allDepthsM: number[] = [];
  let sampleLines: string[] = [];

  for (const seed of SEEDS) {
    clearHydrologyCache();
    const layout = planWorldLayout(ws);
    const laidOut = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
    const { map } = await generateWithNoise(layout.size.width, layout.size.height, seed, laidOut);
    const hy = getHydrologyResult(map);
    const ponds = hy.ponds ?? [];
    perSeedCounts.push(ponds.length);
    for (const p of ponds) { allAreas.push(p.area); allDepthsM.push(p.maxDepth * TERRAIN_RELIEF_M); }

    const areas = ponds.map((p) => p.area).sort((a, b) => a - b);
    console.log(
      `seed ${String(seed).padStart(7)}: ponds=${String(ponds.length).padStart(2)}` +
      `  area[min/med/max]=${areas.length ? `${areas[0]}/${pct(areas, 0.5)}/${areas[areas.length - 1]}` : '-'}` +
      `  size=${map.width}x${map.height}`,
    );
    if (sampleLines.length < 6 && ponds.length > 0) {
      for (const p of ponds.slice(0, 2)) {
        const sx = p.spillCell % map.width, sy = (p.spillCell / map.width) | 0;
        const ox = p.outletCell >= 0 ? p.outletCell % map.width : -1;
        const oy = p.outletCell >= 0 ? (p.outletCell / map.width) | 0 : -1;
        sampleLines.push(
          `  seed ${seed} pond#${p.id}: area=${p.area} depth=${(p.maxDepth * TERRAIN_RELIEF_M).toFixed(2)}m` +
          ` spill=(${sx},${sy}) outlet=(${ox},${oy})`,
        );
      }
    }
  }

  const counts = perSeedCounts.slice().sort((a, b) => a - b);
  const areas = allAreas.slice().sort((a, b) => a - b);
  const depths = allDepthsM.slice().sort((a, b) => a - b);
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

  console.log('\n── sample spill/outlet coords ──');
  console.log(sampleLines.join('\n'));
  console.log('\n── distribution over', SEEDS.length, 'seeds ──');
  console.log(`ponds/seed:  min=${counts[0]} p50=${pct(counts, 0.5)} mean=${mean(perSeedCounts).toFixed(1)} max=${counts[counts.length - 1]}`);
  console.log(`             seeds with 0 ponds: ${perSeedCounts.filter((c) => c === 0).length}/${SEEDS.length}`);
  console.log(`total ponds: ${allAreas.length}`);
  console.log(`area (cells): min=${areas[0]} p50=${pct(areas, 0.5)} p90=${pct(areas, 0.9)} max=${areas[areas.length - 1]}`);
  console.log(`depth (m):   min=${depths[0]?.toFixed(2)} p50=${pct(depths, 0.5)?.toFixed(2)} p90=${pct(depths, 0.9)?.toFixed(2)} max=${depths[depths.length - 1]?.toFixed(2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
