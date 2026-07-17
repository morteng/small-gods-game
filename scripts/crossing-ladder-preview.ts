// scripts/crossing-ladder-preview.ts
// Browserless proof-strip for the §10 crossing continuum (bridge-preview's sibling): composes
// the NATURAL band (stepping stones) plus all seven built rungs of CROSSING_TIER_RECIPES side
// by side into one PNG, and a non-axis-yaw grab (the compose turntable the studio's angle dial
// drives) so the "straight left/right, up/down crossing angles?" question has a visible answer.
//
//   npx tsx scripts/crossing-ladder-preview.ts                # → .dev-grabs/crossing-ladder.png
//   npx tsx scripts/crossing-ladder-preview.ts --seed=3       #   variation-seeded low rungs
//   npx tsx scripts/crossing-ladder-preview.ts --yaw=22.5     #   also → crossing-yaw-22.5.png
//
// Deterministic, money-free grey massing — judge the construction grammar, not the skin.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { resolveBlueprint } from '../src/blueprint/resolve';
import { BRIDGE_RECIPES, bridgeBlueprint } from '../src/blueprint/presets/bridges';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { composeStructure, type Part } from '../src/assetgen/compose';
import { ensureBuildingTypesRegistered } from '../src/blueprint/register-buildings';
import { CROSSING_TIER_RECIPES, CROSSING_TIER_LABELS } from '../src/world/road-use';

const OUT = '.dev-grabs';
const PAD = 10;
const BG: [number, number, number] = [24, 32, 22];   // the studio's dark ground

/** The studio's natural band (kept in sync by eye — a dev diagnostic, not game code):
 *  four irregular flat-ish boulders a stride apart. */
function steppingStonesParts(): Part[] {
  const stones: Array<[number, number, number, number]> = [
    [0.9, 1.55, 0.40, 3], [1.75, 1.35, 0.30, 7], [2.55, 1.6, 0.46, 11], [3.35, 1.4, 0.33, 17],
  ];
  return stones.map(([x, y, radius, seed]) => ({
    prim: 'rock', center: [x, y] as [number, number], baseZ: -0.12,
    radius, seed, aspect: 0.5, jitter: 0.35, mat: 'stone',
  }));
}

interface Cell { label: string; grey: Uint8ClampedArray; size: number }

function strip(cells: Cell[]): PNG {
  const w = cells.reduce((a, c) => a + c.size + PAD, PAD);
  const h = Math.max(...cells.map((c) => c.size)) + 2 * PAD;
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = BG[0]; png.data[i * 4 + 1] = BG[1]; png.data[i * 4 + 2] = BG[2]; png.data[i * 4 + 3] = 255;
  }
  let x0 = PAD;
  for (const c of cells) {
    const y0 = h - PAD - c.size;   // bottom-aligned: every rung stands on the same ground line
    for (let y = 0; y < c.size; y++) {
      for (let x = 0; x < c.size; x++) {
        const s = (y * c.size + x) * 4;
        const a = c.grey[s + 3];
        if (a === 0) continue;
        const d = ((y0 + y) * w + x0 + x) * 4;
        const f = a / 255;
        png.data[d] = Math.round(c.grey[s] * f + BG[0] * (1 - f));
        png.data[d + 1] = Math.round(c.grey[s + 1] * f + BG[1] * (1 - f));
        png.data[d + 2] = Math.round(c.grey[s + 2] * f + BG[2] * (1 - f));
      }
    }
    x0 += c.size + PAD;
  }
  return png;
}

async function composeRung(key: string, seed: number, yawDeg = 0): Promise<Cell> {
  const rb = resolveBlueprint([bridgeBlueprint(BRIDGE_RECIPES[key], `bridge-${key}`, seed)], 1);
  const yaw = (yawDeg * Math.PI) / 180;
  const r = await composeStructure(toGeometry(rb), undefined, yaw ? { yaw } : undefined);
  return { label: key, grey: r.grey, size: r.size };
}

async function main(): Promise<void> {
  ensureBuildingTypesRegistered();
  const argv = process.argv.slice(2);
  const seed = Number(argv.find((a) => a.startsWith('--seed='))?.slice(7) ?? 0);
  const yawArg = argv.find((a) => a.startsWith('--yaw='))?.slice(6);
  mkdirSync(OUT, { recursive: true });

  const cells: Cell[] = [];
  const ford = await composeStructure({ parts: steppingStonesParts() });
  cells.push({ label: 'ford (natural)', grey: ford.grey, size: ford.size });
  for (const key of CROSSING_TIER_RECIPES) cells.push(await composeRung(key, seed));

  const file = join(OUT, 'crossing-ladder.png');
  writeFileSync(file, PNG.sync.write(strip(cells)));
  console.log(`ladder (seed ${seed}) → ${file}`);
  console.log(`  order: ford (natural) | ${CROSSING_TIER_RECIPES.map((k, t) => `t${t} ${CROSSING_TIER_LABELS[t]}`).join(' | ')}`);

  if (yawArg) {
    const deg = Number(yawArg);
    // The yaw proof: a low rung + the framed beam, both composed OFF-axis.
    const yawCells = [
      await composeRung('log-rail', seed, deg),
      await composeRung('timber-beam', 0, deg),
    ];
    const yfile = join(OUT, `crossing-yaw-${deg}.png`);
    writeFileSync(yfile, PNG.sync.write(strip(yawCells)));
    console.log(`yaw ${deg}° (log-rail + timber-beam) → ${yfile}`);
  }
}

main();
