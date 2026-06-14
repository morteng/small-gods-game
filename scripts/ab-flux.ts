/**
 * Scratch A/B: generate a couple of buildings with a CHEAPER image model and run
 * the SAME quality gates the runtime pipeline uses (magenta chroma-key → border-
 * keyed fraction → silhouette IoU vs the geometry mask). Objective pass/fail, plus
 * the keyed sprite saved to .tmp/ab/ for an eyeball. Does NOT touch the library.
 *
 *   OPENROUTER_API_KEY=… npx tsx scripts/ab-flux.ts [model] [preset…]
 *
 * Defaults: model = black-forest-labs/flux.2-klein-4b, presets = cottage tavern.
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
import {
  type Raster, cropRaster, borderKeyedFraction, registerAlbedo, quantizePalette,
} from '../src/render/sprite-postprocess';
import { MIN_BORDER_KEYED, MIN_SILHOUETTE_IOU, QUANT_COLORS } from '../src/render/generated-building-art-source';
import { generateBuildingImage, BuildingImageError } from '../src/llm/openrouter-image-client';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.tmp/ab');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set. Aborting.'); process.exit(1); }

const args = process.argv.slice(2);
const model = args.find(a => a.includes('/')) ?? 'black-forest-labs/flux.2-klein-4b';
const presets = args.filter(a => !a.includes('/'));
const wanted = presets.length ? presets : ['cottage', 'tavern'];

function toPng(buf: Uint8ClampedArray, w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}
function fromPng(buf: Buffer): Raster {
  const png = PNG.sync.read(buf);
  return { data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength), w: png.width, h: png.height };
}

async function one(preset: string): Promise<number> {
  const rb = synthesizeBlueprint(preset);
  if (!rb) { console.warn(`(skip ${preset}: no preset)`); return 0; }
  const r = await composeStructure(toGeometry(rb));
  const bb = {
    x: Math.round(r.bbox.x), y: Math.round(r.bbox.y),
    w: Math.max(1, Math.round(r.bbox.w)), h: Math.max(1, Math.round(r.bbox.h)),
  };
  const full = (buf: Uint8ClampedArray): Raster => ({ data: buf, w: r.size, h: r.size });
  const mask = cropRaster(full(r.grey), bb);
  const initDataUri = `data:image/png;base64,${toPng(compositeOverChroma(r.grey), r.size, r.size).toString('base64')}`;
  const prompt = buildingImagePrompt(rb, model);

  console.log(`\n── ${preset} (${model}) ─ mask ${mask.w}×${mask.h}`);
  let res;
  try {
    // modalities auto-selected per model by the client (FLUX → ['image']).
    res = await generateBuildingImage({ apiKey: apiKey! }, { initImageDataUri: initDataUri, prompt, model });
  } catch (err) {
    if (err instanceof BuildingImageError) {
      console.error(`  ⛔ ${err.kind}: ${err.hint} → ${err.helpUrl}\n     ${err.message}`);
      if (err.fatal) throw err;
    } else console.error(`  error: ${(err as Error).message}`);
    return 0;
  }

  const cost = res.costUsd;
  const raw = fromPng(Buffer.from(await res.blob.arrayBuffer()));
  // Save the RAW model output (pre-key) so we can see what it actually drew.
  await writeFile(join(OUT, `${preset}.raw.png`), toPng(raw.data, raw.w, raw.h));
  chromaKeyMagenta(raw.data);
  const border = borderKeyedFraction(raw);
  const reg = registerAlbedo(raw, mask);
  const iou = reg ? reg.iou : 0;
  const borderOk = border >= MIN_BORDER_KEYED;
  const iouOk = iou >= MIN_SILHOUETTE_IOU;
  const pass = borderOk && iouOk && !!reg;
  if (reg) {
    const sprite = quantizePalette(reg.sprite, QUANT_COLORS);
    await writeFile(join(OUT, `${preset}.keyed.png`), toPng(sprite.data, sprite.w, sprite.h));
  }
  console.log(`  cost   $${cost.toFixed(4)}`);
  console.log(`  border ${border.toFixed(2)}  (gate ≥${MIN_BORDER_KEYED})  ${borderOk ? '✓' : '✗'}`);
  console.log(`  IoU    ${iou.toFixed(2)}  (gate ≥${MIN_SILHOUETTE_IOU})  ${iouOk ? '✓' : '✗'}`);
  console.log(`  → ${pass ? 'PASS' : 'FAIL'}   raw: .tmp/ab/${preset}.raw.png  keyed: .tmp/ab/${preset}.keyed.png`);
  return cost;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let total = 0;
  for (const p of wanted) {
    try { total += await one(p); }
    catch (err) {
      if (err instanceof BuildingImageError && err.fatal) {
        console.error(`\nAborted — fatal: ${err.hint} → ${err.helpUrl}`);
        break;
      }
      throw err;
    }
  }
  console.log(`\nTotal spent: $${total.toFixed(4)} on ${wanted.length} building(s) with ${model}.`);
}
main().catch(err => { console.error(err); process.exit(1); });
