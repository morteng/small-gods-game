/**
 * Author-time iso terrain baker.
 *
 * Flow per terrain type:
 *   1. POST /v2/create-tileset (returns tileset_id + status:processing)
 *   2. Poll GET /v2/tilesets/{id} until tiles array materializes
 *   3. Decode 16 Wang cells (32x32 each)
 *   4. Stitch 13 cells (upscaled to 128px, unwarped) into a 5x3 topdown sheet
 *   5. composeBlob47Atlas in topdown square space → 768x1024 topdown atlas
 *   6. Iso-warp each of the 48 finished cells → 768x512 iso atlas
 *   7. Write public/sprites/iso/terrain/<type>-blob47.png
 *
 * Compose-then-warp: the blob composer is a topdown corner-method assembler —
 * it copies bounding-box quarters and treats each as a tile corner bordered by
 * two cardinal edges. That holds for square tiles, not for iso diamonds (a
 * tile's grid-corner maps to a diamond vertex whose region straddles two
 * quarters). So composition must happen in topdown space; the warp is applied
 * once, afterwards, to each finished tile.
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

import { composeBlob47Atlas, OUTPUT_W, OUTPUT_H, CELL_W, CELL_H } from '../src/render/iso/blob-composer';

/** Topdown primitive/atlas cell size (square) used during composition. */
const TD_CELL = 128;
const ATLAS_COLS = 6;
const ATLAS_ROWS = 8;
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

/**
 * Wang→primitive (col,row) mapping for the 5x3 sheet the composer expects.
 *
 * A PixelLab create-tileset Wang id is the bitmask of corners holding the
 * UPPER (transition) terrain — verified by decoding the 16 cells. Bit layout:
 * bit0=SE, bit1=SW, bit2=NE, bit3=NW.
 *
 * The composer samples each slot's bounding-box quarter as a topdown tile
 * corner (e.g. the TL quarter is the NW corner, bordered by the N and W edges).
 * So each slot needs the cell whose dirt corners match the slot's role:
 *  - CENTER: no dirt corners.
 *  - EDGE: the two corners on the foreign side are dirt.
 *  - INNER (concave): only the single diagonal corner is dirt.
 *  - OUTER (convex): every corner except the center-ward one is dirt.
 */
