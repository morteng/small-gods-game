/**
 * Structure-adherence PILOT (2026-07-11 research follow-up): A/B the two candidate
 * replacements for the OpenRouter FLUX.2 img2img path — both on fal.ai, keys we hold —
 * against the SAME presets, scored with the SAME silhouette-IoU gate the seeder uses.
 *
 *   A. fal-ai/flux-general/image-to-image  (FLUX.1 dev): grey init as the img2img base
 *      + our geometry-derived CANNY edge map as a ControlNet-Union constraint. The only
 *      hosted endpoint that takes init + structural control in one call.
 *   B. fal-ai/qwen-image-edit-2511: instruction editor optimized against image drift.
 *
 * Research + option space: docs/superpowers/2026-07-11-img2img-structure-adherence-research.md
 *
 *   npx tsx scripts/pilot-structure-adherence.ts                 # dry-run plan, $0
 *   FAL_API_KEY=… npx tsx scripts/pilot-structure-adherence.ts --go [preset…]
 *
 * PAID (--go): ~$0.02–0.08 per call, 2 calls per preset, ≤2 attempts each. Outputs land
 * in .dev-grabs/pilot-adherence/ (init/edges/raw/registered PNGs + an IoU table) for
 * eyeballing in addition to the numeric gate. Nothing is persisted to the library/IDB.
 */
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';

import { composeStructure } from '../src/assetgen/compose';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { synthesizeBlueprint } from '../src/blueprint/presets';
import { buildingImagePrompt } from '../src/assetgen/building-image-prompt';
import { compositeOverChroma, chromaKeyMagenta } from '../src/render/chroma-key';
import { type Raster, cropRaster, borderKeyedFraction, registerAlbedo } from '../src/render/sprite-postprocess';
import { MIN_BORDER_KEYED } from '../src/render/generated-building-art-source';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.dev-grabs/pilot-adherence');

const go = process.argv.includes('--go');
const wanted = process.argv.slice(2).filter(a => !a.startsWith('--'));
const PRESETS = wanted.length ? wanted : ['tavern', 'bakehouse', 'smithy', 'cottage'];
// Same A/B on either biller: fal (flux-general union-controlnet + qwen-edit) or
// Replicate (xlabs flux-dev-controlnet canny+i2i + qwen-edit). Added because the fal
// account balance was exhausted on first run (2026-07-11) — both keys live in .env.
const provider = (process.argv.find(a => a.startsWith('--provider='))?.slice(11) ?? 'fal') as 'fal' | 'replicate';
const apiKey = provider === 'fal' ? process.env.FAL_API_KEY : process.env.REPLICATE_API_TOKEN;
if (go && !apiKey) { console.error(`${provider === 'fal' ? 'FAL_API_KEY' : 'REPLICATE_API_TOKEN'} not set. Aborting.`); process.exit(1); }

// The FLUX.1-dev ControlNet-Union checkpoint (fal loads HF repos by path; the schema's
// control_mode enum matches this family). Union-Pro is the widely-used stronger build.
const UNION_PATH = process.env.PILOT_UNION_PATH ?? 'Shakker-Labs/FLUX.1-dev-ControlNet-Union-Pro';
// Practitioner consensus (see research doc): edges carry the silhouette at ~0.6–0.7;
// img2img strength moderate (fal default 0.85 "completely remakes" at 1.0 — pull back).
const CANNY_SCALE = Number(process.env.PILOT_CANNY ?? 0.65);
const I2I_STRENGTH = Number(process.env.PILOT_STRENGTH ?? 0.7);
const MAX_ATTEMPTS = 2;

function toPng(buf: Uint8ClampedArray, w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}
function fromPng(buf: Buffer): Raster {
  const png = PNG.sync.read(buf);
  return { data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength), w: png.width, h: png.height };
}
const dataUri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

/** Geometry-derived "canny": white edges on black wherever the normal map or coverage
 *  changes — exact facet boundaries + the exact silhouette, no detector noise. */
function edgeMap(normal: Uint8ClampedArray, grey: Uint8ClampedArray, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number, c: number) =>
    normal[(y * size + x) * 4 + c] * (grey[(y * size + x) * 4 + 3] >= 8 ? 1 : 0);
  const cov = (x: number, y: number) => (grey[(y * size + x) * 4 + 3] >= 8 ? 255 : 0);
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    let m = Math.abs(cov(x + 1, y) - cov(x - 1, y)) + Math.abs(cov(x, y + 1) - cov(x, y - 1));
    for (let c = 0; c < 3; c++) {
      m += Math.abs(at(x + 1, y, c) - at(x - 1, y, c)) + Math.abs(at(x, y + 1, c) - at(x, y - 1, c));
    }
    const v = m > 48 ? 255 : 0;
    const o = (y * size + x) * 4;
    out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
  }
  return out;
}

