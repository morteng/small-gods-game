// scripts/connectome-lint.ts
// The connectome CONTRACT feedback loop, offline + deterministic. Generates EVERY
// PLAYABLE world from one or more fixed seeds, runs `evaluateContracts`, and prints
// a report GROUPED BY LEVEL (building / site / settlement / world) with the unmet
// REQUIREMENTS called out. Exits non-zero when any error or unmet requirement is
// found — so this is the "run it through a process, it spits back something
// evaluable" loop, runnable in CI and by hand.
//
//   npm run lint:world                # lint every PLAYABLE_WORLD_NAME on default seeds
//   npx tsx scripts/connectome-lint.ts 12345 777 42        # those seeds, all worlds
//   npx tsx scripts/connectome-lint.ts --world dawn 42     # one playable world
//   npx tsx scripts/connectome-lint.ts --world some/path.json # an arbitrary seed file
//   npm run lint:testbed              # the DEV-ONLY testbed vale, pinned to TESTBED_GEN_SEED
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '../src/map/map-generator';
import { evaluateContracts, type ContractLevel } from '../src/world/connectome-contracts';
import type { Diagnostic } from '../src/world/connectome-diagnostics';
import type { WorldSeed } from '../src/core/types';
import { validateWorldSeed } from '../src/core/schema';
import { planWorldLayout } from '../src/world/poi-layout';
import { PLAYABLE_WORLD_NAMES, resolvePlayableWorld } from '../src/world/playable-worlds';

const LEVELS: ContractLevel[] = ['world', 'settlement', 'site', 'building'];
const SEV_TAG: Record<string, string> = { error: '✘', warn: '▲', info: '·' };

/** The one literal id that is NOT a `public/data/worlds/*.json` file: the dev-only
 *  integration testbed (`src/world/testbed/testbed-world.ts`, WP-T1/T3). It is never in
 *  `PLAYABLE_WORLD_NAMES` by design, so it can never appear from the no-args default
 *  sweep — only an explicit `--world testbed` reaches it. */
const TESTBED_TARGET_ID = 'testbed';

interface LintTarget {
  id: string;
  path: string;
  /** Load the seed a different way than `JSON.parse(readFileSync(path))`, optionally
   *  pinning the gen seed(s) to generate at — only the testbed target sets this (a
   *  code-authored seed defined at exactly one gen seed, not a JSON file). */
  load?: () => Promise<{ seed: WorldSeed; genSeeds?: number[] }>;
}

/** Resolve the worlds to lint: an explicit `--world <id|path>` (one) else every
 *  playable world. */
function resolveTargets(argv: string[]): LintTarget[] {
  const wi = argv.indexOf('--world');
  if (wi !== -1 && argv[wi + 1]) {
    const raw = argv[wi + 1];
    if (raw.trim().toLowerCase() === TESTBED_TARGET_ID) {
      return [{
        id: TESTBED_TARGET_ID,
        path: 'src/world/testbed/testbed-world.ts',
        load: async () => {
          const { testbedSeed, TESTBED_GEN_SEED } = await import('../src/world/testbed/testbed-world');
          return { seed: testbedSeed(), genSeeds: [TESTBED_GEN_SEED] };
        },
      }];
    }
    // A path (contains a slash or ends .json) is loaded as-is; otherwise a bare
    // playable-world id, resolved through the registry (unknown -> the default).
    if (raw.includes('/') || raw.endsWith('.json')) return [{ id: raw, path: raw }];
    const id = resolvePlayableWorld(raw);
    // Make a typo'd id LOUD rather than silently linting the wrong world.
    if (id === 'default' && raw.trim().toLowerCase() !== 'default') {
      console.warn(`[connectome-lint] unknown playable world "${raw}" — linting "${id}" instead`);
    }
    return [{ id, path: `public/data/worlds/${id}.json` }];
  }
  return PLAYABLE_WORLD_NAMES.map((id) => ({ id, path: `public/data/worlds/${id}.json` }));
}

function lineFor(d: Diagnostic): string {
  const loc = d.locus.pois?.[0] ?? d.locus.entities?.[0]
    ?? (d.locus.tiles?.[0] ? `(${d.locus.tiles[0].x},${d.locus.tiles[0].y})` : '');
  return `    ${SEV_TAG[d.severity] ?? '?'} ${d.rule}: ${d.message}${loc ? `  @ ${loc}` : ''}`;
}

/**
 * `--max-errors N` — the ERROR BUDGET this invocation is allowed, i.e. a REGRESSION BAR
 * rather than a clean bar.
 *
 * WHY THIS EXISTS, stated plainly so nobody reads it as a lowered standard: **zero errors
 * is a bar no world in this repo meets.** Measured at the same gen seed, the shipped
 * `default` world scores 4 errors and the dev testbed 6, and both therefore FAIL. A gate
 * that is red on main tells you nothing on the day you break something — so the honest
 * instrument is "no worse than the number we actually achieve", pinned per target and
 * lowered as the errors are genuinely fixed. UNMET REQUIREMENTS are NOT budgetable and
 * still fail unconditionally: a requirement is a contract the world declared for itself.
 *
 * Defaults to 0, so `npm run lint:world` behaves exactly as before.
 */
