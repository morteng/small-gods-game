// scripts/connectome-lint.ts
// The connectome CONTRACT feedback loop, offline + deterministic. Generates the default world
// from one or more fixed seeds, runs `evaluateContracts`, and prints a report GROUPED BY LEVEL
// (building / site / settlement / world) with the unmet REQUIREMENTS called out. Exits non-zero
// when any error or unmet requirement is found — so this is the "run it through a process, it
// spits back something evaluable" loop, runnable in CI and by hand.
//
//   npm run lint:world            # default seeds
//   npx tsx scripts/connectome-lint.ts 12345 777 42
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '../src/map/map-generator';
import { evaluateContracts, type ContractLevel } from '../src/world/connectome-contracts';
import type { Diagnostic } from '../src/world/connectome-diagnostics';
import type { WorldSeed } from '../src/core/types';
import { validateWorldSeed } from '../src/core/schema';
import { planWorldLayout } from '../src/world/poi-layout';

const LEVELS: ContractLevel[] = ['world', 'settlement', 'site', 'building'];
const SEV_TAG: Record<string, string> = { error: '✘', warn: '▲', info: '·' };

function lineFor(d: Diagnostic): string {
  const loc = d.locus.pois?.[0] ?? d.locus.entities?.[0]
    ?? (d.locus.tiles?.[0] ? `(${d.locus.tiles[0].x},${d.locus.tiles[0].y})` : '');
  return `    ${SEV_TAG[d.severity] ?? '?'} ${d.rule}: ${d.message}${loc ? `  @ ${loc}` : ''}`;
}

async function main(): Promise<void> {
  const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
  const useSeeds = seeds.length ? seeds : [12345, 777];
  const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;

  let failed = false;

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

  for (const seed of useSeeds) {
    const { map, world } = await generateWithNoise(layout.size.width, layout.size.height, seed, laidOut);
    const report = evaluateContracts({ world, map });
    const decls = map.contracts?.declarations.length ?? 0;

    console.log(`\n═══ seed ${seed} ═══`);
    console.log(`  ${report.total} findings — ${report.counts.error} error / ${report.counts.warn} warn / ${report.counts.info} info`
      + `  ·  ${report.byKind.requirement} requirement / ${report.byKind.invariant} invariant  ·  ${decls} declarations`);

    // Group the diagnostics by the LEVEL of the contract that emitted them.
    const regByLevel = new Map<string, ContractLevel>();
    // (Re-derive level per rule via the report's byLevel counts is lossy; instead just print
    //  each diagnostic under a heading grouped by kind, since level is a contract property.)
    for (const level of LEVELS) {
      if (report.byLevel[level] === 0) continue;
      console.log(`  ── ${level} (${report.byLevel[level]}) ──`);
    }
    void regByLevel;

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

    if (report.counts.error > 0 || report.unmet.length > 0) failed = true;
  }

  console.log(failed ? '\nFAIL: errors or unmet requirements — see above' : '\nPASS: no errors, all requirements met');
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
