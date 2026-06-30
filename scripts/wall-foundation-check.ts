// scripts/wall-foundation-check.ts
// Numeric end-to-end check of the wall FOUNDATION carve on the REAL default world (no GPU).
// Generates the default world, confirms worldgen persisted barriers on map.barrierRuns, then
// ISOLATES the wall effect by diffing the composed heightfield with vs without barrierRuns
// (getComposedHeightfield is memoised on a key that folds the barrier count, so dropping the
// runs recomputes a barrier-free field). Verifies the footing actually moves terrain under
// walls, stays finite, and is GENTLE (bounded) — the carve shouldn't gouge trenches.
//
//   npx tsx scripts/wall-foundation-check.ts
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '../src/map/map-generator';
import { getComposedHeightfield, clearRoadDeformationCache } from '../src/world/road-deformation';
import { worldStyleOf } from '../src/core/world-style';
import type { WorldSeed } from '../src/core/types';

async function main(): Promise<void> {
  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const seed = 12345;
  const { map } = await generateWithNoise(ws.size.width, ws.size.height, seed, ws);

  const runs = map.barrierRuns ?? [];
  const tally: Record<string, number> = {};
  for (const b of runs) tally[b.run.kind] = (tally[b.run.kind] ?? 0) + 1;
  console.log(`barrierRuns persisted: ${runs.length} — ${JSON.stringify(tally)}`);
  if (runs.length === 0) { console.error('FAIL: worldgen persisted NO barriers'); process.exit(1); }

  const relief = worldStyleOf(map.worldSeed).mountainRelief;
  const withW = getComposedHeightfield(map).slice();

  const saved = map.barrierRuns;
  map.barrierRuns = [];
  clearRoadDeformationCache();
  const without = getComposedHeightfield(map).slice();
  map.barrierRuns = saved;
  clearRoadDeformationCache();

  let changed = 0, maxDiffM = 0, sumDiffM = 0, nonFinite = 0;
  for (let i = 0; i < withW.length; i++) {
    if (!Number.isFinite(withW[i]) || !Number.isFinite(without[i])) { nonFinite++; continue; }
    const dM = Math.abs(withW[i] - without[i]) * relief;     // normalized → metres
    if (dM > 1e-4) { changed++; sumDiffM += dM; if (dM > maxDiffM) maxDiffM = dM; }
  }
  console.log(`cells changed by wall footing: ${changed}  (mean ${(sumDiffM / Math.max(1, changed)).toFixed(2)} m, max ${maxDiffM.toFixed(2)} m)`);
  console.log(`non-finite cells: ${nonFinite}`);

  const ok = changed > 0 && nonFinite === 0 && maxDiffM < 8;   // gentle: a footing never lifts >8 m
  console.log(ok ? 'PASS: walls carve a bounded, finite footing' : 'FAIL: see numbers above');
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
