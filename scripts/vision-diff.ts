// scripts/vision-diff.ts — generic geometry-matching aid for ANY building preset.
//
// Sends the subject's TTI reference to a vision-capable OpenRouter chat model
// (Pro, definitive read — CACHED per reference so iterating is nearly free) and a
// fresh grey massing render of our CURRENT geometry to a cheaper one (Flash),
// then asks for a concrete, code-actionable geometry diff. Pure text output —
// no image generation, no img2img money.
//
// Run:  set -a; source .env; set +a; npx tsx scripts/vision-diff.ts <preset> [flags]
//
//   npx tsx scripts/vision-diff.ts tavern                       # ref auto-picked from reference-library/tti/
//   npx tsx scripts/vision-diff.ts tavern --ref=tavern-2        # explicit reference slug
//   npx tsx scripts/vision-diff.ts brewhouse --focus="oast kiln drum, cowl"
//   npx tsx scripts/vision-diff.ts tavern --check               # Flash read of OUR render only (no ref, no diff)
//   npx tsx scripts/vision-diff.ts tavern --reread              # force a fresh Pro read of the reference
//
// Cost: first run vs a reference ~$0.005–0.01 (Pro ref read + Flash render read +
// Flash diff); repeat runs reuse the cached ref spec (reference-library/tti/<slug>/
// ref-spec.md) and cost ~$0.003. --check is a single Flash call.
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { composeStructure } from '../src/assetgen/compose';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { synthesizeBlueprint } from '../src/blueprint/presets';
import { ensureBuildingTypesRegistered } from '../src/blueprint/register-buildings';
import { PNG } from 'pngjs';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const REF_LIB = 'reference-library/tti';
const OUT_DIR = '.dev-grabs';

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = new Map<string, string>();
let preset = '';
for (const a of args) {
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq === -1) flags.set(a.slice(2), 'true');
    else flags.set(a.slice(2, eq), a.slice(eq + 1));
  } else if (!preset) preset = a;
}
if (!preset) {
  console.error('usage: vision-diff.ts <preset> [--ref=<slug>] [--focus="feature, feature"] [--check] [--reread] [--ref-model=…] [--iter-model=…]');
  process.exit(1);
}
const REF_MODEL = flags.get('ref-model') ?? 'google/gemini-2.5-pro';
const ITER_MODEL = flags.get('iter-model') ?? 'google/gemini-2.5-flash';
const checkOnly = flags.has('check');
const reread = flags.has('reread');
const focus = flags.get('focus');
const subject = preset.replace(/[_-]/g, ' ');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }

// ── reference resolution: --ref slug, else best match under reference-library/tti ──
async function resolveRefDir(): Promise<string | null> {
  const asked = flags.get('ref');
  if (asked) {
    const dir = join(REF_LIB, asked);
    if (!existsSync(join(dir, 'model-tti.png'))) throw new Error(`--ref=${asked}: no ${dir}/model-tti.png`);
    return dir;
  }
  if (!existsSync(REF_LIB)) return null;
  const entries = await readdir(REF_LIB);
  // Candidates: exact preset name or preset-N variants; newest mtime wins
  // (variants keep prior references, so the latest grab is the intended target).
  const cands = entries.filter(e => e === preset || e.startsWith(`${preset}-`));
  let best: { dir: string; mtime: number } | null = null;
  for (const c of cands) {
    const png = join(REF_LIB, c, 'model-tti.png');
    if (!existsSync(png)) continue;
    const s = await stat(png);
    if (!best || s.mtimeMs > best.mtime) best = { dir: join(REF_LIB, c), mtime: s.mtimeMs };
  }
  return best?.dir ?? null;
}

// ── OpenRouter vision chat (text out only — never set modalities: that opts into image gen) ──
type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
async function chat(model: string, parts: Part[]) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://localhost',
      'X-Title': 'small-gods-vision-diff',
    },
    // max_tokens bounds the spend AND the affordability check — without it OpenRouter
    // budgets for the model's 65k max and 402s on a nearly-spent key.
    body: JSON.stringify({ model, messages: [{ role: 'user', content: parts }], max_tokens: 2000 }),
  });
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const json = await res.json() as any;
  const text = json.choices?.[0]?.message?.content ?? '';
  return { text: typeof text === 'string' ? text : JSON.stringify(text), cost: json.usage?.cost as number | null };
}

