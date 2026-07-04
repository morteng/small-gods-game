// Version pin for the COMMITTED vendored parametric-sprite bundle
// (public/data/parametric-sprites/). RED here means someone bumped
// ART_RECIPE_VERSION (geometry changed) without rerunning
// `npx tsx scripts/seed-parametric-sprites.ts` — the shipped bundle would
// silently stop matching any runtime key and every first visit would pay the
// full compose backlog again. Skips cleanly when no bundle is committed.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ART_RECIPE_VERSION } from '@/core/content-version';
import type { VendoredManifest } from '@/render/vendored-sprite-bundle';

const BASE = join(process.cwd(), 'public/data/parametric-sprites');
const hasBundle = existsSync(BASE);

describe.skipIf(!hasBundle)('vendored parametric-sprite bundle (committed)', () => {
  const dir = join(BASE, ART_RECIPE_VERSION);

  it(`carries a bundle for the CURRENT recipe version (${ART_RECIPE_VERSION}) — reseed on any geometry bump`, () => {
    expect(existsSync(join(dir, 'manifest.json')),
      `no ${ART_RECIPE_VERSION} bundle under public/data/parametric-sprites/ — run: npx tsx scripts/seed-parametric-sprites.ts`,
    ).toBe(true);
  });

  it('has no stale version directories (dead weight in the repo + pages artifact)', () => {
    const dirs = readdirSync(BASE, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(dirs).toEqual([ART_RECIPE_VERSION]);
  });

  it('manifest is internally consistent: version, count, keys, shard offsets', () => {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as VendoredManifest;
    expect(m.recipeVersion).toBe(ART_RECIPE_VERSION);
    const keys = Object.keys(m.packs);
    expect(m.count).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.startsWith(`${ART_RECIPE_VERSION}:`), `stale-version key ${k}`).toBe(true);
    // Every shard file exists at its manifest-recorded size; every pack fits its shard.
    const sizes = m.shards.map((s) => {
      const p = join(dir, s.file);
      expect(existsSync(p), `missing shard ${s.file}`).toBe(true);
      const bytes = statSync(p).size;
      expect(bytes).toBe(s.bytes);
      return bytes;
    });
    for (const k of keys) {
      const e = m.packs[k];
      expect(e.s).toBeGreaterThanOrEqual(0);
      expect(e.s).toBeLessThan(sizes.length);
      expect(e.o).toBeGreaterThanOrEqual(0);
      expect(e.l).toBeGreaterThan(0);
      expect(e.o + e.l, `pack ${k} overruns shard ${e.s}`).toBeLessThanOrEqual(sizes[e.s]);
      expect(e.enc === 'deflate-raw' || e.enc === 'raw').toBe(true);
      expect(() => JSON.parse(e.meta)).not.toThrow();
    }
  });
});
