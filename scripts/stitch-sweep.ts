// scripts/stitch-sweep.ts
//
// Gate-stitch sweep — the "stitch ≈ 0" verification harness (synthesis 2.1). Generates the
// DEFAULT world (laid out via `planWorldLayout`, the same path the live game takes) across many
// fixed genSeeds and asserts that NEITHER gate stitch (interior-gate stitch / orphan-gate spur)
// ever fired: gates are committed portal nodes with commit-time half-edge repair
// (`repairGateHalfEdges`), so a firing means the by-construction wiring missed. Exits non-zero
// on any firing.
//
//   npx tsx scripts/stitch-sweep.ts               # the default 24-seed sweep
//   npx tsx scripts/stitch-sweep.ts 12345 777     # explicit seeds (parallelize across shells)
//
// Deterministic: fixed seed list, no Date.now(). Each seed is a full worldgen (~50 s) — sweep
// runs are an offline gate, not a unit test.

import { readFileSync } from 'node:fs';
import { generateWithNoise } from '../src/map/map-generator';
import { planWorldLayout } from '../src/world/poi-layout';
import type { WorldSeed } from '../src/core/types';

/** Varied fixed seeds: the two lint seeds + primes/odd composites spread across magnitudes. */
const DEFAULT_SEEDS = [
  12345, 777, 42, 7, 999, 31337, 271828, 314159, 55555, 86753,
  123457, 246810, 500009, 700001, 987654, 1048573, 1500450, 2718281,
  3141592, 4294967, 6700417, 7777777, 8675309, 9999991,
];

async function main(): Promise<void> {
  const argSeeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
  const seeds = argSeeds.length ? argSeeds : DEFAULT_SEEDS;

  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const layout = planWorldLayout(ws);
  const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };

  let totalFirings = 0;
  for (const seed of seeds) {
    const t0 = Date.now();
    const { map } = await generateWithNoise(layout.size.width, layout.size.height, seed, laidOut);
    const stitches = map.stats.gateStitches ?? [];
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (stitches.length === 0) {
      console.log(`seed ${seed}: ✓ 0 stitches (${secs}s)`);
    } else {
      totalFirings += stitches.length;
      console.log(`seed ${seed}: ✘ ${stitches.length} stitch firing(s) (${secs}s)`);
      for (const s of stitches) {
        console.log(`    ${s.phase} @ ${s.runId} (${s.x},${s.y}) carved ${s.carved} tile(s)`);
      }
    }
  }

  console.log(totalFirings === 0
    ? `\nPASS: 0 stitch firings across ${seeds.length} seed(s)`
    : `\nFAIL: ${totalFirings} stitch firing(s) — commit-time gate repair missed; see above`);
  if (totalFirings > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
