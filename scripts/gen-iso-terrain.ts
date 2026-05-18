/**
 * Author-time iso terrain baker (pivot of pivot).
 *
 * Flow per terrain type:
 *   1. POST /v2/create-tileset (returns tileset_id + status:processing)
 *   2. Poll GET /v2/tilesets/{id} until tiles array materializes
 *   3. Decode 16 Wang cells (32x32 each)
 *   4. Per cell: upscale 32→128 nearest-neighbor + iso-warp to 128x64
 *   5. Stitch 13 warped cells into a 5x3 primitive sheet
 *   6. composeBlob47Atlas(sheet) → 768x512 atlas
 *   7. Write public/sprites/iso/terrain/<type>-blob47.png
 *
 * Run: PIXELLAB_API_KEY=… npm run gen:iso-terrain
 * Single type: npm run gen:iso-terrain -- --type=grass
 * Dry-run: npm run gen:iso-terrain -- --dry-run
 */
import { createCanvas, loadImage, type Image as NodeImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  composeBlob47Atlas,
  PRIMITIVE_W, PRIMITIVE_H, OUTPUT_W, OUTPUT_H, CELL_W, CELL_H,
} from '../src/render/iso/blob-composer';
import { ISO_TERRAIN_TYPES, type IsoTerrainType } from '../src/render/iso/iso-atlas-loader';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DISK_CACHE = join(PROJECT_ROOT, 'var/iso-terrain-cache');
const OUTPUT_DIR = join(PROJECT_ROOT, 'public/sprites/iso/terrain');

const PIXELLAB_API_BASE = 'https://api.pixellab.ai/v2';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

/** Per-type description recipes for the create-tileset call. */
const TYPE_RECIPES: Record<IsoTerrainType, { lower: string; upper: string; seed: number }> = {
  grass: { lower: 'lush grass meadow',                       upper: 'bare brown dirt soil',          seed: 1001 },
  dirt:  { lower: 'bare brown dirt soil',                    upper: 'lush grass meadow',             seed: 1002 },
  water: { lower: 'calm blue water with subtle waves',       upper: 'pale sandy beach',              seed: 1003 },
  sand:  { lower: 'pale sandy beach',                        upper: 'bare brown dirt soil',          seed: 1004 },
  stone: { lower: 'cobblestone paved floor',                 upper: 'bare brown dirt soil',          seed: 1005 },
  rocky: { lower: 'rugged grey stone boulders and gravel',   upper: 'lush grass meadow',             seed: 1006 },
};

const STYLE_RECIPE = {
  outline: 'single color black outline',
  shading: 'basic shading',
  detail: 'medium detail',
} as const;

/** Wang→primitive (col,row) mapping for the 5x3 sheet the composer expects. */
const WANG_TO_PRIM_COORD: Record<number, readonly [number, number]> = {
  8:  [0, 0], // NW_OUTER
  12: [1, 0], // N_EDGE
  4:  [2, 0], // NE_OUTER
  10: [0, 1], // W_EDGE
  15: [1, 1], // CENTER
  5:  [2, 1], // E_EDGE
  7:  [3, 1], // NW_INNER
  11: [4, 1], // NE_INNER
  2:  [0, 2], // SW_OUTER
  3:  [1, 2], // S_EDGE
  1:  [2, 2], // SE_OUTER
  13: [3, 2], // SW_INNER
  14: [4, 2], // SE_INNER
};

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function buildRequestBody(type: IsoTerrainType): unknown {
  const r = TYPE_RECIPES[type];
  return {
    lower_description: r.lower,
    upper_description: r.upper,
    tile_size: { width: 32, height: 32 },
    outline: STYLE_RECIPE.outline,
    shading: STYLE_RECIPE.shading,
    detail: STYLE_RECIPE.detail,
    seed: r.seed,
  };
}

function canonicalCacheKeyInput(body: unknown): string {
  return JSON.stringify({ v: 'pivot-v2-wang', body });
}

interface TilesetResponse {
  tileset?: {
    total_tiles: number;
    tile_size: { width: number; height: number };
    terrain_types: string[];
    tiles: Array<{
      id: string;
      name: string;
      image: { type: string; base64: string };
    }>;
  };
}

async function fetchTilesetJson(type: IsoTerrainType, apiKey: string): Promise<TilesetResponse> {
  const body = buildRequestBody(type);

  // POST to start the async job.
  console.log(`[gen-iso-terrain] ${type}: POST /create-tileset`);
  const postRes = await fetch(`${PIXELLAB_API_BASE}/create-tileset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!postRes.ok) {
    const text = await postRes.text().catch(() => '');
    throw new Error(`create-tileset HTTP ${postRes.status}: ${text}`.trim());
  }
  const postJson = (await postRes.json()) as { tileset_id?: string; status?: string };
  const tilesetId = postJson.tileset_id;
  if (!tilesetId) throw new Error(`create-tileset response missing tileset_id: ${JSON.stringify(postJson)}`);
  console.log(`[gen-iso-terrain] ${type}: tileset_id=${tilesetId} status=${postJson.status}`);

  // Poll.
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const getRes = await fetch(`${PIXELLAB_API_BASE}/tilesets/${tilesetId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!getRes.ok) {
      const text = await getRes.text().catch(() => '');
      throw new Error(`GET /tilesets/${tilesetId} HTTP ${getRes.status}: ${text}`.trim());
    }
    const getJson = (await getRes.json()) as TilesetResponse & { detail?: string };
    if (getJson.tileset?.tiles?.length) {
      console.log(`[gen-iso-terrain] ${type}: tileset ready (${getJson.tileset.tiles.length} tiles)`);
      return getJson;
    }
    if (typeof getJson.detail === 'string') {
      console.log(`[gen-iso-terrain] ${type}: ${getJson.detail}`);
    }
  }
  throw new Error(`Polling timeout for tileset ${tilesetId}`);
}

