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
import { BLUEPRINT_VERSION, type Blueprint } from '../src/blueprint/types';
import { resolveBlueprint } from '../src/blueprint/resolve';
import { renderBlueprintMontage } from '../src/assetgen/blueprint-montage';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { composeStructure } from '../src/assetgen/compose';
import { lintBlueprint, summarizeLint } from '../src/blueprint/lint';
import { ensureBuildingTypesRegistered } from '../src/blueprint/register-buildings';
import { METRES_PER_TILE } from '../src/render/scale-contract';
// Reuse the ONE TTI call path (no duplicate OpenRouter client) — see scripts/tti-probe.ts.
import { apiKey, generateTti, TTI_MODEL, REF } from './tti-probe';

const OUT = '.dev-grabs';
const M = METRES_PER_TILE; // 2 m per tile

type Part = NonNullable<Blueprint['parts']>[string];

/** A bridge recipe: a name → a whole-bridge blueprint. Coordinates are in tiles inside the
 *  footprint; the long (span) axis is +x (ew, yaw 0). Deck centres itself in its box; a pier's
 *  `at` is its foot corner (center = at + 0.5); an arch's `at` is its springing origin (springs
 *  +x for span, depth +y for thickness). */
interface BridgeRecipe {
  desc: string;
  walls: string;
  /** Geometry-true subject clause for the TTI probe — mirrors what `build()` actually assembles
   *  (arch count, hump, parapet, piers, material). Absent ⇒ falls back to `desc`. */
  ttiSubject?: string;
  build(): Record<string, Part>;
}

/** Masonry ring-depth above the intrados crown, in metres (arch.ts default 0.35 cube = 0.7 m).
 *  The arch's spandrel is solid to `riseM + ARCH_RING_M`, so a deck sat at that height rides the
 *  crown with no gap. */
const ARCH_RING_M = 0.7;

/** Assemble a straight ew filled-spandrel arch bridge as ONE object: N abutting arch bays form
 *  a solid spandrel wall punched with openings, and a parapeted, optionally hump-backed deck
 *  RIDES ON the arch crowns (baseZM = crown height) instead of plugging them. spanTiles = clear
 *  length; bays = arch count. The masonry between adjacent openings is the pier — no separate
 *  pier parts (they'd be buried in the spandrel). */
function archBridge(opts: {
  spanTiles: number; roadTiles: number; bays: number; riseM: number;
  style: 'round' | 'segmental' | 'pointed'; parapet: boolean; camberM: number;
}): Record<string, Part> {
  const { spanTiles, roadTiles, bays, riseM, style, parapet, camberM } = opts;
  const bay = spanTiles / bays;
  const y0 = 1;                       // deck/arch band starts 1 tile in (montage breathing room)
  const deckBaseZM = riseM + ARCH_RING_M;   // deck underside sits on the arch crown
  const parts: Record<string, Part> = {
    deck: {
      type: 'deck', at: { x: 0.5, y: y0 }, size: { w: spanTiles, h: roadTiles },
      params: { lengthM: spanTiles * M, widthM: roadTiles * M, thicknessM: 0.6, dir: 'ew',
        parapet: parapet ? 'both' : 'none', baseZM: deckBaseZM, camberM },
    },
  };
  for (let i = 0; i < bays; i++) {    // arches abut edge-to-edge → continuous spandrel wall
    parts[`arch${i + 1}`] = {
      type: 'arch_span', at: { x: 0.5 + i * bay, y: y0 }, size: { w: Math.ceil(bay), h: roadTiles },
      params: { spanM: bay * M, riseM, thicknessM: roadTiles * M, dir: 'ew', style },
    };
  }
  return parts;
}

const RECIPES: Record<string, BridgeRecipe> = {
  // Iconic medieval stone bridge: hump-backed, three segmental arches, cutwater piers, parapets.
  'stone-arch': {
    desc: 'dressed-stone 3-arch road bridge (filled spandrel, hump-backed, parapets)',
    walls: 'stone',
    ttiSubject: 'medieval dressed-stone road bridge with THREE segmental arches spanning a river, ' +
      'a gently hump-backed deck carried on a solid filled-spandrel wall, low stone parapets along ' +
      'both edges, and pointed cutwater piers between the arches; grey ashlar masonry',
    build: () => archBridge({ spanTiles: 12, roadTiles: 2, bays: 3, riseM: 3, style: 'segmental', parapet: true, camberM: 0.8 }),
  },
  // Timber trestle: a plank deck on driven piles, near-vertical, no masonry arch.
  'timber-trestle': {
    desc: 'timber trestle footbridge (driven piles, plank deck)',
    walls: 'timber',
    ttiSubject: 'medieval timber trestle footbridge, a flat plank deck carried on three bents of ' +
      'driven vertical timber piles, no masonry and no arches, sitting low over the water; ' +
      'weathered brown wood',
    build: () => {
      const spanTiles = 8, roadTiles = 1, y0 = 1, pierH = 3;
      const parts: Record<string, Part> = {
        // The plank deck RIDES ON the pile tops (baseZM = pier height), so the piles hang below
        // it like a real trestle rather than sticking up through it.
        deck: { type: 'deck', at: { x: 0.5, y: y0 }, size: { w: spanTiles, h: roadTiles }, params: { lengthM: spanTiles * M, widthM: roadTiles * M, thicknessM: 0.4, dir: 'ew', parapet: 'none', baseZM: pierH } },
      };
      for (let i = 1; i <= 3; i++) parts[`pier${i}`] = { type: 'pier', at: { x: i * 2 - 0.5, y: y0 }, size: { w: 1, h: 1 }, params: { heightM: pierH, widthM: 0.6, batter: 0.05 } };
      return parts;
    },
  },
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
  // Single-arch stone packhorse bridge over a brook — one span, no interior piers.
  'packhorse': {
    desc: 'single-arch stone packhorse bridge (no interior piers)',
    walls: 'stone',
    ttiSubject: 'narrow single-arch stone packhorse bridge over a brook, one round arch, a steep ' +
      'strongly hump-backed cobbled deck only a single file wide, low stone parapets, ' +
      'no interior piers; grey fieldstone',
    build: () => archBridge({ spanTiles: 5, roadTiles: 1, bays: 1, riseM: 2.5, style: 'round', parapet: true, camberM: 1.0 }),
  },
};

function bridgeBlueprint(recipe: BridgeRecipe): Blueprint {
  const parts = recipe.build();
  let maxX = 0, maxY = 0;
  for (const p of Object.values(parts)) {
    const at = p.at ?? { x: 0, y: 0 };
    maxX = Math.max(maxX, at.x + (p.size?.w ?? 1));
    maxY = Math.max(maxY, at.y + (p.size?.h ?? 1));
  }
  return {
    version: BLUEPRINT_VERSION, class: 'prop', preset: 'bridge', category: 'infrastructure',
    footprint: { w: Math.ceil(maxX) + 1, h: Math.ceil(maxY) + 1 },
    materials: { walls: recipe.walls, roof: recipe.walls, ground: 'dirt' },
    parts,
  };
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
