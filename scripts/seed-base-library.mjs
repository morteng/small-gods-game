// Seed the vendored base asset library from already-generated probe PNGs.
// Copies each PNG into public/asset-library/blobs/ and writes a manifest line,
// computing the SAME content-hash key that src/services/pixellab.ts would
// produce for that prompt+size+recipe — so a later in-game generation of the
// same asset collides on key and the base record wins (dedupe).
//
//   node scripts/seed-base-library.mjs
//
// Re-runnable: it rewrites manifest.ndjson + blobs from the row tables.
//
// Decorations are inline. Buildings come from tmp/building-seed.json (written by
// scripts/gen-buildings.ts) when present — those carry the prompt-generation
// system's compiled prompt + native size + recipe/guidance/palette so keys match
// the in-app request shape. If the sidecar is ABSENT, NO buildings are seeded:
// the iso renderer then falls back to the parametric placeholder massing
// (drawIsoBuildingMassing), which is the intended pre-generation state. The old
// 128² building art was deprecated (2026-06-06) — regenerate via gen-buildings.ts.

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'tmp/pixellab-probe');
const LIB = join(ROOT, 'public/asset-library');
const BLOBS = join(LIB, 'blobs');
const BUILDING_SIDECAR = join(ROOT, 'tmp/building-seed.json');

// Frozen recipe — must match STYLE_RECIPE + RECIPE_V in src/services/pixellab.ts.
const RECIPE_V = 'v1';
const RECIPE = {
  outline: 'single color black outline',
  shading: 'basic shading',
  detail: 'medium detail',
};

const DECORATIONS = [
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
];

async function loadBuildings() {
  try {
    await access(BUILDING_SIDECAR);
    const rows = JSON.parse(await readFile(BUILDING_SIDECAR, 'utf8'));
    console.log(`using ${rows.length} building rows from tmp/building-seed.json`);
    return rows;
  } catch {
    console.log('tmp/building-seed.json absent — seeding NO buildings (placeholder massing renders in-game). Run scripts/gen-buildings.ts to regenerate.');
    return [];
  }
}

/** Reproduce buildCacheKeyInput() from pixellab.ts exactly (field order matters). */
function keyFor(m) {
  const base = {
    v: m.recipeVersion ?? RECIPE_V,
    prompt: m.prompt,
    w: m.width,
    h: m.height,
    seed: 0,
    outline: RECIPE.outline,
    shading: RECIPE.shading,
    detail: RECIPE.detail,
  };
  // Appended only when set, matching buildCacheKeyInput's conditional fields.
  if (m.initStrength !== undefined) { base.init = 1; base.initStrength = m.initStrength; }
  if (m.paletteAnchors?.length) base.palette = m.paletteAnchors.join(',');
  return createHash('sha256').update(JSON.stringify(base)).digest('hex');
}

await mkdir(BLOBS, { recursive: true });

const SEED = [...DECORATIONS, ...(await loadBuildings())];

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
    recipeVersion: m.recipeVersion ?? RECIPE_V,
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
