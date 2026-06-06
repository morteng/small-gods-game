// Seed the vendored base asset library from already-generated probe PNGs.
// Copies each PNG into public/asset-library/blobs/ and writes a manifest line,
// computing the SAME content-hash key that src/services/pixellab.ts would
// produce for that prompt+size+recipe — so a later in-game generation of the
// same asset collides on key and the base record wins (dedupe).
//
//   node scripts/seed-base-library.mjs
//
// Re-runnable: it rewrites manifest.ndjson + blobs from the SEED table.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'tmp/pixellab-probe');
const LIB = join(ROOT, 'public/asset-library');
const BLOBS = join(LIB, 'blobs');

// Frozen recipe — must match STYLE_RECIPE + RECIPE_V in src/services/pixellab.ts.
const RECIPE_V = 'v1';
const RECIPE = {
  outline: 'single color black outline',
  shading: 'basic shading',
  detail: 'medium detail',
};

// One row per seeded asset. `file` is relative to tmp/pixellab-probe/.
const SEED = [
  { file: 'bush-64.png', prompt: 'a small round green bush', width: 64, height: 64,
    kind: 'decoration', tags: ['bush', 'green', 'shrub'], affinity: { biome: ['grassland', 'forest'] } },
  { file: 'tree-64.png', prompt: 'a leafy oak tree', width: 64, height: 64,
    kind: 'decoration', tags: ['tree', 'oak'], affinity: { biome: ['forest', 'grassland'] } },
  { file: 'rock-64.png', prompt: 'a mossy grey boulder', width: 64, height: 64,
    kind: 'decoration', tags: ['rock', 'boulder', 'stone'], affinity: { biome: ['grassland', 'quarry', 'mountain'] } },
  { file: 'flowers-64.png', prompt: 'a cluster of wildflowers', width: 64, height: 64,
    kind: 'decoration', tags: ['flower', 'wildflower'], affinity: { biome: ['grassland', 'meadow'] } },
];

/** Reproduce buildCacheKeyInput() from pixellab.ts exactly (field order matters). */
function keyFor(m) {
  const input = JSON.stringify({
    v: RECIPE_V,
    prompt: m.prompt,
    w: m.width,
    h: m.height,
    seed: 0,
    outline: RECIPE.outline,
    shading: RECIPE.shading,
    detail: RECIPE.detail,
  });
  return createHash('sha256').update(input).digest('hex');
}

await mkdir(BLOBS, { recursive: true });

let manifest = '';
for (const m of SEED) {
  const key = keyFor(m);
  const png = await readFile(join(SRC, m.file));
  const blobName = `${m.kind}-${key}.png`;
  await writeFile(join(BLOBS, blobName), png);
  manifest += JSON.stringify({
    key,
    kind: m.kind,
    style: 'pixel-art',
    provider: 'pixellab',
    model: 'pixflux',
    recipeVersion: RECIPE_V,
    prompt: m.prompt,
    width: m.width,
    height: m.height,
    tags: m.tags,
    affinity: m.affinity,
    blob: `blobs/${blobName}`,
    generatedAt: 0,
  }) + '\n';
}

await writeFile(join(LIB, 'manifest.ndjson'), manifest);
console.log(`seeded ${SEED.length} assets into ${LIB}`);
