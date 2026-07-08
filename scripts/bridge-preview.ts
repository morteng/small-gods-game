// scripts/bridge-preview.ts
// The bridge analog of building-preview.ts: compose a WHOLE bridge (deck + piers + arches +
// parapet) as ONE blueprint and render its turntable montage + lint — the building-authoring
// loop applied to spans. The live crossing pipeline spawns deck/pier/arch as SEPARATE world
// entities (assembled in world-space via liftElev / foot-sampling), so there is otherwise no
// way to *look* at a whole assembled bridge in the browserless dev loop. This is that look.
//
//   npx tsx scripts/bridge-preview.ts stone-arch --views     # → .dev-grabs/bridge-stone-arch-views.png
//   npx tsx scripts/bridge-preview.ts timber-trestle --lint
//   npx tsx scripts/bridge-preview.ts --list
//
// Deterministic, browserless, money-free grey massing — judge the massing, not the skin.
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { type Blueprint } from '../src/blueprint/types';
import { resolveBlueprint } from '../src/blueprint/resolve';
import { renderBlueprintMontage } from '../src/assetgen/blueprint-montage';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { composeStructure } from '../src/assetgen/compose';
import { lintBlueprint, summarizeLint } from '../src/blueprint/lint';
import { ensureBuildingTypesRegistered } from '../src/blueprint/register-buildings';
// The bridge geometry is GAME CODE (studio + synthesizeBlueprint('bridge-*') share it) — this dev
// script is a thin consumer of that one source of truth, plus a couple of local diagnostics recipes.
import { BRIDGE_RECIPES, bridgeBlueprint as buildBridgeBlueprint, type BridgeRecipe } from '../src/blueprint/presets/bridges';
// Reuse the ONE TTI call path (no duplicate OpenRouter client) — see scripts/tti-probe.ts.
import { apiKey, generateTti, TTI_MODEL, REF } from './tti-probe';

const OUT = '.dev-grabs';

// The three shippable bridges live in game code (presets/bridges); the diagnostics-only recipes
// (a lone arch, to eyeball whether the void reads as an open portal) stay here in the dev script.
const DIAG_RECIPES: Record<string, BridgeRecipe> = {
  // Diagnostics: a lone arch (no deck) to see whether the void reads as an open portal.
  'arch-only': {
    desc: 'DIAG: a single arch ring, no deck — is the void open?',
    walls: 'stone',
    build: () => ({
      arch1: { type: 'arch_span', at: { x: 0.5, y: 1 }, size: { w: 5, h: 1 }, params: { spanM: 10, riseM: 3, thicknessM: 1.5, dir: 'ew', style: 'round' } },
    }),
  },
  // Diagnostics: same arch spanning the OTHER axis (opening faces ±x instead of ±y).
  'arch-ns': {
    desc: 'DIAG: a lone arch spanning ns (opening faces ±x)',
    walls: 'stone',
    build: () => ({
      arch1: { type: 'arch_span', at: { x: 1, y: 0.5 }, size: { w: 1, h: 5 }, params: { spanM: 10, riseM: 3, thicknessM: 1.5, dir: 'ns', style: 'round' } },
    }),
  },
};
const RECIPES: Record<string, BridgeRecipe> = { ...BRIDGE_RECIPES, ...DIAG_RECIPES };

function bridgeBlueprint(recipe: BridgeRecipe): Blueprint {
  return buildBridgeBlueprint(recipe);
}

