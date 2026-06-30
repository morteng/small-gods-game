// scripts/detail-coverage-check.ts
// Verifies the detail-patch coverage guarantee on the REAL default world (no GPU):
// EVERY cell carved by a non-road/river deformation (settlement pads, wall foundations,
// levees) must lie inside the detail mask — otherwise its sub-tile relief (which the
// detail SAMPLER does render) seams against the coarse one-quad-per-tile grid where no
// patch reaches. Also reports how many of those cells the OLD behaviour (featureRadius<0,
// i.e. water+road coverage only) left uncovered — i.e. what the new pass actually fixes.
//
//   npx tsx scripts/detail-coverage-check.ts
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '../src/map/map-generator';
import { computeDetailMask } from '../src/world/terrain-detail';
import { getWorldDeformationStore } from '../src/world/road-deformation';
import type { GameMap, WorldSeed } from '../src/core/types';

function featureCells(map: GameMap): Array<{ x: number; y: number; src: string }> {
  const W = map.width, H = map.height;
  const out: Array<{ x: number; y: number; src: string }> = [];
  for (const def of getWorldDeformationStore(map).list()) {
    if (def.source === 'road:cut' || def.source === 'river:incision') continue;
    const x0 = Math.max(0, Math.floor(def.bounds.minX)), y0 = Math.max(0, Math.floor(def.bounds.minY));
    const x1 = Math.min(W - 1, Math.ceil(def.bounds.maxX)), y1 = Math.min(H - 1, Math.ceil(def.bounds.maxY));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (def.mask(x, y) > 0) out.push({ x, y, src: def.source });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
  const { map } = await generateWithNoise(ws.size.width, ws.size.height, 12345, ws);
  const W = map.width;

  const cells = featureCells(map);
  const bySrc: Record<string, number> = {};
  for (const c of cells) bySrc[c.src] = (bySrc[c.src] ?? 0) + 1;
  console.log(`non-road/river carve cells: ${cells.length} — ${JSON.stringify(bySrc)}`);
  if (cells.length === 0) { console.log('no pad/wall/levee carves in this world — nothing to cover'); return; }

  const maskNew = computeDetailMask(map);                       // default: featureRadius 1 (ON)
  const maskOld = computeDetailMask(map, { featureRadius: -1 }); // legacy: water+road only

  let uncoveredNew = 0, uncoveredOld = 0;
  for (const { x, y } of cells) {
    if (!maskNew[y * W + x]) uncoveredNew++;
    if (!maskOld[y * W + x]) uncoveredOld++;
  }
  console.log(`uncovered by OLD (water+road only): ${uncoveredOld}  ← the seam gap`);
  console.log(`uncovered by NEW (feature pass on): ${uncoveredNew}  ← must be 0`);

  const ok = uncoveredNew === 0 && uncoveredOld > 0;
  console.log(ok
    ? `PASS: feature pass closes ${uncoveredOld} previously-uncovered carve cells; coverage now complete`
    : uncoveredNew !== 0 ? 'FAIL: new pass still leaves carve cells uncovered'
    : 'NOTE: old behaviour already covered everything here (no gap to close in this world)');
  if (uncoveredNew !== 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
