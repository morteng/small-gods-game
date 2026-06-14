/**
 * Mirror the curated flora fact-DB (src/flora/flora-facts-data.ts — the canonical,
 * type-checked source) to the vendored artifact public/asset-library/flora-facts.json,
 * so external tooling and the in-game agent/Fate layer can read species facts +
 * their DERIVED generation params without importing TS. The TS module stays the
 * truth; this script just emits the JSON view (each entry annotated with the
 * recipe/height/trunkR or rock sizeM/jitter that deriveGenParams produces).
 *
 *   npx tsx scripts/seed-flora-facts.ts            # write the JSON
 *   npx tsx scripts/seed-flora-facts.ts --plan     # dry-run: print the table, no write
 *
 * Author-time research used the Wikipedia MCP (search → extract_key_facts) to pull
 * keyFacts + ranges; the prose→numbers normalization is baked into the TS data.
 * Runtime lazy-fill (flora-registry FloraFactProvider) appends misses on top of
 * this core — a later slice wires the live Wikipedia-backed provider.
 */
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { FLORA_FACTS } from '../src/flora/flora-facts-data';
import { deriveGenParams } from '../src/flora/flora-species';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/asset-library');
const OUT = join(OUT_DIR, 'flora-facts.json');

const plan = process.argv.includes('--plan');

const entries = FLORA_FACTS.map(s => ({ ...s, _derived: deriveGenParams(s) }));

if (plan) {
  console.log(`flora-facts: ${FLORA_FACTS.length} curated species\n`);
  for (const e of entries) {
    const g = e._derived;
    const params = g.kind === 'rock'
      ? `rock  size=${g.sizeM}m jitter=${g.jitter}`
      : `${g.recipe!.padEnd(7)} h=${g.heightM}m r=${g.trunkR}m`;
    console.log(`  ${e.id.padEnd(20)} ${e.botanical.habit.padEnd(6)} → ${params}`);
  }
  console.log('\n(--plan: no file written)');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
const json = JSON.stringify({ version: 1, count: entries.length, species: entries }, null, 2);
await writeFile(OUT, json);
console.log(`Wrote ${entries.length} species → ${OUT}`);