function parseMaxErrors(argv: string[]): number {
  const i = argv.indexOf('--max-errors');
  if (i === -1) return 0;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`[connectome-lint] --max-errors needs a non-negative integer, got "${argv[i + 1]}"`);
    process.exit(2);
  }
  return n;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const maxErrors = parseMaxErrors(argv);
  // `--max-errors 6` must not be read as "also lint gen seed 6": drop the flag's value.
  const mi = argv.indexOf('--max-errors');
  const seedArgv = mi === -1 ? argv : [...argv.slice(0, mi), ...argv.slice(mi + 2)];
  const seeds = seedArgv.map(Number).filter((n) => Number.isFinite(n));
  const useSeeds = seeds.length ? seeds : [12345, 777];
  const targets = resolveTargets(argv);

  let failed = false;

  for (const { id, path, load } of targets) {
    console.log(`\n════════ WORLD: ${id} ════════`.replace(/\s*=\s*$/, ''));
    console.log(`  source: ${path}`);
    const loaded = load ? await load() : { seed: JSON.parse(readFileSync(path, 'utf8')) as WorldSeed };
    const ws = loaded.seed;
    // A target that pins its own gen seed(s) (the testbed — defined at exactly one
    // seed, see TESTBED_GEN_SEED) overrides the CLI/default seed list; every other
    // target keeps today's behaviour untouched.
    const seedsForTarget = loaded.genSeeds ?? useSeeds;

    // Schema validation first — a structurally broken seed makes every downstream
    // finding suspect. Errors fail the lint; warnings print but pass.
    const v = validateWorldSeed(ws);
    if (v.errors.length) {
      console.log(`SEED ERRORS (${v.errors.length}):`);
      for (const e of v.errors) console.log(`    ✘ ${e}`);
      failed = true;
    }
    if (v.warnings.length) {
      console.log(`SEED WARNINGS (${v.warnings.length}):`);
      for (const wmsg of v.warnings) console.log(`    ▲ ${wmsg}`);
    }

    // Lint the LAID-OUT world — island seeds grow the map and shift every POI via
    // planWorldLayout in the live path (bootstrap-world), so linting the raw
    // authored size would measure a world the player never sees.
    const layout = planWorldLayout(ws);
    const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };

    for (const seed of seedsForTarget) {
      // Fresh layout per seed: generateWithNoise snaps dry-settlement POIs off standing
      // water IN PLACE (preserving map.worldSeed identity), so a SHARED layout object
      // would leak one seed's snapped positions into the next. Deep-clone the pois.
      const perSeed: WorldSeed = {
        ...laidOut,
        pois: laidOut.pois.map((p) => ({ ...p, position: p.position ? { ...p.position } : p.position })),
      };
      const { map, world } = await generateWithNoise(layout.size.width, layout.size.height, seed, perSeed);
      const report = evaluateContracts({ world, map });
      const decls = map.contracts?.declarations.length ?? 0;

      console.log(`\n═══ ${id} · seed ${seed} ═══`);
      console.log(`  ${report.total} findings — ${report.counts.error} error / ${report.counts.warn} warn / ${report.counts.info} info`
        + `  ·  ${report.byKind.requirement} requirement / ${report.byKind.invariant} invariant  ·  ${decls} declarations`);

      for (const level of LEVELS) {
        if (report.byLevel[level] === 0) continue;
        console.log(`  ── ${level} (${report.byLevel[level]}) ──`);
      }

      if (report.unmet.length) {
        console.log(`  UNMET REQUIREMENTS (${report.unmet.length}):`);
        for (const d of report.unmet) console.log(lineFor(d));
      }
      const nonReq = report.diagnostics.filter((d) => !report.unmet.includes(d));
      if (nonReq.length) {
        console.log(`  INVARIANT FINDINGS (${nonReq.length}):`);
        for (const d of nonReq.slice(0, 30)) console.log(lineFor(d));
        if (nonReq.length > 30) console.log(`    … +${nonReq.length - 30} more`);
      }
      if (report.total === 0) console.log('  ✓ clean');

      // Errors are BUDGETED (see parseMaxErrors); unmet requirements never are.
      if (report.counts.error > maxErrors) {
        console.log(`  ✘ ${report.counts.error} error(s) — over the budget of ${maxErrors}`);
        failed = true;
      } else if (maxErrors > 0) {
        console.log(`  ⚠ ${report.counts.error}/${maxErrors} error(s) — within budget, NOT clean`
          + (report.counts.error < maxErrors ? '. Lower --max-errors to lock the gain in.' : ''));
      }
      if (report.unmet.length > 0) failed = true;
    }
  }

  console.log(failed
    ? '\nFAIL: errors over budget, or unmet requirements — see above'
    : maxErrors > 0
      ? `\nPASS: within the ${maxErrors}-error budget, all requirements met (NOT a clean world)`
      : '\nPASS: no errors, all requirements met');
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
