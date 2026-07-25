import { describe, it, expect, vi } from 'vitest';
import { bootstrapWorld } from '@/game/bootstrap-world';
import { createState } from '@/core/state';
import type { WorldSeed } from '@/core/types';
import '@/world/brushes/index';

/**
 * UI v3 §3.5/§3.7 — the URL-FREE route to a specific world.
 *
 * Before this epic, "start a fresh world at seed N" was only expressible as
 * `?genseed=N` plus a page load. An agent driving the game over the bus has no
 * URL to set and must not reload the tab, so `bootstrapWorld` grew explicit
 * `forceFresh` / `genSeedOverride` deps. These tests pin that they work and that
 * they take precedence, because a `new_game` command silently resuming an old
 * autosave instead would be a genuinely confusing failure.
 */

const stubAssets = { loadAll: async () => {} } as never;
const stubDecorationImages = { preload: async () => {}, destroy: () => {} } as never;
const getViewport = (): never => ({ width: 100, height: 100 } as never);

const testSeed: WorldSeed = {
  name: 'explicit-fresh-test',
  size: { width: 64, height: 64 },
  biome: 'temperate',
  pois: [{
    id: 'v', type: 'village', name: 'V', position: { x: 32, y: 32 },
    size: 'medium', description: 'x', npcs: [{ name: 'Seed', role: 'farmer' }],
  }] as never,
  connections: [],
  constraints: [],
};

/** Real worldgen inside a test is inherently slow (terrain + hydrology + seeding),
 *  and vitest's 5 s default is measured against a CONTENDED CI box — a shared
 *  8-vCPU runner with another project's suite alongside it turned these into
 *  timeout flakes. The work is legitimately this expensive, so the budget is
 *  stated explicitly rather than left to a default that happens to fit on an idle
 *  laptop. */
const WORLDGEN_TIMEOUT_MS = 60_000;
vi.setConfig({ testTimeout: WORLDGEN_TIMEOUT_MS });

describe('bootstrapWorld — explicit fresh / seed override', () => {
  it('forceFresh GENERATES even when a readable save exists', async () => {
    let readSaveCalls = 0;
    let appliedSave = false;
    const state = createState();
    await bootstrapWorld({
      state, assets: stubAssets, sheets: new Map(), decorationImages: stubDecorationImages,
      getViewport, worldSeed: testSeed,
      forceFresh: true,
      readSave: async () => { readSaveCalls++; return null; },
      applySave: () => { appliedSave = true; return true; },
    });
    // The save is not even READ when a fresh world was explicitly demanded — the
    // same short-circuit `?genseed` already relied on.
    expect(readSaveCalls).toBe(0);
    expect(appliedSave).toBe(false);
    expect(state.map).not.toBeNull();
    expect(state.world).not.toBeNull();
  });

  it('WITHOUT forceFresh the ordinary resume path is still taken', async () => {
    // Guards the default: adding the parameter must not have changed behaviour for
    // every existing caller that omits it.
    let readSaveCalls = 0;
    const state = createState();
    await bootstrapWorld({
      state, assets: stubAssets, sheets: new Map(), decorationImages: stubDecorationImages,
      getViewport, worldSeed: testSeed,
      readSave: async () => { readSaveCalls++; return null; },
    });
    expect(readSaveCalls).toBe(1);
  });

  it('genSeedOverride picks the world, and implies a fresh generation', async () => {
    // Two different overrides must produce two different worlds — the seed has to
    // actually reach the generator, not merely be accepted.
    const seeds = [4242, 99] as const;
    const digests: string[] = [];
    for (const genSeedOverride of seeds) {
      const state = createState();
      await bootstrapWorld({
        state, assets: stubAssets, sheets: new Map(), decorationImages: stubDecorationImages,
        getViewport, worldSeed: structuredClone(testSeed),
        genSeedOverride,
        readSave: async () => null,
      });
      expect(state.map).not.toBeNull();
      // A cheap terrain digest: the tile-type row across the middle.
      const m = state.map!;
      const mid = Math.floor(m.height / 2);
      digests.push(m.tiles[mid].map(t => t.type).join(','));
    }
    expect(digests[0]).not.toBe(digests[1]);
  });

  it('onReady means FULLY built — map/world are set long before it fires', async () => {
    /**
     * The invariant `Game.worldReady` (and therefore the sim advance) depends on.
     *
     * Since the boot restructure the frame loop is already running while worldgen
     * proceeds — it starts with the SHELL so the title backdrop can animate. But
     * `bootstrapWorld` assigns `state.map`/`state.world` PARTWAY THROUGH, before it
     * seeds the statistical cohorts, installs the weather stepper and builds the
     * flood watch. So "map exists" is NOT "world is ready", and the sim must gate
     * on `onReady` instead. This pins that distinction in both directions.
     */
    const state = createState();
    let mapSetBeforeReady = false;
    let readySawFullWorld = false;
    await bootstrapWorld({
      state, assets: stubAssets, sheets: new Map(), decorationImages: stubDecorationImages,
      getViewport, worldSeed: structuredClone(testSeed),
      forceFresh: true,
      readSave: async () => null,
      onProgress: () => {
        // Mid-generation: the map/world land here, well before onReady.
        if (state.map && state.world) mapSetBeforeReady = true;
      },
      onReady: () => {
        // By onReady EVERYTHING the sim systems read must be in place.
        readySawFullWorld = !!state.map && !!state.world
          && state.weather !== null && state.floodWatch !== null
          && state.causalSites !== null && state.cohorts.size > 0;
      },
    });
    expect(mapSetBeforeReady, 'map/world should be set mid-generation').toBe(true);
    expect(readySawFullWorld, 'onReady must see cohorts + weather + floodWatch installed').toBe(true);
  });

  it('an invalid genSeedOverride is ignored rather than producing seed 0/NaN', async () => {
    const state = createState();
    await bootstrapWorld({
      state, assets: stubAssets, sheets: new Map(), decorationImages: stubDecorationImages,
      getViewport, worldSeed: testSeed,
      genSeedOverride: Number.NaN,
      readSave: async () => null,
    });
    expect(state.map).not.toBeNull();
  });
});
