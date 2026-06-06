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
// Tags include the world's `entity.kind` values (see src/world/entity-kinds.ts)
// so the ArtResolver — which requests `tagsAny:[entity.kind]` — binds each
// kind to a sensible asset. Kinds with no tag here fall back to the procedural
// / vendored renderer.
const SEED = [
  { file: 'bush-64.png', prompt: 'a small round green bush', width: 64, height: 64,
    kind: 'decoration', tags: ['bush', 'green', 'shrub', 'fern'],
    affinity: { biome: ['grassland', 'forest'] } },
  { file: 'tree-64.png', prompt: 'a leafy oak tree', width: 64, height: 64,
    kind: 'decoration',
    tags: ['tree', 'oak', 'oak_tree', 'pine_tree', 'birch_tree', 'orange_tree', 'pale_tree', 'brown_tree'],
    affinity: { biome: ['forest', 'grassland'] } },
  { file: 'rock-64.png', prompt: 'a mossy grey boulder', width: 64, height: 64,
    kind: 'decoration', tags: ['rock', 'boulder', 'stone', 'rock_pile', 'pebbles'],
    affinity: { biome: ['grassland', 'quarry', 'mountain'] } },
  { file: 'flowers-64.png', prompt: 'a cluster of wildflowers', width: 64, height: 64,
    kind: 'decoration', tags: ['flower', 'wildflower'], affinity: { biome: ['grassland', 'meadow'] } },
  // Buildings (128×128). Tags are the building preset names (= entity.kind, see
  // src/world/building-descriptor.ts) so the building ArtResolver binds each
  // preset to its sprite; presets with no row here fall back to parametric massing.
  { file: 'cottage-128.png', prompt: 'isometric medieval cottage house with thatched roof, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['cottage'],
    affinity: { era: ['medieval'] } },
  { file: 'temple_small-128.png', prompt: 'isometric small ancient stone temple with columns and pediment roof, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['temple_small'],
    affinity: { era: ['ancient', 'medieval'] } },
  { file: 'castle_keep-128.png', prompt: 'isometric stone castle keep tower with battlements, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['castle_keep'],
    affinity: { era: ['medieval'] } },
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
