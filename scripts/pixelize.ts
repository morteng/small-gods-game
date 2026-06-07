/**
 * Turn the big (1024²) OpenRouter buildings into FINISHED sprites: background
 * removed, cropped, scaled DOWN to a true pixel grid, palette-quantized, crisp
 * 1-bit alpha. No API calls — pure post-processing of tmp/openrouter-probe/*.png.
 *
 *   npx tsx scripts/pixelize.ts
 *
 * Only the `text` variants are processed: they come back transparent with NO
 * ground tile under the building (exactly what we want — drop on any terrain).
 * Writes <subject>-px<size>.png + finals.js (window.AB_FINALS) for the A/B viewer.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { createCanvas, loadImage } from 'canvas';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'tmp/openrouter-probe');
const SIZE = 128;          // single large native size (1:1 / integer-scale in game)
const PALETTE_K = 28;      // colours after median-cut

interface Img { data: Uint8Array; w: number; h: number }
const px = (im: Img, x: number, y: number) => (y * im.w + x) * 4;

/** Decode any format (PNG or Gemini's JPEG) → RGBA via node-canvas. */
async function loadRGBA(path: string): Promise<Img> {
  const img = await loadImage(path);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, img.width, img.height);
  return { data: new Uint8Array(id.data), w: img.width, h: img.height };
}

/**
 * Chroma-key a flat magenta (#FF00FF) background to transparent. We generate the
 * building ON solid magenta, so this is deterministic — no service, no model. Keys
 * magenta-dominant pixels (red+blue high, green suppressed), which also catches the
 * pinkish anti-aliased fringe while sparing wood/thatch/stone/glass colours. This
 * is the exact same logic that would run client-side on a <canvas> ImageData.
 */
function chromaKeyMagenta(im: Img): void {
  const { data, w, h } = im;
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (r > 90 && b > 90 && g + 38 < r && g + 38 < b) data[i * 4 + 3] = 0;
  }
}

/** Crop to the opaque bounding box. */
function cropOpaque(im: Img): Img {
  const { data, w, h } = im;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (data[px(im, x, y) + 3] > 24) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  if (maxX < 0) return im;
  const cw = maxX - minX + 1, chh = maxY - minY + 1, out = new Uint8Array(cw * chh * 4);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
    const s = ((y + minY) * w + (x + minX)) * 4, d = (y * cw + x) * 4;
    out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
  }
  return { data: out, w: cw, h: chh };
}

/** Box-filter downscale to targetW (alpha-weighted colour, so edges don't bleed). */
function areaResize(src: Img, targetW: number): Img {
  const { data, w, h } = src, scale = w / targetW, targetH = Math.max(1, Math.round(h / scale));
  const out = new Uint8Array(targetW * targetH * 4);
  for (let oy = 0; oy < targetH; oy++) for (let ox = 0; ox < targetW; ox++) {
    const x0 = Math.floor(ox * scale), x1 = Math.max(x0 + 1, Math.floor((ox + 1) * scale));
    const y0 = Math.floor(oy * scale), y1 = Math.max(y0 + 1, Math.floor((oy + 1) * scale));
    let pr = 0, pg = 0, pb = 0, asum = 0, n = 0;
    for (let y = y0; y < Math.min(h, y1); y++) for (let x = x0; x < Math.min(w, x1); x++) {
      const i = (y * w + x) * 4, al = data[i + 3];
      pr += data[i] * al; pg += data[i + 1] * al; pb += data[i + 2] * al; asum += al; n++;
    }
    const d = (oy * targetW + ox) * 4;
    if (asum > 0) { out[d] = Math.round(pr / asum); out[d + 1] = Math.round(pg / asum); out[d + 2] = Math.round(pb / asum); }
    out[d + 3] = Math.round(asum / Math.max(1, n));
  }
  return { data: out, w: targetW, h: targetH };
}

/** Resize to EXACT WxH (area filter). Used for the baked normal map so it aligns
 * pixel-for-pixel with the colour sprite (both fill their own opaque bbox). */
function areaResizeWH(src: Img, W: number, H: number): Img {
  const { data, w, h } = src, sx = w / W, sy = h / H, out = new Uint8Array(W * H * 4);
  for (let oy = 0; oy < H; oy++) for (let ox = 0; ox < W; ox++) {
    const x0 = Math.floor(ox * sx), x1 = Math.max(x0 + 1, Math.floor((ox + 1) * sx));
    const y0 = Math.floor(oy * sy), y1 = Math.max(y0 + 1, Math.floor((oy + 1) * sy));
    let pr = 0, pg = 0, pb = 0, asum = 0, n = 0;
    for (let y = y0; y < Math.min(h, y1); y++) for (let x = x0; x < Math.min(w, x1); x++) {
      const i = (y * w + x) * 4, al = data[i + 3];
      pr += data[i] * al; pg += data[i + 1] * al; pb += data[i + 2] * al; asum += al; n++;
    }
    const d = (oy * W + ox) * 4;
    if (asum > 0) { out[d] = Math.round(pr / asum); out[d + 1] = Math.round(pg / asum); out[d + 2] = Math.round(pb / asum); }
    out[d + 3] = Math.round(asum / Math.max(1, n)) >= 128 ? 255 : 0;   // binarise alpha (no colour quantise — preserves normals)
  }
  return { data: out, w: W, h: H };
}