function toPngWH(buf: Uint8ClampedArray, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

/** A pure TEXT-TO-IMAGE prompt for a bridge: our geometry-true subject in the target pixel-art
 *  style, NO reference/repaint/chroma clauses (the img2img scaffolding). Mirrors tti-probe's
 *  ttiPrompt() so both families read the same way. */
function bridgeTtiPrompt(recipe: BridgeRecipe): string {
  const subject = recipe.ttiSubject ?? recipe.desc;
  return [
    `A crisp 2D isometric pixel-art game sprite (2:1 perspective) of a ${subject}.`,
    `Even ambient lighting, plain background, no ground shadow.`,
    `The bridge alone — no people, no animals, no carts.`,
  ].join(' ');
}

/** Compose ONE grey iso massing view of the bridge (matches the building library's
 *  ours-massing.png format — a single square compose, not the 4-yaw montage). */
async function bridgeMassing(recipe: BridgeRecipe): Promise<{ grey: Uint8ClampedArray; size: number }> {
  const rb = resolveBlueprint([bridgeBlueprint(recipe)], 1);
  const r = await composeStructure(toGeometry(rb));
  return { grey: r.grey, size: r.size };
}

/** The TTI reference-probe for bridges — the bridge analog of `tti-probe.ts <preset>`. Writes
 *  reference-library/tti/bridge-<name>/ {prompt.txt, ours-massing.png[, model-tti.png]}. `--go`
 *  SPENDS MONEY (~$0.01/img). */
async function ttiProbe(name: string, recipe: BridgeRecipe, go: boolean): Promise<void> {
  const slug = `bridge-${name}`;
  const dir = join(REF, slug);
  mkdirSync(dir, { recursive: true });
  const prompt = bridgeTtiPrompt(recipe);
  console.log(`\n=== ${slug} — TTI prompt (${prompt.length} chars) ===\n${prompt}\n`);
  writeFileSync(join(dir, 'prompt.txt'), `model: ${TTI_MODEL}\n\n${prompt}\n`);

  const { grey, size } = await bridgeMassing(recipe);
  writeFileSync(join(dir, 'ours-massing.png'), toPngWH(grey, size, size));
  console.log(`  our massing → ${join(dir, 'ours-massing.png')} (${size}px)`);

  if (!go) { console.log('  (print-only; pass --go to generate — SPENDS ~$0.01)'); return; }
  const key = apiKey();
  if (!key) { console.error('  OPENROUTER_API_KEY not set — cannot generate'); return; }
  try {
    const { buf, cost } = await generateTti(key, prompt, TTI_MODEL);
    writeFileSync(join(dir, 'model-tti.png'), buf);
    appendFileSync(join(REF, 'manifest.tsv'), `${slug}\t${TTI_MODEL}\t${cost.toFixed(4)}\n`);
    console.log(`  TTI result → ${join(dir, 'model-tti.png')}  (cost $${cost.toFixed(4)})`);
  } catch (err) {
    console.error(`  TTI failed: ${(err as Error).message}`);
  }
}

async function main() {
  ensureBuildingTypesRegistered();
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    for (const [k, r] of Object.entries(RECIPES)) console.log(`${k.padEnd(16)} ${r.desc}`);
    return;
  }
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const names = argv.filter((a) => !a.startsWith('--'));
  if (!names.length) { console.error('usage: bridge-preview.ts <recipe…> [--views|--lint|--tti [--go]]  (see --list)'); process.exit(1); }
  // --tti = the reference-library probe (pure text→image vs our massing). --go SPENDS MONEY.
  const wantTti = flags.has('--tti');
  const go = flags.has('--go');
  const wantViews = !wantTti && (flags.has('--views') || !flags.has('--lint'));
  const wantLint = !wantTti && (flags.has('--lint') || !flags.has('--views'));

  mkdirSync(OUT, { recursive: true });
  for (const name of names) {
    const recipe = RECIPES[name];
    if (!recipe) { console.error(`unknown recipe: ${name} (try --list)`); continue; }
    if (wantTti) { await ttiProbe(name, recipe, go); continue; }
    const rb = resolveBlueprint([bridgeBlueprint(recipe)], 1);
    if (wantLint) {
      const lints = lintBlueprint(rb);
      console.log(`bridge-${name} lint: ${summarizeLint(lints)}`);
      for (const l of lints) console.log(`    [${l.severity === 'error' ? 'ERR ' : l.severity}] ${l.code}: ${l.message}`);
    }
    if (wantViews) {
      const m = await renderBlueprintMontage(rb);
      const file = join(OUT, `bridge-${name}-views.png`);
      writeFileSync(file, toPngWH(m.rgba, m.width, m.height));
      console.log(`bridge-${name} montage → .dev-grabs/bridge-${name}-views.png (${m.width}×${m.height}, ${m.yaws.length} yaws)`);
      for (const e of m.legend) console.log(`    ${e.mark} = ${e.id} (${e.type})`);
    }
  }
}

main();