const WANG_TO_PRIM_COORD: Record<number, readonly [number, number]> = {
  14: [0, 0], // NW_OUTER  — dirt NW+NE+SW (lower only at SE)
  12: [1, 0], // N_EDGE    — dirt NW+NE
  13: [2, 0], // NE_OUTER  — dirt NW+NE+SE (lower only at SW)
  10: [0, 1], // W_EDGE    — dirt NW+SW
  0:  [1, 1], // CENTER    — all lower
  5:  [2, 1], // E_EDGE    — dirt NE+SE
  8:  [3, 1], // NW_INNER  — dirt only at NW
  4:  [4, 1], // NE_INNER  — dirt only at NE
  11: [0, 2], // SW_OUTER  — dirt NW+SW+SE (lower only at NE)
  3:  [1, 2], // S_EDGE    — dirt SW+SE
  7:  [2, 2], // SE_OUTER  — dirt NE+SW+SE (lower only at NW)
  2:  [3, 2], // SW_INNER  — dirt only at SW
  1:  [4, 2], // SE_INNER  — dirt only at SE
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

  // Poll. PixelLab returns HTTP 423 (Locked) with `{detail: "still being generated"}`
  // while the job is in progress; treat that and HTTP 202 as keep-polling signals.
  // Only HTTP 200 with a populated `tileset.tiles` indicates completion.
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const getRes = await fetch(`${PIXELLAB_API_BASE}/tilesets/${tilesetId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await getRes.text();
    let json: (TilesetResponse & { detail?: string }) | null = null;
    try { json = JSON.parse(text) as TilesetResponse & { detail?: string }; } catch { /* ignore */ }
    if (getRes.status === 423 || getRes.status === 202) {
      const msg = json?.detail ?? `HTTP ${getRes.status}`;
      console.log(`[gen-iso-terrain] ${type}: ${msg}`);
      continue;
    }
    if (!getRes.ok) {
      throw new Error(`GET /tilesets/${tilesetId} HTTP ${getRes.status}: ${text.trim()}`);
    }
    if (json?.tileset?.tiles?.length) {
      console.log(`[gen-iso-terrain] ${type}: tileset ready (${json.tileset.tiles.length} tiles)`);
      return json;
    }
    if (typeof json?.detail === 'string') {
      console.log(`[gen-iso-terrain] ${type}: ${json.detail}`);
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
 * Iso-warp one finished topdown tile (TD_CELL×TD_CELL) → 128×64 dimetric.
 * Steps: 45° rotate + 2:1 squash. Nearest-neighbor throughout (pixel art).
 */
function warpCell(img: NodeImage): NodeImage {
  const diag = Math.ceil(TD_CELL * Math.SQRT2);
  const rot = createCanvas(diag, diag);
  const rCtx = rot.getContext('2d');
  rCtx.imageSmoothingEnabled = false;
  rCtx.translate(diag / 2, diag / 2);
  rCtx.rotate(Math.PI / 4);
  rCtx.drawImage(img, -TD_CELL / 2, -TD_CELL / 2);

  // The rotated bbox is square; resampling to 2:1 produces the dimetric squash.
  const out = createCanvas(CELL_W, CELL_H);
  const oCtx = out.getContext('2d');
  oCtx.imageSmoothingEnabled = false;
  oCtx.drawImage(rot as unknown as NodeImage, 0, 0, diag, diag, 0, 0, CELL_W, CELL_H);
  return out as unknown as NodeImage;
}

/**
 * Stitch the 13 named Wang cells (upscaled to TD_CELL, NOT warped) into the
 * 5×3 topdown primitive sheet the composer expects.
 */
async function buildTopdownPrimitiveSheet(tileset: TilesetResponse['tileset']): Promise<NodeImage> {
  if (!tileset?.tiles?.length) throw new Error('buildTopdownPrimitiveSheet: empty tileset');

  const byWangId = new Map<number, { base64: string }>();
  for (const tile of tileset.tiles) {
    const n = Number(tile.id);
    if (!Number.isInteger(n) || n < 0 || n > 15) continue;
    byWangId.set(n, tile.image);
  }

  const sheet = createCanvas(TD_CELL * 5, TD_CELL * 3);
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
    // Nearest-neighbor upscale 32→TD_CELL; warp is deferred until after composition.
    sCtx.drawImage(cellImg, col * TD_CELL, row * TD_CELL, TD_CELL, TD_CELL);
  }

  return sheet as unknown as NodeImage;
}

async function bakeOne(type: IsoTerrainType): Promise<void> {
  const json = await fetchTilesetCached(type);
  const primSheet = await buildTopdownPrimitiveSheet(json.tileset);

  // Compose the 47-blob atlas in topdown square space.
  const topdown = createCanvas(TD_CELL * ATLAS_COLS, TD_CELL * ATLAS_ROWS);
  composeBlob47Atlas(
    primSheet as unknown as HTMLImageElement,
    topdown as unknown as OffscreenCanvas,
    TD_CELL, TD_CELL,
  );

  // Iso-warp each finished cell into the 768×512 iso atlas.
  const atlas = createCanvas(OUTPUT_W, OUTPUT_H);
  const aCtx = atlas.getContext('2d');
  aCtx.imageSmoothingEnabled = false;
  const cell = createCanvas(TD_CELL, TD_CELL);
  const cellCtx = cell.getContext('2d');
  cellCtx.imageSmoothingEnabled = false;
  for (let row = 0; row < ATLAS_ROWS; row++) {
    for (let col = 0; col < ATLAS_COLS; col++) {
      cellCtx.clearRect(0, 0, TD_CELL, TD_CELL);
      cellCtx.drawImage(
        topdown as unknown as NodeImage,
        col * TD_CELL, row * TD_CELL, TD_CELL, TD_CELL,
        0, 0, TD_CELL, TD_CELL,
      );
      const warped = warpCell(cell as unknown as NodeImage);
      aCtx.drawImage(warped, col * CELL_W, row * CELL_H);
    }
  }

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
