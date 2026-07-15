/**
 * Terrain img2img — round-trip a LIVE terrain grab through an OpenRouter image
 * model (default Nano Banana Pro / Gemini 3 Pro Image) to (a) get a lush "what it
 * COULD look like" target for 1:1 comparison and (b) harvest ground textures for
 * the terrain shader's material atlas.
 *
 * Reuses the shipped img2img seam (`generateBuildingImageAuto`) — no bespoke HTTP,
 * no browser CORS. The input is a PNG grabbed from the running game via
 * `__debug.grabFile(name)` (writes to `.dev-grabs/`), so the whole loop is:
 *   in-game genome render → grabFile → this script → compare/harvest.
 *
 *   # DRY RUN (no spend) — prints the request it WOULD send:
 *   node --env-file=.env --import tsx scripts/terrain-img2img.ts \
 *     --in .dev-grabs/grass-native-1to1.png --out .dev-grabs/grass-target.png \
 *     --prompt-file scripts/prompts/grass-target.txt
 *
 *   # SPEND (append --go) — user-triggered ONLY (never autonomous per project rule):
 *   … --go
 *
 * Models: google/gemini-3-pro-image (Nano Banana Pro, ~$0.13/2K · ~$0.24/4K),
 *         google/gemini-3.1-flash-image (Nano Banana 2, ~$0.06/2K).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateBuildingImageAuto } from '@/llm/building-image';
import { generateTti } from './tti-generate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name: string, def = ''): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const inFile = flag('in', '.dev-grabs/grass-native-1to1.png');
const outFile = flag('out', '.dev-grabs/terrain-img2img.png');
const model = flag('model', 'google/gemini-3-pro-image');
const promptFile = flag('prompt-file');
const go = argv.includes('--go');

const DEFAULT_PROMPT =
  'Redraw this top-down isometric game terrain as a lush, high-fidelity 2K pixel-art scene. ' +
  'Keep the exact same camera angle, layout, hills, dirt paths and tree positions. Improve the ' +
  'GROUND: rich layered meadow grass with subtle blade detail and clover, natural green-to-olive ' +
  'color variation, soft ambient occlusion in the hollows, gently sun-warmed ridge highlights. ' +
  'Remove any artificial yellow streaks and pinkish washed-out patches. Cohesive naturalistic ' +
  'palette, crisp pixel-art shading, no text, no UI.';

const tti = argv.includes('--tti'); // pure text-to-image: NO init image (generate a texture from scratch)

async function main(): Promise<void> {
  const prompt = promptFile ? (await readFile(join(ROOT, promptFile), 'utf8')).trim() : DEFAULT_PROMPT;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) { console.error('OPENROUTER_API_KEY not set (use --env-file=.env).'); process.exit(1); }

  // TTI mode: generate a fresh texture with no init image — used to synthesize the grass
  // TEXTURE BASIS the terrain shader samples, uncontaminated by our own render.
  if (tti) {
    console.log(`[tti]   out  = ${outFile}`);
    console.log(`[tti]   model= ${model}`);
    console.log(`[tti]   prompt:\n  ${prompt.replace(/\n/g, '\n  ')}`);
    if (!go) { console.log('\nDRY RUN — no spend. Append --go to send (est ~$0.13 @2K for Nano Banana Pro).'); return; }
    console.log('\n[tti] sending…');
    const { buf, cost } = await generateTti(apiKey, prompt, model);
    await writeFile(join(ROOT, outFile), buf);
    console.log(`[tti] wrote ${outFile} (${(buf.length / 1024).toFixed(0)} KB) · cost $${cost.toFixed(4)}`);
    return;
  }

  const buf = await readFile(join(ROOT, inFile));
  const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
  console.log(`[img2img] in   = ${inFile} (${(buf.length / 1024).toFixed(0)} KB)`);
  console.log(`[img2img] out  = ${outFile}`);
  console.log(`[img2img] model= ${model}`);
  console.log(`[img2img] prompt:\n  ${prompt.replace(/\n/g, '\n  ')}`);

  if (!go) {
    console.log('\nDRY RUN — no spend. Append --go to send (est ~$0.13 @2K, ~$0.24 @4K for Nano Banana Pro).');
    return;
  }

  console.log('\n[img2img] sending…');
  const res = await generateBuildingImageAuto({ openrouter: { apiKey } }, { initImageDataUri: dataUri, prompt, model });
  const outBuf = Buffer.from(await res.blob.arrayBuffer());
  await writeFile(join(ROOT, outFile), outBuf);
  console.log(`[img2img] wrote ${outFile} (${(outBuf.length / 1024).toFixed(0)} KB) · cost $${res.costUsd.toFixed(4)}`);
}

void main();
