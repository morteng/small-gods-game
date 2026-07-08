// scripts/tti-probe.ts — DIAGNOSTIC (not the shipped pipeline).
// Feed our geometry-true building description to a pure TEXT-TO-IMAGE model (NO init
// massing image) and save what the model imagines into a persistent REFERENCE LIBRARY
// next to our own 3D massing render — so we can compare "what our words describe" vs
// "what our geometry builds" and learn where the model adds architecture we don't model
// (or reads our description differently than we intend).
//
//   npx tsx scripts/tti-probe.ts tavern            # PRINT the TTI prompt only (free)
//   OPENROUTER_API_KEY=… npx tsx scripts/tti-probe.ts tavern --go   # generate (spends ~$0.01/img)
//
// Uses the SAME image model as the img2img pipeline (BUILDING_IMAGE_MODEL). The TTI prompt
// = our subject + geometry-true description (reused from building-image-prompt.ts) MINUS the
// img2img scaffolding (no "repaint the attached reference", no colour-legend, no magenta bg).
// Output lands in reference-library/tti/<preset>/ with the prompt saved beside each image.
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { synthesizeBlueprint } from '../src/blueprint/presets/index';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { composeStructure } from '../src/assetgen/compose';
// The generalized TTI reference prompt is game code (shared with the studio regen) — see
// building-image-prompt.ts. This CLI is now a thin caller of it.
import { ttiReferencePrompt as ttiPrompt } from '../src/assetgen/building-image-prompt';
// The TTI call path + key + paths live in tti-generate.ts (light, no blueprint deps) so the
// dev-server reflib plugin can share them; re-export for back-compat (bridge-preview imports these).
import { REF, TTI_MODEL, apiKey, generateTti } from './tti-generate';
export { REF, TTI_MODEL, apiKey, generateTti };

function toPng(buf: Uint8ClampedArray, size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

async function main() {
  const argv = process.argv.slice(2);
  const go = argv.includes('--go');
  // --prompt="…" overrides the auto-derived prompt (a hand-authored TARGET reference);
  // --name=slug names the output folder for a custom prompt. Otherwise the preset drives both.
  const override = argv.find(a => a.startsWith('--prompt='))?.slice('--prompt='.length);
  const nameArg = argv.find(a => a.startsWith('--name='))?.slice('--name='.length);
  const presets = argv.filter(a => !a.startsWith('--'));
  if (!presets.length) { console.error('usage: tti-probe.ts <preset…> [--go] [--prompt="…" --name=slug]'); process.exit(1); }

  for (const preset of presets) {
    const rb = synthesizeBlueprint(preset, [], 1);
    if (!rb) { console.error(`unknown preset: ${preset}`); continue; }
    const dir = join(REF, nameArg ?? preset);
    mkdirSync(dir, { recursive: true });
    const prompt = override ?? ttiPrompt(rb);
    console.log(`\n=== ${preset} — TTI prompt (${prompt.length} chars) ===\n${prompt}\n`);
    writeFileSync(join(dir, 'prompt.txt'), `model: ${TTI_MODEL}\n\n${prompt}\n`);

    // Our massing render, for side-by-side comparison in the library.
    const r = await composeStructure(toGeometry(rb));
    writeFileSync(join(dir, 'ours-massing.png'), toPng(r.grey, r.size));
    console.log(`  our massing → ${join(dir, 'ours-massing.png')} (${r.size}px)`);

    if (!go) { console.log('  (print-only; pass --go to generate)'); continue; }
    const key = apiKey();
    if (!key) { console.error('  OPENROUTER_API_KEY not set — cannot generate'); continue; }
    try {
      const { buf, cost } = await generateTti(key, prompt, TTI_MODEL);
      writeFileSync(join(dir, 'model-tti.png'), buf);
      appendFileSync(join(REF, 'manifest.tsv'), `${preset}\t${TTI_MODEL}\t${cost.toFixed(4)}\n`);
      console.log(`  TTI result → ${join(dir, 'model-tti.png')}  (cost $${cost.toFixed(4)})`);
    } catch (err) {
      console.error(`  TTI failed: ${(err as Error).message}`);
    }
  }
}

// Only run the CLI when executed directly — bridge-preview.ts imports generateTti/apiKey.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
