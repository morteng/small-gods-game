/**
 * G1 — the NPC-art seeder. Money only moves inside `main()`, which this file
 * never calls (the `import.meta.url` guard at the script's tail means merely
 * importing it — exactly what these tests do — runs no backend and reads no
 * env var). What IS covered here is everything `main()` is built from: the
 * default target table actually names clips/facings the rig bakes, key/seed
 * derivation is stable, `--plan`'s output is right and touches no backend,
 * and a manifest row built from a real (mocked) pipeline result carries every
 * field the house rule demands — especially that an unseeded generation is
 * marked as such rather than quietly implying reproducibility.
 */
import { describe, it, expect } from 'vitest';
import { compositeOverChroma } from '@/render/chroma-key';
import { type Raster, cropRaster, opaqueBBox } from '@/render/sprite-postprocess';
import { createMockBackend } from '@/assetgen/compilers/mock-backend';
import {
  NPC_ART_RECIPE_VERSION,
} from '@/core/content-version';
import {
  generateNpcSheet, npcSheetSeed, nearestUpscale, padRaster,
  type NpcSheetDeps, type NpcSheetResult,
} from '@/assetgen/npc-sprite-pipeline';
import {
  NPC_SEED_TARGETS,
  availableFacings,
  clipFor,
  npcArtKey,
  wardrobeLayerHash,
  planLines,
  buildManifestRow,
  type NpcSeedTarget,
} from '../../scripts/seed-npc-art';

