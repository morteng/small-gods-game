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
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { synthesizeBlueprint } from '../src/blueprint/presets/index';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { composeStructure } from '../src/assetgen/compose';
import { geometryDescription } from '../src/assetgen/building-image-prompt';
import { descriptorPhrase } from '../src/blueprint/descriptors';
import { defaultModalitiesFor, BUILDING_IMAGE_MODEL } from '../src/llm/openrouter-image-client';
import type { Part } from '../src/assetgen/compose';
import type { ResolvedBlueprint } from '../src/blueprint/types';
import type { Mat } from '../src/assetgen/types';

export const REF = 'reference-library/tti';
// Same model as the img2img pipeline by default (cheap klein). A pricier model
// (google/gemini-2.5-flash-image) was ~marginal for our purpose, so override only when
// wanted: TTI_MODEL=google/gemini-2.5-flash-image npx tsx scripts/tti-probe.ts …
export const TTI_MODEL = process.env.TTI_MODEL ?? BUILDING_IMAGE_MODEL;

/** OPENROUTER_API_KEY from the env, else parsed out of a gitignored .env (never logged). */
export function apiKey(): string | undefined {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  if (existsSync('.env')) {
    const m = /^OPENROUTER_API_KEY=(.+)$/m.exec(readFileSync('.env', 'utf8'));
    if (m) return m[1].trim();
  }
  return undefined;
}

function toPng(buf: Uint8ClampedArray, size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

/** Wall/roof materials straight off the compiled building prim (for the subject clause). */
function walledMaterials(rb: ResolvedBlueprint): { wall?: Mat; roof?: Mat } {
  const b = toGeometry(rb).parts.find((p: Part) => p.prim === 'building');
  return b && b.prim === 'building' ? { wall: b.wallMat, roof: b.roofMat } : {};
}

/** A pure TEXT-TO-IMAGE prompt: our real subject + geometry description, in the target
 *  pixel-art style, with NO reference/repaint/chroma clauses. */
function ttiPrompt(rb: ResolvedBlueprint): string {
  const desc = descriptorPhrase(rb.descriptors);
  const era = rb.era ?? 'medieval';
  const noun = (rb.preset ?? rb.category ?? 'building').replace(/_(small|large|tiny|big)$/, '').replace(/_/g, ' ');
  const { wall, roof } = walledMaterials(rb);
  const mat = [wall ? `${wall} walls` : '', roof ? `a ${roof} roof` : ''].filter(Boolean).join(' and ');
  const subject = `${desc ? desc + ' ' : ''}${era} ${noun}${mat ? ` with ${mat}` : ''}`;
  const geom = geometryDescription(rb);
  return [
    `A crisp 2D isometric pixel-art game sprite (2:1 perspective) of a ${subject}.`,
    geom,
    `Even ambient lighting, plain background, no ground shadow.`,
  ].filter(Boolean).join(' ');
}

/** Direct text-only OpenRouter image call (no init image) — the img2img client always
 *  attaches an image part, so TTI needs its own tiny request. */
export async function generateTti(apiKey: string, prompt: string, model: string): Promise<{ buf: Buffer; cost: number }> {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Small Gods TTI Probe',
    },
    body: JSON.stringify({
      model, modalities: defaultModalitiesFor(model),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const json = await resp.json() as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    usage?: { cost?: number }; error?: { message?: string };
  };
  if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
  const uri = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!uri) throw new Error('no image in response (model returned text only)');
  const m = /^data:image\/\w+;base64,(.+)$/.exec(uri);
  if (!m) throw new Error('malformed data-URI in response');
  return { buf: Buffer.from(m[1], 'base64'), cost: json.usage?.cost ?? 0 };
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