/** Synchronous fal.run call; returns the first image as PNG bytes. */
async function falRun(modelId: string, body: Record<string, unknown>): Promise<Buffer> {
  const resp = await fetch(`https://fal.run/${modelId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });
  if (!resp.ok) {
    const txt = (await resp.text().catch(() => '')).slice(0, 400);
    throw new Error(`fal ${modelId}: HTTP ${resp.status}: ${txt}`);
  }
  const json = await resp.json() as { images?: { url?: string }[] };
  const url = json.images?.[0]?.url;
  if (!url) throw new Error(`fal ${modelId}: response contained no image`);
  if (url.startsWith('data:')) {
    const b64 = url.slice(url.indexOf(',') + 1);
    return Buffer.from(b64, 'base64');
  }
  const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!img.ok) throw new Error(`fal ${modelId}: image fetch HTTP ${img.status}`);
  return Buffer.from(await img.arrayBuffer());
}

/** Community models 404 on the models/{name}/predictions endpoint — they need a
 *  version-pinned create on /v1/predictions. Resolved once per model, free GET. */
const versionCache = new Map<string, string>();
async function replicateVersion(model: string): Promise<string> {
  const hit = versionCache.get(model);
  if (hit) return hit;
  const resp = await fetch(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`replicate ${model}: version lookup HTTP ${resp.status}`);
  const v = ((await resp.json()) as { latest_version?: { id?: string } }).latest_version?.id;
  if (!v) throw new Error(`replicate ${model}: no latest_version`);
  versionCache.set(model, v);
  return v;
}

// Low-credit accounts (<$5) are throttled to 6 predictions/min, burst 1 — space the
// creates and honour 429 retry_after instead of burning attempts.
let lastCreate = 0;
const CREATE_SPACING_MS = 11_000;

/** Replicate model call: sync-preferred create (throttle-aware), then poll to terminal state. */
async function replicateRun(model: string, input: Record<string, unknown>, opts: { byVersion?: boolean } = {}): Promise<Buffer> {
  const createUrl = opts.byVersion
    ? 'https://api.replicate.com/v1/predictions'
    : `https://api.replicate.com/v1/models/${model}/predictions`;
  const body = opts.byVersion
    ? { version: await replicateVersion(model), input }
    : { input };
  let resp: Response | null = null;
  for (let i = 0; i < 8; i++) {
    const wait = Math.max(0, lastCreate + CREATE_SPACING_MS - Date.now());
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCreate = Date.now();
    resp = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, Prefer: 'wait=60' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (resp.status !== 429) break;
    const retry = Number(((await resp.json().catch(() => ({}))) as { retry_after?: number }).retry_after ?? 10);
    await new Promise(r => setTimeout(r, (retry + 1) * 1000));
  }
  if (!resp || !resp.ok) {
    const txt = resp ? (await resp.text().catch(() => '')).slice(0, 400) : 'no response';
    throw new Error(`replicate ${model}: HTTP ${resp?.status}: ${txt}`);
  }
  let pred = await resp.json() as { status: string; output?: unknown; error?: string; urls?: { get?: string } };
  const started = Date.now();
  while (pred.status === 'starting' || pred.status === 'processing') {
    if (Date.now() - started > 300_000) throw new Error(`replicate ${model}: timed out polling`);
    await new Promise(r => setTimeout(r, 3000));
    const poll = await fetch(pred.urls!.get!, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) });
    if (!poll.ok) throw new Error(`replicate ${model}: poll HTTP ${poll.status}`);
    pred = await poll.json() as typeof pred;
  }
  if (pred.status !== 'succeeded') throw new Error(`replicate ${model}: ${pred.status}: ${pred.error ?? ''}`.slice(0, 400));
  const out = pred.output;
  const url = Array.isArray(out) ? out[0] as string : out as string;
  if (typeof url !== 'string') throw new Error(`replicate ${model}: no image in output`);
  const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!img.ok) throw new Error(`replicate ${model}: image fetch HTTP ${img.status}`);
  return Buffer.from(await img.arrayBuffer());
}

interface Row { preset: string; provider: string; border: number; iou: number | null; note: string }

