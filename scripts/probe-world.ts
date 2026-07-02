/**
 * probe-world — CLI for the WORLD DOCTOR (`src/world/world-doctor.ts`). Feed it a
 * seed JSON and it answers the question an authoring agent (or a human) cannot
 * answer from the JSON alone: WHAT DID MY SEED ACTUALLY BUILD?
 *
 *   npx tsx scripts/probe-world.ts                          # default world
 *   npx tsx scripts/probe-world.ts path/to/seed.json 777    # custom seed file + gen seed
 *   npx tsx scripts/probe-world.ts --json                   # machine-readable (for agents/MCP)
 */
import { readFileSync } from 'node:fs';
import { diagnoseWorldSeed, formatDoctorReport } from '@/world/world-doctor';
import type { WorldSeed } from '@/core/types';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const rest = args.filter((a) => a !== '--json');
const seedPath = rest.find((a) => a.endsWith('.json')) ?? 'public/data/worlds/default.json';
const genSeed = Number(rest.find((a) => /^\d+$/.test(a)) ?? 12345);

async function main(): Promise<void> {
  const ws = JSON.parse(readFileSync(seedPath, 'utf8')) as WorldSeed;
  const report = await diagnoseWorldSeed(ws, genSeed);
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorReport(report));
  }
  if (report.complaints.some((c) => c.severity === 'error')) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
