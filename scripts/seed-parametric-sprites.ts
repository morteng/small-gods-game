// scripts/seed-parametric-sprites.ts
//
// AUTHOR-TIME seeder for the VENDORED parametric sprite bundle (WP-H, $0 —
// pure procedural compose, no img2img / no API calls). Lays out worlds offline
// (the same `planWorldLayout` → `generateWithNoise` path probe-world/lint:world
// use), collects every parametric spec the three runtime sources would compose
// (buildings via blueprint→toGeometry, barrier elements via runElements, plant
// species via presets), composes each with the EXACT runtime options, encodes
// with WP-G's `encodeSpritePayload`, and writes a static bundle:
//
//   public/data/parametric-sprites/<ART_RECIPE_VERSION>/
//     manifest.json           version, count, per-key → shard/offset/len + meta
//     shard-000.bin …         concatenated encoded buffers (mostly deflate-raw)
//
// The runtime vendored tier (`src/render/vendored-sprite-bundle.ts`) fetches
// these same-origin, so a FIRST-visit client skips the ~53s compose backlog.
//
// Run:
//   npx tsx scripts/seed-parametric-sprites.ts                # default worlds+seeds
//   npx tsx scripts/seed-parametric-sprites.ts --plan         # print, write nothing
//   npx tsx scripts/seed-parametric-sprites.ts --seeds=12345,777,42
//   npx tsx scripts/seed-parametric-sprites.ts path/to/world.json --seeds=777
//
// DETERMINISTIC by construction: worldgen is seeded, compose is deterministic
// per spec, keys sort lexicographically, shards fill greedily in key order and
// the manifest carries no timestamps — re-runs are byte-identical (per Node
// zlib version), so diffs are honest.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planWorldLayout } from '@/world/poi-layout';
import { generateWithNoise } from '@/map/map-generator';
import { blueprintOf } from '@/blueprint/entity';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { runElements } from '@/render/parametric-barrier-source';
import { synthesizeBlueprint, plantPresetNames } from '@/blueprint/presets';
import { composeStructure, type StructureSpec } from '@/assetgen/compose';
import { canonicalJson } from '@/render/generated-art-cache';
import {
  parametricSpriteKey, payloadFromResult, encodeSpritePayload,
  type SpriteCacheNamespace,
} from '@/render/parametric-sprite-cache';
import { ART_RECIPE_VERSION } from '@/core/content-version';
import type { WorldSeed } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';

const OUT_BASE = 'public/data/parametric-sprites';
/** Greedy shard fill target — a handful of ~4MB fetches pipelines well under the
 *  runtime tier's 6-way concurrency cap; one-file-per-pack (~400 requests) would
 *  serialize into dozens of RTT rounds. */
const SHARD_TARGET_BYTES = 4 * 1024 * 1024;
/** ONE seeded world by default — measured 2026-07-05 (v24): building blueprints
 *  are PER-INSTANCE seeded (building-placer L2b `instSeed()`), so bld/bar keys
 *  are largely world-specific: default.json@777 added +200 bld / +234 bar keys
 *  (~55 MB) over @12345 with ~zero value for the Date.now()-seeded worlds real
 *  first visits generate. 12345 (the canonical lint/dev/e2e pin) + the 48
 *  world-independent plant species ≈ 34 MB and fully covers pinned-seed boots;
 *  random-seed boots get plants + the recurring barrier subset and compose the
 *  rest, as before. Pass --seeds=… to widen deliberately (budget ~60 MB). */
const DEFAULT_SEEDS = [12345];
const DEFAULT_WORLDS = ['public/data/worlds/default.json'];

interface Job {
  key: string;
  ns: SpriteCacheNamespace;
  spec: StructureSpec;
  /** Compose options — must mirror the runtime source EXACTLY. */
  opts?: { surfaceTexture?: boolean; yaw?: number };
  /** Where this key was first seen (diagnostics only). */
  from: string;
}

/** Collect building + barrier jobs from one laid-out, generated world. */
async function collectWorldJobs(seedPath: string, genSeed: number, jobs: Map<string, Job>): Promise<{ bld: number; bar: number }> {
  const ws = JSON.parse(readFileSync(seedPath, 'utf8')) as WorldSeed;
  const layout = planWorldLayout(ws);
  const laidOut: WorldSeed = { ...ws, size: layout.size, pois: layout.pois, connections: layout.connections };
  const { world } = await generateWithNoise(layout.size.width, layout.size.height, genSeed, laidOut);
  const from = `${seedPath}@${genSeed}`;
  let bld = 0, bar = 0;

  // Buildings: any entity carrying a resolved blueprint — the exact spec+key
  // derivation of ParametricBuildingSource.warm (closed variant; the on-demand
  // roof-off cutaway composes at runtime).
  for (const e of world.query({})) {
    const rb = blueprintOf(e)?.rb;
    if (!rb) continue;
    let spec: StructureSpec | null;
    try { spec = toGeometry(rb); } catch { continue; }
    if (!spec) continue;
    const key = parametricSpriteKey('bld', canonicalJson(spec));
    if (!jobs.has(key)) {
      jobs.set(key, {
        key, ns: 'bld', spec, from,
        opts: { surfaceTexture: true, ...(spec.yaw ? { yaw: spec.yaw } : {}) },
      });
      bld++;
    }
  }

  // Barrier elements: chunks/towers/gates/stairs — key material is el.key,
  // exactly what ParametricBarrierSource.warm persists under.
  for (const e of world.query({ tag: 'barrier' })) {
    const run = (e.properties as { barrier?: BarrierRun } | undefined)?.barrier;
    if (!run || !run.path || run.path.length < 2) continue;
    for (const el of runElements(run)) {
      const key = parametricSpriteKey('bar', el.key);
      if (!jobs.has(key)) {
        jobs.set(key, { key, ns: 'bar', spec: el.spec(), opts: { surfaceTexture: true }, from });
        bar++;
      }
    }
  }
  return { bld, bar };
}