async function runOne(
  preset: string, provider: 'flux-general' | 'qwen-edit',
  call: () => Promise<Buffer>, mask: Raster,
): Promise<Row> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let png: Buffer;
    try { png = await call(); }
    catch (err) {
      console.warn(`  ${preset}/${provider} attempt ${attempt}: ${(err as Error).message}`);
      if (attempt === MAX_ATTEMPTS) return { preset, provider, border: 0, iou: null, note: 'generation failed' };
      continue;
    }
    const raw = fromPng(png);
    await writeFile(join(OUT, `${preset}.${provider}.raw.png`), png);
    chromaKeyMagenta(raw.data);
    const border = borderKeyedFraction(raw);
    if (border < MIN_BORDER_KEYED) {
      console.warn(`  ${preset}/${provider} attempt ${attempt}: background did not key (ring ${border.toFixed(2)})`);
      if (attempt === MAX_ATTEMPTS) return { preset, provider, border, iou: null, note: 'background did not key' };
      continue;
    }
    const reg = registerAlbedo(raw, mask);
    if (!reg) return { preset, provider, border, iou: null, note: 'nothing survived keying' };
    await writeFile(join(OUT, `${preset}.${provider}.reg.png`), toPng(reg.sprite.data, reg.sprite.w, reg.sprite.h));
    return { preset, provider, border, iou: reg.iou, note: attempt > 1 ? `attempt ${attempt}` : '' };
  }
  return { preset, provider, border: 0, iou: null, note: 'unreachable' };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const rows: Row[] = [];
  for (const preset of PRESETS) {
    const rb = synthesizeBlueprint(preset);
    if (!rb) { console.warn(`(skip ${preset}: no preset)`); continue; }
    const r = await composeStructure(toGeometry(rb));
    const bb = {
      x: Math.round(r.bbox.x), y: Math.round(r.bbox.y),
      w: Math.max(1, Math.round(r.bbox.w)), h: Math.max(1, Math.round(r.bbox.h)),
    };
    const mask = cropRaster({ data: r.grey, w: r.size, h: r.size }, bb);
    const initPng = toPng(compositeOverChroma(r.grey), r.size, r.size);
    const edgesPng = toPng(edgeMap(r.normal, r.grey, r.size), r.size, r.size);
    await writeFile(join(OUT, `${preset}.init.png`), initPng);
    await writeFile(join(OUT, `${preset}.edges.png`), edgesPng);
    const prompt = buildingImagePrompt(rb, 'black-forest-labs/flux-dev');
    // FLUX dims want /16; the init/control get scaled uniformly (square→square, and
    // registerAlbedo re-registers by bbox anyway, so the 477→480-style nudge is free).
    const gen = Math.ceil(r.size / 16) * 16;

    console.log(`${preset}: canvas ${r.size}px → gen ${gen}px · mask ${mask.w}×${mask.h}`);
    if (!go) { console.log(`  prompt: ${prompt}`); continue; }

    const qwenPrompt = `${prompt} Repaint surfaces only: keep the exact silhouette, roof pitch, eave lines ` +
      `and outline of the input image unchanged, and keep the background pure magenta.`;

    if (provider === 'fal') {
      rows.push(await runOne(preset, 'flux-cn', () => falRun('fal-ai/flux-general/image-to-image', {
        prompt,
        image_url: dataUri(initPng),
        strength: I2I_STRENGTH,
        image_size: { width: gen, height: gen },
        num_inference_steps: 28,
        guidance_scale: 3.5,
        sync_mode: true,
        output_format: 'png',
        enable_safety_checker: false,
        controlnet_unions: [{
          path: UNION_PATH,
          controls: [{ control_mode: 'canny', control_image_url: dataUri(edgesPng), conditioning_scale: CANNY_SCALE }],
        }],
      }), mask));

      rows.push(await runOne(preset, 'qwen-edit', () => falRun('fal-ai/qwen-image-edit-2511', {
        prompt: qwenPrompt,
        image_urls: [dataUri(initPng)],
        sync_mode: true,
        output_format: 'png',
        enable_safety_checker: false,
      }), mask));
    } else {
      // Replicate mapping. XLabs flux-dev-controlnet has ONE image slot: `control_image`
      // is both the canny source (its preprocessor extracts edges — our flat-shaded init
      // yields exactly the geometry wireframe) and, at image_to_image_strength > 0, the
      // i2i init carrying the material-colour legend.
      rows.push(await runOne(preset, 'flux-cn', () => replicateRun('xlabs-ai/flux-dev-controlnet', {
        prompt,
        control_type: 'canny',
        control_image: dataUri(initPng),
        control_strength: CANNY_SCALE,
        image_to_image_strength: 1 - I2I_STRENGTH,   // replicate: 1 = keep the init, 0 = ignore it
        steps: 28,
        guidance_scale: 3.5,
        output_format: 'png',
        output_quality: 100,
      }, { byVersion: true }), mask));

      rows.push(await runOne(preset, 'qwen-edit', () => replicateRun('qwen/qwen-image-edit-2511', {
        prompt: qwenPrompt,
        image: [dataUri(initPng)],
        aspect_ratio: 'match_input_image',
        output_format: 'png',
        disable_safety_checker: true,
      }), mask));
    }
  }

  if (!go) { console.log('\n(dry run — nothing called, nothing spent; pass --go to execute)'); return; }
  console.log(`\n=== IoU vs geometry mask (gate today: 0.70 · target: ≥0.90 · tavern v30 baseline: 0.80) ===`);
  for (const r of rows) {
    console.log(`${r.preset.padEnd(10)} ${r.provider.padEnd(13)} ring ${r.border.toFixed(2)}  IoU ${r.iou === null ? '  —  ' : r.iou.toFixed(3)}  ${r.note}`);
  }
  console.log(`\nPNGs: ${OUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