async function fetchTilesetCached(type: IsoTerrainType): Promise<TilesetResponse> {
  const body = buildRequestBody(type);
  const sha = sha256Hex(canonicalCacheKeyInput(body));
  const cachePath = join(DISK_CACHE, `tileset-${sha}.json`);

  if (existsSync(cachePath)) {
    console.log(`[gen-iso-terrain] ${type}: tileset cache hit (${sha.substring(0, 8)})`);
    return JSON.parse(readFileSync(cachePath, 'utf8')) as TilesetResponse;
  }

  if (process.argv.includes('--dry-run')) {
    throw new Error(`[gen-iso-terrain] ${type}: cache miss and --dry-run set; would have called PixelLab`);
  }

  const apiKey = process.env.PIXELLAB_API_KEY;
  if (!apiKey) throw new Error('PIXELLAB_API_KEY env var not set');

  const json = await fetchTilesetJson(type, apiKey);
  ensureDir(dirname(cachePath));
  writeFileSync(cachePath, JSON.stringify(json));
  console.log(`[gen-iso-terrain] ${type}: cached at ${cachePath}`);
  return json;
}

/**
 * Iso-warp a single Wang cell from 32×32 → 128×64 dimetric.
 * Steps: upscale to 128×128 (nearest-neighbor), then 45° rotate + 2:1 squash.
 */
function warpWangCell(img: NodeImage): NodeImage {
  // Step 1: nearest-neighbor upscale 32×32 → 128×128.
  const big = createCanvas(128, 128);
  const bCtx = big.getContext('2d');
  bCtx.imageSmoothingEnabled = false;
  bCtx.drawImage(img, 0, 0, 128, 128);

  // Step 2: rotate 45° around centre on a diag-sized canvas.
  const diag = Math.ceil(128 * Math.SQRT2);
  const rot = createCanvas(diag, diag);
  const rCtx = rot.getContext('2d');
  rCtx.imageSmoothingEnabled = false;
  rCtx.translate(diag / 2, diag / 2);
  rCtx.rotate(Math.PI / 4);
  rCtx.drawImage(big as unknown as NodeImage, -64, -64);

  // Step 3: scale to 128×64 (the rotated bbox is square; resampling to 2:1 produces the dimetric squash).
  const out = createCanvas(CELL_W, CELL_H);
  const oCtx = out.getContext('2d');
  oCtx.imageSmoothingEnabled = false;
  oCtx.drawImage(rot as unknown as NodeImage, 0, 0, diag, diag, 0, 0, CELL_W, CELL_H);
  return out as unknown as NodeImage;
}

async function buildPrimitiveSheet(tileset: TilesetResponse['tileset']): Promise<NodeImage> {
  if (!tileset?.tiles?.length) throw new Error('buildPrimitiveSheet: empty tileset');

  // Index cells by Wang id.
  const byWangId = new Map<number, { base64: string }>();
  for (const tile of tileset.tiles) {
    const n = Number(tile.id);
    if (!Number.isInteger(n) || n < 0 || n > 15) continue;
    byWangId.set(n, tile.image);
  }

  const sheet = createCanvas(PRIMITIVE_W, PRIMITIVE_H);
  const sCtx = sheet.getContext('2d');
  sCtx.imageSmoothingEnabled = false;

  for (const [wangIdStr, [col, row]] of Object.entries(WANG_TO_PRIM_COORD)) {
    const wangId = Number(wangIdStr);
    const tile = byWangId.get(wangId);
    if (!tile) {
      console.warn(`[gen-iso-terrain] missing wang_${wangId} in response — primitive cell (${col},${row}) will be blank`);
      continue;
    }
    const cellImg = await loadImage(Buffer.from(tile.base64, 'base64'));
    const warped = warpWangCell(cellImg);
    sCtx.drawImage(warped, col * CELL_W, row * CELL_H);
  }

  return sheet as unknown as NodeImage;
}

async function bakeOne(type: IsoTerrainType): Promise<void> {
  const json = await fetchTilesetCached(type);
  const primSheet = await buildPrimitiveSheet(json.tileset);

  // Compose 47-blob atlas from the warped primitive sheet.
  const atlas = createCanvas(OUTPUT_W, OUTPUT_H);
  composeBlob47Atlas(primSheet as unknown as HTMLImageElement, atlas as unknown as OffscreenCanvas);

  const outPath = join(OUTPUT_DIR, `${type}-blob47.png`);
  ensureDir(dirname(outPath));
  const buf = atlas.toBuffer('image/png');
  writeFileSync(outPath, buf);
  console.log(`[gen-iso-terrain] ${type}: wrote ${outPath} (${(buf.length / 1024).toFixed(1)} KB)`);
}

async function main(): Promise<void> {
  ensureDir(DISK_CACHE);
  ensureDir(OUTPUT_DIR);
  const typeArg = process.argv.find((a) => a.startsWith('--type='));
  const onlyType = typeArg ? typeArg.split('=')[1] as IsoTerrainType : null;
  const types = onlyType
    ? [onlyType].filter((t) => (ISO_TERRAIN_TYPES as readonly string[]).includes(t)) as IsoTerrainType[]
    : ISO_TERRAIN_TYPES;
  for (const type of types) {
    try {
      await bakeOne(type);
    } catch (err) {
      console.error(`[gen-iso-terrain] ${type} FAILED:`, (err as Error).message);
      if (!process.argv.includes('--continue-on-error')) process.exit(1);
    }
  }
  console.log('[gen-iso-terrain] done');
}

main().catch((err) => {
  console.error('[gen-iso-terrain] fatal:', err);
  process.exit(1);
});
