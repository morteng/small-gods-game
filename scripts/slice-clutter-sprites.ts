/**
 * Slice a TTI clutter SPRITE SHEET (grass tufts / wildflowers / pebbles on a magenta
 * field) into a fixed-grid ALPHA sprite atlas the terrain shader scatter-stamps.
 *
 *   npx tsx scripts/slice-clutter-sprites.ts .dev-grabs/clutter-sprites-01.png
 *
 * Steps: green-vs-magenta key → connected-component blobs → trim → categorise each
 * (grass | flower | rock, by colour) → base-anchor into CELL×CELL cells, ordered by
 * category → write public/textures/clutter/atlas.png (RGBA, COLS×rows grid) + a
 * manifest.json giving CELL, cols, and the [start,count) layer range per category.
 * Pure offline (pngjs) — no GPU, no network.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/textures/clutter');
const CELL = 64;          // atlas cell edge (px)
const COLS = 6;           // atlas grid width in cells
const MIN_AREA = 300;     // drop keying specks smaller than this (px)
const KEY_MAG = 24;       // (min(r,b) − g) above this = magenta background

type Cat = 'grass' | 'flower' | 'reed' | 'rock';

/** One input sheet. `path` alone auto-categorises each blob by colour; `cat=path` FORCES
 *  every blob from that sheet into one category (dedicated boulder / reed / flower sheets). */
interface Input { path: string; forced?: Cat }

function parseInputs(): Input[] {
  const args = process.argv.slice(2);
  if (args.length === 0) return [{ path: '.dev-grabs/clutter-sprites-01.png' }];
  return args.map((a) => {
    const eq = a.indexOf('=');
    if (eq > 0) return { path: a.slice(eq + 1), forced: a.slice(0, eq) as Cat };
    return { path: a };
  });
}

interface Sprite { rgba: Uint8ClampedArray; w: number; h: number; cat: Cat; }

async function loadImage(path: string): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const { data, info } = await sharp(join(ROOT, path)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height };
}

/** Alpha mask: 1 where a pixel is FOREGROUND (green-ish sprite), 0 where magenta. */
function keyMask(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mag = Math.min(r, b) - g;         // strongly + on magenta, strongly − on green sprites
    mask[p] = mag > KEY_MAG ? 0 : 1;
  }
  return mask;
}

/** Separable box max/min filter (radius r). max = dilate, min = erode. Binary in/out. */
function boxFilter(src: Uint8Array, w: number, h: number, r: number, mode: 'max' | 'min'): Uint8Array {
  const pick = mode === 'max' ? Math.max : Math.min;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = src[y * w + x];
    for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < w) v = pick(v, src[y * w + xx]); }
    tmp[y * w + x] = v;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let v = tmp[y * w + x];
    for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < h) v = pick(v, tmp[yy * w + x]); }
    out[y * w + x] = v;
  }
  return out;
}

/** Morphological CLOSE (dilate then erode): bridges the thin magenta gaps BETWEEN the
 *  individual blades of one tuft so a slender clump detects as ONE component, without
 *  merging separate sprites (the sheet's magenta gutters are far wider than `r`). Used
 *  only for component GROUPING — pixels are still copied from the crisp original mask. */
function closeMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return boxFilter(boxFilter(mask, w, h, r, 'max'), w, h, r, 'min');
}

/** 8-connected components over the foreground mask → bounding boxes (min-area filtered). */
function components(mask: Uint8Array, w: number, h: number): { x0: number; y0: number; x1: number; y1: number }[] {
  const seen = new Uint8Array(w * h);
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w, py = (p / w) | 0;
      area++;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const np = ny * w + nx;
        if (mask[np] && !seen[np]) { seen[np] = 1; stack.push(np); }
      }
    }
    if (area >= MIN_AREA) boxes.push({ x0, y0, x1, y1 });
  }
  return boxes;
}

/** Classify a blob by colour: flower (petal pixels), rock (grey/low-sat stone), else grass.
 *  Petals are checked FIRST — a flower cluster is mostly green foliage with a few bright
 *  white/yellow/purple petals, so their PRESENCE (not majority) is the signal. */
