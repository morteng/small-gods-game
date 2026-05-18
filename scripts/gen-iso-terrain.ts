/**
 * Author-time iso terrain baker — pivot to PixelLab create-tileset.
 *
 * Per terrain type:
 *   1. Build a create-tileset request body (inner + outer + style + seed).
 *   2. SHA-256 the canonical request as cache key.
 *   3. Hit cache at var/iso-terrain-cache/<sha>.png if present; else POST to PixelLab.
 *   4. Decode the Wang-format top-down tileset PNG.
 *   5. For each of 47 cells, look up its blob47 index via WANG_TO_BLOB47 (permutation
 *      table, see Task P4), apply iso warp (45° rotate + 2:1 vertical squash),
 *      stamp into the output atlas at (blob47 % 6, blob47 / 6) × (128, 64).
 *   6. Write public/sprites/iso/terrain/<type>-blob47.png.
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

import { ISO_TERRAIN_TYPES, type IsoTerrainType } from '../src/render/iso/iso-atlas-loader';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DISK_CACHE = join(PROJECT_ROOT, 'var/iso-terrain-cache');
const OUTPUT_DIR = join(PROJECT_ROOT, 'public/sprites/iso/terrain');

const PIXELLAB_API_BASE = 'https://api.pixellab.ai/v2';

const CELL_W = 128;
const CELL_H = 64;
const ATLAS_COLS = 6;
const OUTPUT_W = ATLAS_COLS * CELL_W;
const OUTPUT_H = 8 * CELL_H;

/** Per-type inner/outer + seed. Outer is the visually adjacent terrain. */
const TYPE_RECIPES: Record<IsoTerrainType, { inner: string; outer: string; seed: number }> = {
  grass: { inner: 'lush grass meadow', outer: 'bare brown dirt soil',  seed: 1001 },
  dirt:  { inner: 'bare brown dirt soil', outer: 'lush grass meadow',  seed: 1002 },
  water: { inner: 'calm blue water with subtle waves', outer: 'pale sandy beach', seed: 1003 },
  sand:  { inner: 'pale sandy beach', outer: 'bare brown dirt soil', seed: 1004 },
  stone: { inner: 'cobblestone paved floor', outer: 'bare brown dirt soil', seed: 1005 },
  rocky: { inner: 'rugged grey stone boulders and gravel', outer: 'lush grass meadow', seed: 1006 },
};

const STYLE_RECIPE = {
  outline: 'single color black outline',
  shading: 'basic shading',
  detail: 'medium detail',
} as const;

/**
 * Wang-cell-index → blob47-index permutation. Identity until Task P4
 * inspects the first create-tileset response and locks the real mapping.
 */
const WANG_TO_BLOB47: number[] = Array.from({ length: 47 }, (_, i) => i);

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function buildRequestBody(type: IsoTerrainType): unknown {
  const r = TYPE_RECIPES[type];
  return {
    inner: r.inner,
    outer: r.outer,
    tile_layout: 'wang',
    tile_size: { width: 64, height: 64 },
    outline: STYLE_RECIPE.outline,
    shading: STYLE_RECIPE.shading,
    detail: STYLE_RECIPE.detail,
    seed: r.seed,
  };
}

function canonicalCacheKeyInput(body: unknown): string {
  return JSON.stringify({ v: 'pivot-v1', body });
}

async function fetchTileset(type: IsoTerrainType): Promise<Buffer> {
  const body = buildRequestBody(type);
  const sha = sha256Hex(canonicalCacheKeyInput(body));
  const cachePath = join(DISK_CACHE, `tileset-${sha}.png`);

  if (existsSync(cachePath)) {
    console.log(`[gen-iso-terrain] ${type}: tileset cache hit (${sha.substring(0, 8)})`);
    return readFileSync(cachePath);
  }

  if (process.argv.includes('--dry-run')) {
    throw new Error(`[gen-iso-terrain] ${type}: cache miss and --dry-run set; would have called PixelLab`);
  }

  const apiKey = process.env.PIXELLAB_API_KEY;
  if (!apiKey) throw new Error('PIXELLAB_API_KEY env var not set');

  console.log(`[gen-iso-terrain] ${type}: calling PixelLab create-tileset (sha ${sha.substring(0, 8)})`);
  const res = await fetch(`${PIXELLAB_API_BASE}/create-tileset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PixelLab HTTP ${res.status}: ${text}`.trim());
  }
  const json = (await res.json()) as { image?: { base64?: string } };
  const b64 = json.image?.base64;
  if (!b64) throw new Error('PixelLab response missing image.base64');

  const buf = Buffer.from(b64, 'base64');
  writeFileSync(cachePath, buf);
  console.log(`[gen-iso-terrain] ${type}: tileset cached at ${cachePath}`);
  return buf;
}

/**
 * Slice the Wang tileset PNG into 47 cells.
 *
 * Default assumes a 7×7 grid (49 cells with 2 padding). Task P3 inspects
 * the first real response and adjusts these constants if the layout differs.
 */
function sliceWangTileset(img: NodeImage): NodeImage[] {
  const COLS = 7;
  const ROWS = 7;
  const cellW = Math.floor(img.width / COLS);
  const cellH = Math.floor(img.height / ROWS);
  const cells: NodeImage[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (cells.length >= 47) break;
      const cellCanvas = createCanvas(cellW, cellH);
      const ctx = cellCanvas.getContext('2d');
      ctx.drawImage(img, c * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH);
      cells.push(cellCanvas as unknown as NodeImage);
    }
  }
  return cells;
}

/**
 * Apply iso warp: 45° rotate + 2:1 vertical squash, resampled to 128×64.
 */
function isoWarp(cell: NodeImage, outW = CELL_W, outH = CELL_H): NodeImage {
  const inSize = Math.max(cell.width, cell.height);
  const squared = createCanvas(inSize, inSize);
  const sCtx = squared.getContext('2d');
  sCtx.drawImage(cell, (inSize - cell.width) / 2, (inSize - cell.height) / 2);

  const diag = Math.ceil(inSize * Math.SQRT2);
  const rot = createCanvas(diag, diag);
  const rCtx = rot.getContext('2d');
  rCtx.translate(diag / 2, diag / 2);
  rCtx.rotate(Math.PI / 4);
  rCtx.drawImage(squared as unknown as NodeImage, -inSize / 2, -inSize / 2);

  const out = createCanvas(outW, outH);
  const oCtx = out.getContext('2d');
  oCtx.drawImage(rot as unknown as NodeImage, 0, 0, diag, diag, 0, 0, outW, outH);
  return out as unknown as NodeImage;
}

async function bakeOne(type: IsoTerrainType): Promise<void> {
  const tilesetBuf = await fetchTileset(type);
  const tilesetImg = await loadImage(tilesetBuf);
  const cells = sliceWangTileset(tilesetImg);

  const atlas = createCanvas(OUTPUT_W, OUTPUT_H);
  const aCtx = atlas.getContext('2d');

  for (let wangIdx = 0; wangIdx < cells.length; wangIdx++) {
    const blob47 = WANG_TO_BLOB47[wangIdx] ?? wangIdx;
    if (blob47 < 0 || blob47 > 46) continue;
    const col = blob47 % ATLAS_COLS;
    const row = Math.floor(blob47 / ATLAS_COLS);
    const warped = isoWarp(cells[wangIdx]);
    aCtx.drawImage(warped, col * CELL_W, row * CELL_H);
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