type RGB = [number, number, number];
function range(box: RGB[]): RGB {
  const mn: RGB = [255, 255, 255], mx: RGB = [0, 0, 0];
  for (const p of box) for (let c = 0; c < 3; c++) { if (p[c] < mn[c]) mn[c] = p[c]; if (p[c] > mx[c]) mx[c] = p[c]; }
  return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
}
/** Median-cut to K representative colours. */
function medianCut(pixels: RGB[], K: number): RGB[] {
  let boxes: RGB[][] = [pixels];
  while (boxes.length < K) {
    let bi = -1, best = -1;
    boxes.forEach((b, i) => { if (b.length < 2) return; const r = range(b), m = Math.max(r[0], r[1], r[2]); if (m > best) { best = m; bi = i; } });
    if (bi < 0) break;
    const b = boxes[bi], r = range(b), ch = r[0] >= r[1] && r[0] >= r[2] ? 0 : (r[1] >= r[2] ? 1 : 2);
    b.sort((p, q) => p[ch] - q[ch]); const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.map(b => {
    let r = 0, g = 0, bl = 0; for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    const n = b.length || 1; return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)] as RGB;
  });
}
function nearest(pal: RGB[], r: number, g: number, b: number): RGB {
  let best = pal[0], bd = Infinity;
  for (const p of pal) { const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < bd) { bd = d; best = p; } }
  return best;
}

/** Quantize palette + binarize alpha → crisp pixel art. */
function quantize(im: Img, K: number): Img {
  const { data, w, h } = im, opaque: RGB[] = [];
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] >= 128) opaque.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  if (!opaque.length) return im;
  const pal = medianCut(opaque, K);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    if (a < 128) { data[i * 4 + 3] = 0; continue; }
    const [r, g, b] = nearest(pal, data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return im;
}

function toPNG(im: Img): Buffer {
  const png = new PNG({ width: im.w, height: im.h });
  png.data = Buffer.from(im.data.buffer, im.data.byteOffset, im.data.byteLength);
  return PNG.sync.write(png);
}

type P = { x: number; y: number };
type Meta = { footprint: P[]; eaves: P[]; ridges: { a: P; b: P }[]; peaks: P[]; apexes: P[]; door: P; chimneys: P[] };
const results = JSON.parse(await readFile(join(DIR, 'results.json'), 'utf8')) as Array<{ subject: string; variant: string; src: string; footprint: { w: number; h: number }; ref?: string; normalSrc?: string; meta?: Meta; prompt?: string; params?: unknown }>;
type FinalVariant = { label: string; src: string; source?: string; prompt?: string; ref?: string | null; normal?: string | null; params?: unknown; meta?: Meta };
const bySubject = new Map<string, { subject: string; footprint: { w: number; h: number }; variants: FinalVariant[] }>();

for (const r of results) {
  if (!['text', 'massing'].includes(r.variant)) continue;
  // colour sprite: chroma-key magenta → crop → downscale → palette-quantise
  const srcImg = await loadRGBA(join(DIR, r.src));
  let im: Img = { data: new Uint8Array(srcImg.data), w: srcImg.w, h: srcImg.h };
  chromaKeyMagenta(im);
  im = cropOpaque(im);
  im = areaResize(im, SIZE);
  im = quantize(im, PALETTE_K);
  const file = `${r.subject}-${r.variant}-px${SIZE}.png`;
  await writeFile(join(DIR, file), toPNG(im));

  // baked normal map (massing only): crop its own silhouette, resize to the EXACT
  // colour-sprite dims so the two align, NO quantise (would corrupt the normals).
  let normalRel: string | null = null;
  if (r.normalSrc) {
    let nm = cropOpaque(await loadRGBA(join(DIR, r.normalSrc)));
    nm = areaResizeWH(nm, im.w, im.h);
    const nfile = `${r.subject}-normal-px${SIZE}.png`;
    await writeFile(join(DIR, nfile), toPNG(nm));
    normalRel = '../openrouter-probe/' + nfile;
  }

  // normalised metadata → this sprite's pixel coords (frac × sprite size)
  const toPx = (p: P): P => ({ x: Math.round(p.x * im.w), y: Math.round(p.y * im.h) });
  const meta: Meta | undefined = r.meta && {
    footprint: r.meta.footprint.map(toPx), eaves: r.meta.eaves.map(toPx),
    ridges: r.meta.ridges.map((s) => ({ a: toPx(s.a), b: toPx(s.b) })),
    peaks: r.meta.peaks.map(toPx), apexes: r.meta.apexes.map(toPx),
    door: toPx(r.meta.door), chimneys: r.meta.chimneys.map(toPx),
  };

  if (!bySubject.has(r.subject)) bySubject.set(r.subject, { subject: 'finished · ' + r.subject, footprint: r.footprint, variants: [] });
  bySubject.get(r.subject)!.variants.push({
    label: `${r.variant} (${im.w}×${im.h})`,
    src: '../openrouter-probe/' + file,
    source: '../openrouter-probe/' + r.src,             // raw generation it came from
    prompt: r.prompt,
    ref: r.ref ? '../openrouter-probe/' + r.ref : null, // massing guide (massing variants)
    normal: normalRel,
    params: r.params,
    meta,
  });
  console.log(`  ✓ ${file}  ${im.w}×${im.h}${normalRel ? ' (+normal)' : ''}${meta ? ` meta:${meta.footprint.length}c/${meta.peaks.length}p` : ''}`);
}

await writeFile(join(DIR, 'finals.js'), `window.AB_FINALS = ${JSON.stringify([...bySubject.values()], null, 2)};\n`);
console.log(`\nDone → finished sprites + normals + finals.js (reload the A/B viewer)`);
