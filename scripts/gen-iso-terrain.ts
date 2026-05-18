/**
 * Author-time iso terrain baker.
 *
 * Per terrain type:
 *   1. Build PixelLabGenerateOpts (prompt + seed).
 *   2. Compute SHA-256 cache key via buildCacheKeyInput().
 *   3. If var/iso-terrain-cache/<sha>.png exists, reuse it; else POST to PixelLab.
 *   4. Decode the primitive PNG, run composeBlob47Atlas, write public/sprites/iso/terrain/<type>-blob47.png.
 *
 * Run: PIXELLAB_API_KEY=… npm run gen:iso-terrain
 * Dry-run (no API call): npm run gen:iso-terrain -- --dry-run
 */
import { createCanvas, loadImage, type Image as NodeImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { composeBlob47Atlas, PRIMITIVE_W, PRIMITIVE_H, OUTPUT_W, OUTPUT_H } from '../src/render/iso/blob-composer';
import { ISO_TERRAIN_TYPES, type IsoTerrainType } from '../src/render/iso/iso-atlas-loader';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DISK_CACHE = join(PROJECT_ROOT, 'var/iso-terrain-cache');
const OUTPUT_DIR = join(PROJECT_ROOT, 'public/sprites/iso/terrain');

const PIXELLAB_API_BASE = 'https://api.pixellab.ai/v2';

/** Per-type prompt template + fixed seed for reproducibility. */
const TYPE_RECIPES: Record<IsoTerrainType, { prompt: string; seed: number }> = {
  grass: {
    prompt: 'iso 2:1 dimetric grass terrain primitive sheet, 5x3 grid of 128x64 transition tiles for blob autotiling. Top row: NW-outer corner, N edge, NE-outer corner, isolated tuft, reserved. Middle row: W edge, interior grass tile, E edge, NW-inner corner, NE-inner corner. Bottom row: SW-outer corner, S edge, SE-outer corner, SW-inner corner, SE-inner corner. Single-color black outline, basic shading, medium detail.',
    seed: 1001,
  },
  water: {
    prompt: 'iso 2:1 dimetric water terrain primitive sheet, 5x3 grid of 128x64 tiles for blob autotiling. Calm blue water with subtle wave texture. Row 1: outer corners and N edge with reserved cell. Row 2: edges, interior water, and inner corners. Row 3: bottom corners and edges. Black outline, basic shading.',
    seed: 1002,
  },
  sand: {
    prompt: 'iso 2:1 dimetric sand terrain primitive sheet, 5x3 grid of 128x64 tiles for blob autotiling. Warm beach sand with subtle grain. Standard 5x3 wang/blob layout: outer corners, edges, interior tile, inner corners. Black outline, basic shading.',
    seed: 1003,
  },
  dirt: {
    prompt: 'iso 2:1 dimetric dirt terrain primitive sheet, 5x3 grid of 128x64 tiles for blob autotiling. Earthy brown soil with small pebbles. Standard 5x3 wang/blob layout. Black outline, basic shading.',
    seed: 1004,
  },
  stone: {
    prompt: 'iso 2:1 dimetric stone tile floor primitive sheet, 5x3 grid of 128x64 tiles for blob autotiling. Cobblestone or paved stone surface. Standard 5x3 wang/blob layout. Black outline, basic shading.',
    seed: 1005,
  },
  rocky: {
    prompt: 'iso 2:1 dimetric rocky terrain primitive sheet, 5x3 grid of 128x64 tiles for blob autotiling. Rugged rocks, boulders, gravel. Standard 5x3 wang/blob layout. Black outline, basic shading.',
    seed: 1006,
  },
};

const STYLE_RECIPE = {
  outline: 'single color black outline',
  shading: 'basic shading',
  detail: 'medium detail',
} as const;

/** Same canonical hashing as src/services/pixellab.ts buildCacheKeyInput(). */
function buildCacheKeyInput(opts: { prompt: string; width: number; height: number; seed: number }): string {
  return JSON.stringify({
    v: 'v1',
    prompt: opts.prompt,
    w: opts.width,
    h: opts.height,
    seed: opts.seed,
    outline: STYLE_RECIPE.outline,
    shading: STYLE_RECIPE.shading,
    detail: STYLE_RECIPE.detail,
  });
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

async function fetchPrimitiveSheet(type: IsoTerrainType): Promise<Buffer> {
  const recipe = TYPE_RECIPES[type];
  const cacheKeyInput = buildCacheKeyInput({
    prompt: recipe.prompt,
    width: PRIMITIVE_W,
    height: PRIMITIVE_H,
    seed: recipe.seed,
  });
  const sha = sha256Hex(cacheKeyInput);
  const cachePath = join(DISK_CACHE, `${sha}.png`);

  if (existsSync(cachePath)) {
    console.log(`[gen-iso-terrain] ${type}: cache hit (${sha.substring(0, 8)})`);
    return readFileSync(cachePath);
  }

  if (process.argv.includes('--dry-run')) {
    throw new Error(`[gen-iso-terrain] ${type}: cache miss and --dry-run set; would have called PixelLab`);
  }

  const apiKey = process.env.PIXELLAB_API_KEY;
  if (!apiKey) throw new Error('PIXELLAB_API_KEY env var not set');

  // ---- Real PixelLab call ----
  // Reuse the project palette anchor to keep iso assets color-coherent.
  const palettePath = join(PROJECT_ROOT, 'public/sprites/palette/lpc-anchor.png');
  if (!existsSync(palettePath)) {
    throw new Error(`palette swatch not found at ${palettePath}`);
  }
  const paletteB64 = readFileSync(palettePath).toString('base64');

  const body = {
    description: recipe.prompt,
    image_size: { width: PRIMITIVE_W, height: PRIMITIVE_H },
    no_background: true,
    outline: STYLE_RECIPE.outline,
    shading: STYLE_RECIPE.shading,
    detail: STYLE_RECIPE.detail,
    color_image: { type: 'base64', base64: paletteB64, format: 'png' },
    seed: recipe.seed,
    // PixelLab view-angle field — confirmed by call result; if API rejects
    // with "unknown field", remove this line and rely on prompt wording.
    view: 'side-front-2-1-isometric',
  };

  console.log(`[gen-iso-terrain] ${type}: calling PixelLab (sha ${sha.substring(0, 8)})`);
  const res = await fetch(`${PIXELLAB_API_BASE}/create-image-pixflux`, {
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
  console.log(`[gen-iso-terrain] ${type}: cached at ${cachePath}`);
  return buf;
}

async function bakeOne(type: IsoTerrainType): Promise<void> {
  const primitiveBuf = await fetchPrimitiveSheet(type);
  const primitiveImg: NodeImage = await loadImage(primitiveBuf);
  const target = createCanvas(OUTPUT_W, OUTPUT_H);
  composeBlob47Atlas(primitiveImg as unknown as HTMLImageElement, target as unknown as OffscreenCanvas);
  const outPath = join(OUTPUT_DIR, `${type}-blob47.png`);
  ensureDir(dirname(outPath));
  writeFileSync(outPath, target.toBuffer('image/png'));
  const sizeKb = (target.toBuffer('image/png').length / 1024).toFixed(1);
  console.log(`[gen-iso-terrain] ${type}: wrote ${outPath} (${sizeKb} KB)`);
}

async function main(): Promise<void> {
  ensureDir(DISK_CACHE);
  ensureDir(OUTPUT_DIR);
  for (const type of ISO_TERRAIN_TYPES) {
    try {
      await bakeOne(type);
    } catch (err) {
      console.error(`[gen-iso-terrain] ${type} FAILED:`, (err as Error).message);
      if (!process.argv.includes('--continue-on-error')) {
        process.exit(1);
      }
    }
  }
  console.log('[gen-iso-terrain] done');
}

main().catch((err) => {
  console.error('[gen-iso-terrain] fatal:', err);
  process.exit(1);
});
