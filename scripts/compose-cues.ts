/**
 * Seed the committed music-cue library through the LLM Composer (capable tier),
 * so keyless players get a genuinely COMPOSED score with no runtime LLM and no
 * paid generation at play time. Mirrors scripts/seed-building-art.ts.
 *
 *   OPENROUTER_API_KEY=… npx tsx scripts/compose-cues.ts     # compose + write base.json
 *   npx tsx scripts/compose-cues.ts --plan                   # no key: print specs, no API calls
 *
 * Writes public/asset-library/cues/base.json = { version, model, cues }. Output
 * is validated (cue-schema) before write; the runtime loader re-validates and
 * merges OVER the hand-authored TS base set (same id → generated cue wins).
 *
 * FREEZE-SAFE: with no key, or with --plan, it makes ZERO API calls. The reseed
 * freeze ("don't spend money yet") only blocks running this; committed cues play
 * for free forever.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OpenRouterProvider } from '../src/llm/llm-client';
import { DEFAULT_CAPABLE_MODEL } from '../src/llm/openrouter-catalog';
import { LlmCueComposer } from '../src/presentation/composer/composer-service';
import { validateCuePack } from '../src/presentation/cue-schema';
import { COMPOSER_SYSTEM, composerUserPrompt, type CueSpec } from '../src/presentation/composer/cue-prompt';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/asset-library/cues');
const OUT_FILE = join(OUT_DIR, 'base.json');
const PACK_VERSION = 1;

/** The library to compose. Ids mirror the hand-authored base set so the
 *  generated cues REPLACE them at load time (richer, same routing). */
const SPECS: CueSpec[] = [
  {
    id: 'bed_lively', role: 'bed', tags: ['town'], mood: { liveliness: [0.6, 1] },
    intent: 'a bright, bustling daytime village bed — music-box arpeggio over a gentle walking bass; warm and busy but never frantic',
  },
  {
    id: 'bed_reverence', role: 'bed', tags: ['sacred'], mood: { reverence: [0.55, 1] },
    intent: 'a still, sacred bed — slow warm pad chords with a sparse high bell; reverent, spacious, almost hymn-like',
  },
  {
    id: 'bed_tension', role: 'bed', tags: ['dread'], mood: { tension: [0.5, 1] },
    intent: 'a low minor drone of dread — sustained dark pad with a slow heartbeat bass and an occasional sour step; unresolved',
  },
  {
    id: 'swell_miracle', role: 'swell', tags: ['miracle', 'ascension'],
    intent: 'a short bright swell of awe for a miracle — rising pad chord capped by a pair of ascending bells',
  },
  {
    id: 'dirge_death', role: 'swell', tags: ['death', 'npc_death', 'loss'],
    intent: 'a brief low dirge for a death — two descending dark chords over a falling bass; mournful, gentle',
  },
  {
    id: 'fanfare_settlement', role: 'swell', tags: ['settlement_founded', 'settlement_grown', 'arrival'],
    intent: 'a gentle ascending fanfare for a settlement founded — a small rising music-box figure resolving to a bright bell',
  },
];

const planOnly = process.argv.includes('--plan');
const apiKey = process.env.OPENROUTER_API_KEY;

async function main(): Promise<void> {
  if (planOnly || !apiKey) {
    console.log(planOnly ? '[compose-cues] --plan: no API calls.' : '[compose-cues] No OPENROUTER_API_KEY — dry run (no API calls).');
    console.log(`\nModel that WOULD be used: ${DEFAULT_CAPABLE_MODEL}`);
    console.log(`Output: ${OUT_FILE}`);
    console.log(`\n${SPECS.length} cue specs:`);
    for (const s of SPECS) console.log(`  • ${s.id} [${s.role}] — ${s.intent}`);
    console.log('\n— system prompt —\n' + COMPOSER_SYSTEM);
    console.log('\n— user prompt —\n' + composerUserPrompt(SPECS));
    if (!apiKey && !planOnly) console.log('\nSet OPENROUTER_API_KEY to actually compose + write.');
    return;
  }

  const provider = new OpenRouterProvider({ apiKey, model: DEFAULT_CAPABLE_MODEL });
  const composer = new LlmCueComposer(provider, { model: DEFAULT_CAPABLE_MODEL });

  console.log(`[compose-cues] composing ${SPECS.length} cues via ${DEFAULT_CAPABLE_MODEL}…`);
  const cues = await composer.composeLibrary(SPECS);

  // Re-validate (composeLibrary already did, but be explicit at the write boundary).
  const valid = validateCuePack({ cues });
  const got = new Set(valid.map((c) => c.id));
  const missing = SPECS.filter((s) => !got.has(s.id)).map((s) => s.id);
  if (missing.length) console.warn(`[compose-cues] WARNING: model omitted/failed: ${missing.join(', ')}`);
  if (!valid.length) {
    console.error('[compose-cues] no valid cues produced — NOT writing (base TS set stays in effect).');
    process.exitCode = 1;
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const pack = { version: PACK_VERSION, model: DEFAULT_CAPABLE_MODEL, cues: valid };
  await writeFile(OUT_FILE, JSON.stringify(pack, null, 2) + '\n', 'utf8');
  console.log(`[compose-cues] wrote ${valid.length} cues → ${OUT_FILE}`);
}

void main();
