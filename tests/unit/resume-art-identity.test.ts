import { describe, it, expect, vi } from 'vitest';
import { bootstrapWorld } from '@/game/bootstrap-world';
import { createState, type GameState } from '@/core/state';
import { toSaveFile, applySaveFile } from '@/core/save-file';
import { canonicalJson } from '@/render/generated-art-cache';
import type { Entity, WorldSeed } from '@/core/types';
import '@/world/brushes/index';

/**
 * A RESUMED world must have the same ART IDENTITY as the freshly generated one.
 *
 * Triage for a live-pass observation (2026-07-25): on the resume path several
 * structures rendered as flat grey massing where the same world painted fully on
 * fresh entry. Grey massing means the sprite source produced no pack, and the two
 * candidate causes are very different in severity:
 *
 *   (a) the art CACHES degraded (wedged IndexedDB) — by design, and harmless to
 *       correctness: `ParametricBuildingSource.warm` explicitly falls back from a
 *       failed/wedged cache read to composing, so nothing depends on the cache;
 *   (b) save/restore CHANGED the blueprint the sprite key is derived from, so
 *       every lookup misses and the vendored bundle can never hit — a real
 *       regression.
 *
 * This test rules (b) in or out. Both the in-memory pack key (`JSON.stringify(rb)`,
 * which is KEY-ORDER SENSITIVE) and the persisted-cache key (`canonicalJson`, which
 * is not) are compared across a full `toSaveFile` → `applySaveFile` round-trip.
 */

const stubAssets = { loadAll: async () => {} } as never;
const stubDecorationImages = { preload: async () => {}, destroy: () => {} } as never;
const getViewport = (): never => ({ width: 100, height: 100 } as never);

const testSeed: WorldSeed = {
  name: 'resume-art-identity',
  size: { width: 96, height: 96 },
  biome: 'temperate',
  pois: [{
    id: 'v', type: 'village', name: 'V', position: { x: 48, y: 48 },
    size: 'medium', description: 'x',
    npcs: [{ name: 'Seed', role: 'farmer' }, { name: 'Two', role: 'smith' }],
  }] as never,
  connections: [],
  constraints: [],
};

/** The blueprint the sprite sources key off, as both key flavours. */
function artKeysOf(state: GameState): Map<string, { strict: string; canonical: string }> {
  const out = new Map<string, { strict: string; canonical: string }>();
  const world = state.world;
  if (!world) return out;
  for (const e of [...world.query({ tag: 'building' }), ...world.query({ kind: 'barrier' })]) {
    const rb = (e as Entity & { properties?: { blueprint?: { rb?: unknown } } })
      .properties?.blueprint?.rb;
    out.set(e.id, {
      // `keyOf` in parametric-building-source.ts — order sensitive on purpose.
      strict: rb === undefined ? '<none>' : JSON.stringify(rb),
      // The persisted-cache flavour — order insensitive.
      canonical: rb === undefined ? '<none>' : canonicalJson(rb),
    });
  }
  return out;
}

async function freshWorld(): Promise<GameState> {
  const state = createState();
  await bootstrapWorld({
    state, assets: stubAssets, sheets: new Map(), decorationImages: stubDecorationImages,
    getViewport, worldSeed: structuredClone(testSeed),
    forceFresh: true,
    readSave: async () => null,
  });
  return state;
}

/** Real worldgen inside a test is inherently slow (terrain + hydrology + seeding),
 *  and vitest's 5 s default is measured against a CONTENDED CI box — a shared
 *  8-vCPU runner with another project's suite alongside it turned these into
 *  timeout flakes. The work is legitimately this expensive, so the budget is
 *  stated explicitly rather than left to a default that happens to fit on an idle
 *  laptop. */
const WORLDGEN_TIMEOUT_MS = 60_000;
vi.setConfig({ testTimeout: WORLDGEN_TIMEOUT_MS });

describe('resume preserves art identity', () => {
  it('round-tripping a save leaves every structure sprite key IDENTICAL', async () => {
    const fresh = await freshWorld();
    const before = artKeysOf(fresh);
    expect(before.size, 'the fixture world must contain structures to compare')
      .toBeGreaterThan(0);

    // Full save → restore, exactly as the resume path does it.
    const save = toSaveFile(fresh, 1);
    const restored = createState();
    expect(applySaveFile(restored, save, [])).toBe(true);
    const after = artKeysOf(restored);

    // Same structures survived.
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());

    // And each one keys to the same sprite, under BOTH key flavours. A mismatch
    // here would mean every cache/bundle lookup misses after a resume — which
    // would be the real regression this test exists to rule out.
    const strictDiffs: string[] = [];
    const canonicalDiffs: string[] = [];
    for (const [id, keys] of before) {
      const got = after.get(id)!;
      if (got.strict !== keys.strict) strictDiffs.push(id);
      if (got.canonical !== keys.canonical) canonicalDiffs.push(id);
    }
    expect(canonicalDiffs, 'persisted-cache keys changed across a resume').toEqual([]);
    expect(strictDiffs, 'in-memory pack keys changed across a resume').toEqual([]);
  });

  it('no structure loses its blueprint across a resume', async () => {
    // `peek()` returns null — and the renderer falls back to grey massing — when
    // `blueprintOf(e).rb` is absent. So a blueprint dropped by the save round-trip
    // would produce exactly the reported symptom.
    const fresh = await freshWorld();
    const save = toSaveFile(fresh, 1);
    const restored = createState();
    applySaveFile(restored, save, []);
    const missing = [...artKeysOf(restored).entries()]
      .filter(([, k]) => k.strict === '<none>')
      .map(([id]) => id);
    const missingBefore = [...artKeysOf(fresh).entries()]
      .filter(([, k]) => k.strict === '<none>')
      .map(([id]) => id);
    // Any structure without a blueprint must be one that never had one — the
    // resume must not INTRODUCE a blueprint-less structure.
    expect(missing.sort()).toEqual(missingBefore.sort());
  });
});