function toPng(buf: Uint8ClampedArray, size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}
const dataUri = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`;

// ── prompts: one numbered structure for both reads so the diff aligns section-by-section ──
const focusSection = focus
  ? `4. DISTINCTIVE FEATURES — pay EXACT attention to: ${focus}. For each: shape, which face/gable it sits on, size relative to the body, silhouette (how it changes the outline).`
  : `4. DISTINCTIVE FEATURES: anything type-specific (a bulging oven, a kiln drum + cowl, a wheel, a fore-building, a stair) — shape, position, relative size, silhouette.`;

const structure = `1. FOOTPRINT: bay count / rectangular proportions (width:depth), storeys.
2. ROOF: form (gable/hip/gambrel/lean-to), pitch (shallow/medium/steep), ridge orientation vs the long axis, ridge features, dormers (count/placement).
3. WALLS: jetty/overhang, base course / plinth (height read), visible framing.
${focusSection}
5. CHIMNEY / FLUE: count, square/round, height vs ridge, position (gable end / ridge / wall).
6. DOOR: which face, position along it, porch/step.
7. WINDOWS: count per face/storey, shape, relative size.
8. SILHOUETTE PROPORTIONS: height-to-width of the whole sprite; wall height vs roof height.
9. ANOMALIES: anything else notable.`;

const REF_PROMPT = `You are a 3D-modelling analyst. This is an isometric pixel-art reference sprite of a medieval ${subject.toUpperCase()}. I am rebuilding this as low-poly 3D geometry and need a precise, code-actionable description. Describe ONLY what is visibly present, as a structured spec:
${structure}
Be terse and factual. No prose intro. Use the numbered headings.`;

const RENDER_PROMPT = `You are a 3D-modelling analyst. This is a GREY UNLIT massing render of our current 3D geometry for a medieval ${subject} (no paint/textures — pure shape). Material reads are N/A; describe SHAPE ONLY, with the same numbered structure:
${structure}
Be terse and factual. No prose intro. Numbered headings.`;

async function main() {
  ensureBuildingTypesRegistered();
  await mkdir(OUT_DIR, { recursive: true });
  const costs: Array<number | null> = [];

  // 1. Fresh grey render of CURRENT geometry.
  const rb = synthesizeBlueprint(preset as any);
  if (!rb) throw new Error(`unknown preset "${preset}" (see building-preview.ts --list)`);
  const struct = await composeStructure(toGeometry(rb));
  const greyPng = toPng(struct.grey, struct.size);
  const greyPath = join(OUT_DIR, `${preset}-grey-current.png`);
  await writeFile(greyPath, greyPng);
  console.log(`# grey render: ${greyPath} (${struct.size}px, bbox ${JSON.stringify(struct.bbox)})\n`);

  // 2. Flash reads our render.
  console.log(`# sending our render to ${ITER_MODEL} ...`);
  const ours = await chat(ITER_MODEL, [
    { type: 'text', text: RENDER_PROMPT },
    { type: 'image_url', image_url: { url: dataUri(greyPng) } },
  ]);
  costs.push(ours.cost);
  console.log('===== OUR GEOMETRY SPEC =====');
  console.log(ours.text + '\n');
  if (checkOnly) {
    console.log(`# total cost ~$${sum(costs).toFixed(4)}`);
    return;
  }

  // 3. Reference spec — cached beside the reference; Pro reads it once.
  const refDir = await resolveRefDir();
  if (!refDir) throw new Error(`no reference under ${REF_LIB}/ matches "${preset}" — grab one (tti-probe / studio Regen) or pass --ref=<slug>`);
  const specPath = join(refDir, 'ref-spec.md');
  let refText: string;
  if (!reread && existsSync(specPath)) {
    refText = await readFile(specPath, 'utf8');
    console.log(`# reference: ${refDir} (cached spec — pass --reread to re-run ${REF_MODEL})\n`);
  } else {
    console.log(`# reference: ${refDir} — sending to ${REF_MODEL} ...`);
    const refBytes = await readFile(join(refDir, 'model-tti.png'));
    const ref = await chat(REF_MODEL, [
      { type: 'text', text: REF_PROMPT },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${refBytes.toString('base64')}` } },
    ]);
    costs.push(ref.cost);
    refText = ref.text;
    await writeFile(specPath, refText);
    console.log(`# ref spec cached: ${specPath}\n`);
  }
  console.log('===== REFERENCE SPEC =====');
  console.log(refText + '\n');

  // 4. Flash produces the concrete geometry diff.
  const diff = await chat(ITER_MODEL, [{ type: 'text', text:
`You are a 3D geometry engineer. Below are two specs of the SAME intended building (a medieval ${subject}): the REFERENCE (what we want to match) and OUR GEOMETRY (what we currently build). Produce a concrete, ordered, code-actionable list of geometry changes to make OUR build match the reference better. Each item: WHAT to change, FROM current → TO target, and WHY (which reference feature it fixes). Prioritise by visual impact. Only list REAL differences. If something already matches, omit it.

IMPORTANT SCOPE: our build is GREY MASSING — a later paint pass adds ALL materials, colours, textures and small surface details (timber framing pattern, tile/thatch texture, ridge caps, lanterns, hinges, signage). List ONLY changes to 3D FORM: proportions, silhouette, part placement/size, opening positions/sizes. NEVER list material, colour, texture or painted-detail items.

REFERENCE SPEC:
${refText}

OUR GEOMETRY SPEC:
${ours.text}
` }]);
  costs.push(diff.cost);
  console.log('===== GEOMETRY DIFF =====');
  console.log(diff.text);
  console.log(`\n# total cost ~$${sum(costs).toFixed(4)}`);

  const reportPath = join(OUT_DIR, `${preset}-vision-diff.md`);
  await writeFile(reportPath, [
    `# ${preset} geometry diff — ${new Date().toISOString()}`,
    `# reference: ${refDir}  ref model: ${REF_MODEL}  iter model: ${ITER_MODEL}`,
    `# grey render: ${greyPath}`,
    '\n## REFERENCE SPEC\n', refText,
    '\n## OUR GEOMETRY SPEC\n', ours.text,
    '\n## GEOMETRY DIFF\n', diff.text,
  ].join('\n'));
  console.log(`# report written: ${reportPath}`);
}

const sum = (xs: Array<number | null>) => xs.filter((x): x is number => x != null).reduce((a, b) => a + b, 0);

main().catch(e => { console.error(e); process.exit(1); });