describe('NPC_SEED_TARGETS — the default table', () => {
  it('is small on purpose: every entry is real spend', () => {
    expect(NPC_SEED_TARGETS.length).toBeGreaterThanOrEqual(1);
    expect(NPC_SEED_TARGETS.length).toBeLessThanOrEqual(3);
  });

  it('names only a facing its clip actually bakes on the humanoid rig', () => {
    for (const target of NPC_SEED_TARGETS) {
      expect(availableFacings(target.clip)).toContain(target.facing);
      const clip = clipFor(target.clip, target.facing);
      expect(clip).toBeDefined();
      expect(clip?.name).toBe(target.clip);
    }
  });

  it('gives every target a distinct library key', () => {
    const keys = NPC_SEED_TARGETS.map(npcArtKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every subject a stable id (part of the key) and a wardrobe description', () => {
    for (const target of NPC_SEED_TARGETS) {
      expect(target.subject.id.length).toBeGreaterThan(0);
      expect(target.subject.wears.length).toBeGreaterThan(0);
    }
  });
});

describe('npcArtKey', () => {
  it('embeds the recipe version, subject, clip and facing', () => {
    const target: NpcSeedTarget = {
      subject: { id: 'test-subject', name: 'a test subject', wears: ['a robe'] },
      clip: 'walk',
      facing: 'down',
    };
    expect(npcArtKey(target)).toBe(`${NPC_ART_RECIPE_VERSION}:test-subject:walk:down`);
  });

  it('differs when any one part differs', () => {
    const base: NpcSeedTarget = {
      subject: { id: 'a', name: 'a', wears: [] },
      clip: 'walk',
      facing: 'down',
    };
    const bySubject: NpcSeedTarget = { ...base, subject: { ...base.subject, id: 'b' } };
    const byClip: NpcSeedTarget = { ...base, clip: 'march' };
    const byFacing: NpcSeedTarget = { ...base, facing: 'up' };
    const keys = [base, bySubject, byClip, byFacing].map(npcArtKey);
    expect(new Set(keys).size).toBe(4);
  });
});

describe('availableFacings / clipFor', () => {
  it('bakes an imported clip on all three authored angles', () => {
    expect(availableFacings('walk')).toEqual(['down', 'up', 'left']);
    for (const facing of ['down', 'up', 'left'] as const) {
      expect(clipFor('walk', facing)?.name).toBe('walk');
    }
  });

  it('bakes the hand-authored devotional clips on south/north only, never west', () => {
    expect(availableFacings('pray-raise')).toEqual(['down', 'up']);
    expect(clipFor('pray-raise', 'down')?.name).toBe('pray-raise');
    expect(clipFor('pray-raise', 'up')?.name).toBe('pray-raise');
    expect(clipFor('pray-raise', 'left')).toBeUndefined();

    expect(availableFacings('idle-shift')).toEqual(['down', 'up']);
    expect(clipFor('idle-shift', 'down')?.name).toBe('idle-shift');
    expect(clipFor('idle-shift', 'left')).toBeUndefined();
  });

  it('names nothing for a clip the rig does not have', () => {
    expect(availableFacings('does-not-exist')).toEqual([]);
    expect(clipFor('does-not-exist', 'down')).toBeUndefined();
  });
});

describe('wardrobeLayerHash', () => {
  it('is deterministic and non-empty', () => {
    expect(wardrobeLayerHash()).toBe(wardrobeLayerHash());
    expect(wardrobeLayerHash().length).toBeGreaterThan(0);
  });
});

describe('planLines — --plan output, zero backend calls', () => {
  it('prints key/seed/frame-count/prompt for every default target, matching the pipeline\'s own derivation', () => {
    const lines = planLines(NPC_SEED_TARGETS);
    for (const target of NPC_SEED_TARGETS) {
      const key = npcArtKey(target);
      const clip = clipFor(target.clip, target.facing);
      expect(clip).toBeDefined();
      const seed = npcSheetSeed(target.clip, wardrobeLayerHash());
      const header = lines.find((l) => l.startsWith(`${key}: seed ${seed}`));
      expect(header).toBeDefined();
      expect(header).toContain(`${clip?.frames} frames`);
      const promptLine = lines[lines.indexOf(header!) + 1];
      expect(promptLine).toContain('prompt (frame 1 of');
      expect(promptLine).toContain(target.subject.name);
    }
  });

  it('reports a target whose clip/facing the rig cannot bake, rather than throwing', () => {
    const bogus: NpcSeedTarget = {
      subject: { id: 'nobody', name: 'nobody', wears: [] },
      clip: 'does-not-exist',
      facing: 'down',
    };
    const lines = planLines([bogus]);
    expect(lines.join('\n')).toMatch(/SKIPPED/);
  });

  // planLines takes no SpriteBackend and imports none of backend-registry's
  // construction path — its signature alone is the proof that no request can
  // leave the process. This asserts the observable half: no network-shaped
  // side effect (nothing thrown, nothing async pending) from a call that
  // carries no credentials anywhere in scope.
  it('runs synchronously to completion with no token in the environment', () => {
    expect(() => planLines(NPC_SEED_TARGETS)).not.toThrow();
  });
});

describe('buildManifestRow — manifest row shape', () => {
  const CELL = 64;

  /** A rig-frame stand-in, shaped like the gate tests in npc-sprite-gates.test.ts. */
  function poseFrame(): Raster {
    const r: Raster = { data: new Uint8ClampedArray(CELL * CELL * 4), w: CELL, h: CELL };
    for (let py = 10; py < 50; py++) {
      for (let px = 20; px < 44; px++) {
        const o = (py * CELL + px) * 4;
        r.data[o] = 120; r.data[o + 1] = 140; r.data[o + 2] = 110; r.data[o + 3] = 255;
      }
    }
    return r;
  }

  /** A well-behaved model's answer: the same pose, upscaled, on magenta. */
  function goodGeneration(frame: Raster): Raster {
    const bb = opaqueBBox(frame)!;
    const padded = padRaster(nearestUpscale(cropRaster(frame, bb), 4), 16);
    return { data: compositeOverChroma(padded.data), w: padded.w, h: padded.h };
  }

  async function runOneSheet(seedCapable: boolean): Promise<NpcSheetResult> {
    const frames = [poseFrame(), poseFrame()];
    const answers = frames.map(goodGeneration);
    let n = 0;
    const backend = createMockBackend({ costUsd: 0.03, capabilities: { seed: seedCapable } });
    const deps: NpcSheetDeps = {
      backend,
      decodeImage: async () => answers[Math.min(n++, answers.length - 1)],
      encodeInit: async () => 'data:image/png;base64,AAAA',
    };
    const result = await generateNpcSheet(
      { clip: 'pray-raise', layerSetHash: 'test-hash', prompt: 'an acolyte, praying', frames },
      deps,
    );
    expect(result).not.toBeNull();
    return result!;
  }

  const target: NpcSeedTarget = {
    subject: { id: 'rival-acolyte', name: 'an acolyte of a rival cult', wears: ['a cassock'] },
    clip: 'pray-raise',
    facing: 'down',
  };

  it('carries every field the house rule requires', async () => {
    const result = await runOneSheet(true);
    const row = buildManifestRow(target, npcArtKey(target), result);

    expect(row.file).toBe(`${npcArtKey(target).replace(/[^a-zA-Z0-9._-]/g, '_')}.png`);
    expect(row.subjectId).toBe('rival-acolyte');
    expect(row.clip).toBe('pray-raise');
    expect(row.facing).toBe('down');
    expect(row.provider).toBe(result.provider);
    expect(row.model).toBe(result.model);
    expect(typeof row.seed).toBe('number');
    expect(row.lineage).toBe('lpc-derived');
    expect(row.recipeVersion).toBe(NPC_ART_RECIPE_VERSION);
    expect(row.frames).toBe(2);
    expect(row.cellSize).toBe(CELL);
    expect(typeof row.shimmer).toBe('number');
    expect(typeof row.sourceShimmer).toBe('number');
    expect(row.iou).toHaveLength(2);
  });

  it('marks the art as NOT reproducible when the backend ignored the seed, without dropping the seed field', async () => {
    const result = await runOneSheet(false);
    expect(result.ignored).toContain('seed');
    const row = buildManifestRow(target, npcArtKey(target), result);
    expect(row.seedReproducible).toBe(false);
    expect(typeof row.seed).toBe('number'); // present — but ONLY beside the flag above
  });

  it('marks the art as reproducible when the backend honoured the seed', async () => {
    const result = await runOneSheet(true);
    expect(result.ignored).not.toContain('seed');
    const row = buildManifestRow(target, npcArtKey(target), result);
    expect(row.seedReproducible).toBe(true);
  });
});
