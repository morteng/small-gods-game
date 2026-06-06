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
// the in-app request shape. If the sidecar is absent, the legacy 128² building
// rows below are used as a fallback so a fresh checkout still seeds buildings.

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

// Legacy fallback building rows (square 128²) — used only if the sidecar is absent.
const LEGACY_BUILDINGS = [
  { file: 'cottage-128.png', prompt: 'isometric medieval cottage house with thatched roof, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['cottage'], affinity: { era: ['medieval'] } },
  { file: 'temple_small-128.png', prompt: 'isometric small ancient stone temple with columns and pediment roof, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['temple_small'], affinity: { era: ['ancient', 'medieval'] } },
  { file: 'castle_keep-128.png', prompt: 'isometric stone castle keep tower with battlements, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['castle_keep'], affinity: { era: ['medieval'] } },
  { file: 'tavern-128.png', prompt: 'isometric medieval tavern with timber framing and a hanging sign, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['tavern'], affinity: { era: ['medieval'] } },
  { file: 'market_stall-128.png', prompt: 'isometric medieval market stall with striped awning and goods, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['market_stall'], affinity: { era: ['medieval'] } },
  { file: 'farm_barn-128.png', prompt: 'isometric wooden farm barn with hay bales, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['farm_barn'], affinity: { era: ['medieval'] } },
  { file: 'tower-128.png', prompt: 'isometric medieval stone watchtower, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['tower'], affinity: { era: ['medieval'] } },
  { file: 'dock-128.png', prompt: 'isometric wooden dock pier over water, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['dock'], affinity: { era: ['primordial', 'medieval'] } },
  { file: 'shrine-128.png', prompt: 'isometric small ancient stone shrine with offerings, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['shrine'], affinity: { era: ['ancient', 'medieval'] } },
  { file: 'guard_post-128.png', prompt: 'isometric small wooden guard post with palisade fence, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['guard_post'], affinity: { era: ['medieval'] } },
  { file: 'yurt-128.png', prompt: 'isometric primitive hide yurt tent, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['yurt'], affinity: { era: ['primordial'] } },
  { file: 'longhouse-128.png', prompt: 'isometric viking timber longhouse with thatched roof, 3/4 top-down view',
    width: 128, height: 128, kind: 'building', tags: ['longhouse'], affinity: { era: ['medieval', 'ancient'] } },
];

async function loadBuildings() {
  try {
    await access(BUILDING_SIDECAR);
    const rows = JSON.parse(await readFile(BUILDING_SIDECAR, 'utf8'));
    console.log(`using ${rows.length} building rows from tmp/building-seed.json`);
    return rows;
  } catch {
    console.log('tmp/building-seed.json absent — falling back to legacy 128² building rows');
    return LEGACY_BUILDINGS;
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
