// scripts/verify-sprite-bundle.ts
//
// RELEASE GATE ($0, no network) — fails the build if the prebaked parametric
// sprite bundle under `public/data/parametric-sprites/<ART_RECIPE_VERSION>/`
// is missing, stale, or corrupt. Runs as `prebuild` / `prebuild:electron`, so
// a geometry-recipe bump that isn't re-seeded can never silently ship: first-
// visit clients would fall back to the ~53s cold compose backlog (the exact
// "fast loads" regression this guards). The bundle is keyed on
// ART_RECIPE_VERSION (NOT WORLD_CONTENT_VERSION) — worldgen-only bumps (bridges,
// roads) don't invalidate it; a bump to the compose recipe does.
//
// Reseed with:  npx vite --port 3033 &   # Chromium plant-key pass
//               npx tsx scripts/seed-parametric-sprites.ts
//
// Run standalone:  npx tsx scripts/verify-sprite-bundle.ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ART_RECIPE_VERSION } from '@/core/content-version';

interface Manifest {
  recipeVersion: string;
  count: number;
  totalBytes: number;
  shards: { file: string; bytes: number }[];
  packs: Record<string, unknown>;
}

/** Repo root — every invocation path (npm scripts, `npx tsx`, vitest) runs from here. */
const ROOT = process.cwd();

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  dir: string;
  count?: number;
}

export function verifySpriteBundle(version = ART_RECIPE_VERSION): VerifyResult {
  const dir = join(ROOT, 'public', 'data', 'parametric-sprites', version);
  const errors: string[] = [];
  const manifestPath = join(dir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    errors.push(`no prebaked bundle for ${version} — expected ${manifestPath}`);
    return { ok: false, errors, dir };
  }

  let m: Manifest;
  try {
    m = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  } catch (e) {
    errors.push(`manifest.json is not valid JSON: ${(e as Error).message}`);
    return { ok: false, errors, dir };
  }

  if (m.recipeVersion !== version) {
    errors.push(`manifest.recipeVersion=${m.recipeVersion} ≠ ART_RECIPE_VERSION=${version}`);
  }
  if (!(m.count > 0)) {
    errors.push(`manifest.count is ${m.count} (expected > 0)`);
  }
  const packCount = m.packs ? Object.keys(m.packs).length : 0;
  if (packCount !== m.count) {
    errors.push(`manifest.count=${m.count} but packs has ${packCount} entries`);
  }
  // Every declared shard must exist on disk at its declared size (a truncated
  // or missing shard would strand its packs' waiters at runtime).
  for (const shard of m.shards ?? []) {
    const p = join(dir, shard.file);
    if (!existsSync(p)) {
      errors.push(`shard missing: ${shard.file}`);
      continue;
    }
    const bytes = statSync(p).size;
    if (bytes !== shard.bytes) {
      errors.push(`shard ${shard.file}: ${bytes} bytes on disk, manifest says ${shard.bytes}`);
    }
  }

  return { ok: errors.length === 0, errors, dir, count: m.count };
}

function main(): void {
  const r = verifySpriteBundle();
  if (r.ok) {
    console.log(`✓ parametric sprite bundle ${ART_RECIPE_VERSION} OK (${r.count} packs).`);
    return;
  }
  console.error(`\n✗ Prebaked parametric sprite bundle is stale or broken (ART_RECIPE_VERSION=${ART_RECIPE_VERSION}):\n`);
  for (const e of r.errors) console.error(`  • ${e}`);
  console.error(
    `\nWithout it, first-visit players pay the ~53s cold compose backlog.\n` +
      `Reseed the bundle, then commit public/data/parametric-sprites/${ART_RECIPE_VERSION}/:\n\n` +
      `  npx vite --port 3033 &\n` +
      `  npx tsx scripts/seed-parametric-sprites.ts\n`,
  );
  process.exit(1);
}

// Only run the CLI when executed directly — the guard is importable for tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