/** Plant species jobs — world-independent (preset-derived), composed with NO options. */
function collectPlantJobs(jobs: Map<string, Job>): number {
  let n = 0;
  for (const kind of plantPresetNames()) {
    const rb = synthesizeBlueprint(kind);
    if (!rb) continue;
    let spec: StructureSpec | null;
    try { spec = toGeometry(rb); } catch { continue; }
    if (!spec) continue;
    const key = parametricSpriteKey('plt', canonicalJson(spec));
    if (!jobs.has(key)) { jobs.set(key, { key, ns: 'plt', spec, from: `plant:${kind}` }); n++; }
  }
  return n;
}

interface ManifestPack { s: number; o: number; l: number; enc: 'deflate-raw' | 'raw'; meta: string }

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const plan = argv.includes('--plan');
  const seedsArg = argv.find((a) => a.startsWith('--seeds='));
  const genSeeds = seedsArg ? seedsArg.slice('--seeds='.length).split(',').map(Number).filter(Number.isFinite) : DEFAULT_SEEDS;
  const worldPaths = argv.filter((a) => a.endsWith('.json') && !a.startsWith('--'));
  const worlds = worldPaths.length ? worldPaths : DEFAULT_WORLDS;

  ensureBuildingTypesRegistered();
  const jobs = new Map<string, Job>();
  const plt = collectPlantJobs(jobs);
  console.log(`plants: ${plt} species specs`);
  for (const wp of worlds) {
    if (!existsSync(wp)) { console.error(`world seed not found: ${wp}`); process.exit(1); }
    for (const gs of genSeeds) {
      const t0 = Date.now();
      const { bld, bar } = await collectWorldJobs(wp, gs, jobs);
      console.log(`${wp} @ genSeed ${gs}: +${bld} building, +${bar} barrier specs (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  }

  const keys = [...jobs.keys()].sort();
  const byNs = { bld: 0, bar: 0, plt: 0 } as Record<SpriteCacheNamespace, number>;
  for (const k of keys) byNs[jobs.get(k)!.ns]++;
  console.log(`\ntotal unique packs: ${keys.length}  (bld ${byNs.bld}, bar ${byNs.bar}, plt ${byNs.plt})  recipe ${ART_RECIPE_VERSION}`);

  if (plan) {
    for (const k of keys) console.log(`  ${k}  ← ${jobs.get(k)!.from}`);
    console.log('\n--plan: nothing written.');
    return;
  }

  // Compose + encode in sorted key order (deterministic shard layout).
  const encoded: Array<{ key: string; enc: 'deflate-raw' | 'raw'; meta: string; buf: Uint8Array }> = [];
  let done = 0, failed = 0;
  const t0 = Date.now();
  for (const key of keys) {
    const job = jobs.get(key)!;
    try {
      const r = job.opts ? await composeStructure(job.spec, undefined, job.opts) : await composeStructure(job.spec);
      const payload = payloadFromResult(r);
      if (!payload) throw new Error('degenerate compose result');
      const rec = await encodeSpritePayload(payload);
      encoded.push({ key, enc: rec.enc, meta: rec.meta, buf: new Uint8Array(rec.buf) });
    } catch (err) {
      failed++;
      console.warn(`  compose FAILED for ${key} (${job.from}): ${(err as Error).message}`);
    }
    done++;
    if (done % 25 === 0 || done === keys.length) {
      console.log(`  composed ${done}/${keys.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  }
  if (failed) console.warn(`${failed} spec(s) failed to compose — they will compose at runtime as before.`);

  // Greedy shard fill in key order.
  const shards: Array<{ file: string; parts: Uint8Array[]; bytes: number }> = [];
  const packs: Record<string, ManifestPack> = {};
  for (const e of encoded) {
    let s = shards[shards.length - 1];
    if (!s || s.bytes + e.buf.byteLength > SHARD_TARGET_BYTES) {
      s = { file: `shard-${String(shards.length).padStart(3, '0')}.bin`, parts: [], bytes: 0 };
      shards.push(s);
    }
    packs[e.key] = { s: shards.length - 1, o: s.bytes, l: e.buf.byteLength, enc: e.enc, meta: e.meta };
    s.parts.push(e.buf);
    s.bytes += e.buf.byteLength;
  }
  const totalBytes = shards.reduce((n, s) => n + s.bytes, 0);

  const outDir = join(OUT_BASE, ART_RECIPE_VERSION);
  rmSync(OUT_BASE, { recursive: true, force: true });   // drop stale versions too
  mkdirSync(outDir, { recursive: true });
  for (const s of shards) {
    const buf = new Uint8Array(s.bytes);
    let off = 0;
    for (const p of s.parts) { buf.set(p, off); off += p.byteLength; }
    writeFileSync(join(outDir, s.file), buf);
  }
  const manifest = {
    recipeVersion: ART_RECIPE_VERSION,
    count: encoded.length,
    totalBytes,
    shards: shards.map((s) => ({ file: s.file, bytes: s.bytes })),
    packs,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest) + '\n');

  const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);
  console.log(`\nwrote ${outDir}: ${encoded.length} packs, ${shards.length} shards, ${mb(totalBytes)} MB blobs (+ manifest ${mb(Buffer.byteLength(JSON.stringify(manifest)))} MB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