function categorise(data: Uint8ClampedArray, w: number, mask: Uint8Array, box: { x0: number; y0: number; x1: number; y1: number }): Cat {
  let n = 0, gray = 0, petal = 0;
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
    const p = y * w + x; if (!mask[p]) continue;
    const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
    n++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const white = r > 195 && g > 195 && b > 180;
    // Flower yellow is RED-leaning (buttercup r≈240 g≈210); a yellow-GREEN grass blade is
    // green-dominant, so require r > g to keep blades out of the flower bucket.
    const yellow = r > 200 && g > 150 && b < 100 && r > g;
    const purple = r > 100 && b > 115 && g < r - 12 && g < b - 12;
    if (white || yellow || purple) petal++;
    // Mossy stone: a chunk of desaturated grey (allow a brown lean) that is NOT green-dominant.
    const greenDom = g > r + 10 && g > b + 10;
    if (!greenDom && sat < 0.24 && mx > 55 && mx < 215) gray++;
  }
  if (n === 0) return 'grass';
  if (petal / n > 0.03) return 'flower';
  if (gray / n > 0.20) return 'rock';
  return 'grass';
}

/** Base-anchored fit of a trimmed blob into a CELL×CELL RGBA cell (centred X, bottom-aligned). */
function toCell(data: Uint8ClampedArray, w: number, mask: Uint8Array, box: { x0: number; y0: number; x1: number; y1: number }): Uint8ClampedArray {
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const pad = 4;
  const scale = Math.min((CELL - pad * 2) / bw, (CELL - pad * 2) / bh, 4);   // never upscale past 4×
  const dw = Math.max(1, Math.round(bw * scale)), dh = Math.max(1, Math.round(bh * scale));
  const offX = ((CELL - dw) / 2) | 0, offY = CELL - dh - pad;               // centre X, sit near bottom
  const cell = new Uint8ClampedArray(CELL * CELL * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sx = box.x0 + Math.min(bw - 1, (x / scale) | 0);
    const sy = box.y0 + Math.min(bh - 1, (y / scale) | 0);
    const sp = sy * w + sx;
    if (!mask[sp]) continue;                                                // keyed → transparent
    const dp = ((offY + y) * CELL + (offX + x)) * 4;
    cell[dp] = data[sp * 4]; cell[dp + 1] = data[sp * 4 + 1]; cell[dp + 2] = data[sp * 4 + 2]; cell[dp + 3] = 255;
  }
  return cell;
}

async function main(): Promise<void> {
  const inputs = parseInputs();
  const sprites: Sprite[] = [];
  for (const inp of inputs) {
    const { data, w, h } = await loadImage(inp.path);
    const mask = keyMask(data, w, h);
    // Group by the CLOSED mask (whole tufts), but copy pixels + classify from the crisp original.
    const boxes = components(closeMask(mask, w, h, 8), w, h);
    for (const b of boxes) {
      sprites.push({ rgba: toCell(data, w, mask, b), w: CELL, h: CELL, cat: inp.forced ?? categorise(data, w, mask, b) });
    }
    console.log(`[slice] ${inp.path}${inp.forced ? ` (forced ${inp.forced})` : ''}: ${boxes.length} blobs`);
  }

  // Order by category so each category is a contiguous layer range the shader gates on.
  const order: Cat[] = ['grass', 'flower', 'reed', 'rock'];
  sprites.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
  const ranges: Record<Cat, { start: number; count: number }> = {
    grass: { start: 0, count: 0 }, flower: { start: 0, count: 0 },
    reed: { start: 0, count: 0 }, rock: { start: 0, count: 0 },
  };
  let idx = 0;
  for (const cat of order) {
    ranges[cat].start = idx;
    for (const s of sprites) if (s.cat === cat) idx++;
    ranges[cat].count = idx - ranges[cat].start;
  }

  // Pack into a COLS-wide grid atlas.
  const rows = Math.max(1, Math.ceil(sprites.length / COLS));
  const atlasW = COLS * CELL, atlasH = rows * CELL;
  const atlasData = new Uint8ClampedArray(atlasW * atlasH * 4);
  sprites.forEach((s, i) => {
    const cx = (i % COLS) * CELL, cy = ((i / COLS) | 0) * CELL;
    for (let y = 0; y < CELL; y++) {
      const srcOff = y * CELL * 4;
      const dstOff = ((cy + y) * atlasW + cx) * 4;
      atlasData.set(s.rgba.subarray(srcOff, srcOff + CELL * 4), dstOff);
    }
  });

  mkdirSync(OUT_DIR, { recursive: true });
  await sharp(Buffer.from(atlasData.buffer), { raw: { width: atlasW, height: atlasH, channels: 4 } })
    .png().toFile(join(OUT_DIR, 'atlas.png'));
  const manifest = { cell: CELL, cols: COLS, rows, count: sprites.length, ranges, cats: sprites.map((s) => s.cat) };
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[slice] ${sprites.length} sprites → public/textures/clutter/atlas.png (${atlasW}×${atlasH})`);
  console.log(`[slice] categories:`, ranges);
}

void main();
