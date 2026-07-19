// scripts/prop-tti-probe.ts — DIAGNOSTIC (not the shipped pipeline).
// The prop/rock/flora analog of tti-probe.ts: pure text-to-image reference grabs for subjects
// that have NO building blueprint (so no auto-derived prompt and no massing render). Subjects
// live in a small table here; --prompt= overrides for a one-off take.
//
//   npx tsx scripts/prop-tti-probe.ts rock-boulder-granite            # print prompt (free)
//   npx tsx scripts/prop-tti-probe.ts rock-boulder-granite --go       # generate (~$0.01/img)
//   npx tsx scripts/prop-tti-probe.ts --name=slug --prompt="…" --go   # hand-authored subject
//
// Output → reference-library/tti/<slug>/ (gitignored) + a cost row in manifest.tsv, same
// layout as the building probe so the studio Reference tab picks the grabs up unchanged.
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REF, TTI_MODEL, apiKey, generateTti } from './tti-generate';

const STYLE_HEAD = 'A crisp 2D isometric pixel-art game sprite (2:1 perspective) of';
const STYLE_TAIL = 'Even ambient lighting, plain background, no ground shadow. No plants, no people, no animals.';

/** Hand-authored subjects (the building probe derives these from blueprints instead). */
export const PROP_SUBJECTS: Record<string, string> = {
  'rock-boulder-granite':
    `${STYLE_HEAD} a cluster of weathered grey granite boulders on bare ground — one large ` +
    `rounded boulder about 2 metres tall with two smaller companions nested against its base. ` +
    `Faceted, softly rounded forms with pale lichen patches and a few hairline cracks; muted ` +
    `grey stone with subtle warm-cool variation. ${STYLE_TAIL}`,
  'rock-outcrop-strata':
    `${STYLE_HEAD} a rugged bedrock outcrop about 3 metres tall — angular fractured stone with ` +
    `visible near-horizontal sedimentary strata and blocky jointed faces, a small spill of ` +
    `broken scree at its foot. Weathered grey-brown rock, muted palette. ${STYLE_TAIL}`,
  'rock-scatter-field':
    `${STYLE_HEAD} three separate small field stones, each under half a metre, spaced apart on ` +
    `bare ground — rounded weathered grey rocks, partly sunken as if long settled into the soil. ` +
    `${STYLE_TAIL}`,
};

async function main() {
  const argv = process.argv.slice(2);
  const go = argv.includes('--go');
  const override = argv.find(a => a.startsWith('--prompt='))?.slice('--prompt='.length);
  const nameArg = argv.find(a => a.startsWith('--name='))?.slice('--name='.length);
  const subjects = argv.filter(a => !a.startsWith('--'));
  if (!subjects.length && !(override && nameArg)) {
    console.error(`usage: prop-tti-probe.ts <subject…> [--go]  |  --name=slug --prompt="…" [--go]`);
    console.error(`subjects: ${Object.keys(PROP_SUBJECTS).join(', ')}`);
    process.exit(1);
  }
  const jobs: [string, string][] = subjects.length
    ? subjects.map(s => {
        const p = override ?? PROP_SUBJECTS[s];
        if (!p) { console.error(`unknown subject: ${s}`); process.exit(1); }
        return [nameArg ?? s, p] as [string, string];
      })
    : [[nameArg!, override!]];

  for (const [slug, prompt] of jobs) {
    const dir = join(REF, slug);
    mkdirSync(dir, { recursive: true });
    console.log(`\n=== ${slug} — TTI prompt (${prompt.length} chars) ===\n${prompt}\n`);
    writeFileSync(join(dir, 'prompt.txt'), `model: ${TTI_MODEL}\n\n${prompt}\n`);
    if (!go) { console.log('  (print-only; pass --go to generate)'); continue; }
    const key = apiKey();
    if (!key) { console.error('  OPENROUTER_API_KEY not set — cannot generate'); continue; }
    try {
      const { buf, cost } = await generateTti(key, prompt, TTI_MODEL);
      writeFileSync(join(dir, 'model-tti.png'), buf);
      appendFileSync(join(REF, 'manifest.tsv'), `${slug}\t${TTI_MODEL}\t${cost.toFixed(4)}\n`);
      console.log(`  TTI result → ${join(dir, 'model-tti.png')}  (cost $${cost.toFixed(4)})`);
    } catch (err) {
      console.error(`  TTI failed: ${(err as Error).message}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
