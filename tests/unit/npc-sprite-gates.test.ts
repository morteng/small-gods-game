/**
 * G0 gates. The point of these is not that the pipeline runs — it is that the
 * pipeline REFUSES, and refuses in the right order relative to spending. A gate
 * that rejects bad art after paying for it twice is a different (worse) product
 * than one that never sends the request.
 */
import { describe, it, expect } from 'vitest';
import {
  NPC_ART_RECIPE_VERSION,
} from '@/core/content-version';
import { compositeOverChroma } from '@/render/chroma-key';
import { type Raster, cropRaster, opaqueBBox } from '@/render/sprite-postprocess';
import { createMockBackend } from '@/assetgen/compilers/mock-backend';
import {
  NPC_MAX_FRAME_ATTEMPTS,
  NPC_QUANT_COLORS,
  assembleStrip,
  chromaCollisionFraction,
  generateNpcSheet,
  meanFrameDistance,
  nearestUpscale,
  npcSheetSeed,
  padRaster,
  pasteInto,
  prepareFrame,
  sheetShimmer,
  sliceStrip,
  upscaleFactorFor,
  type NpcSheetDeps,
} from '@/assetgen/npc-sprite-pipeline';

const CELL = 64;

/** A rig-frame stand-in: a vertical-gradient body rect on a transparent cell. */
function poseFrame(rgb: [number, number, number] = [120, 140, 110], x = 20, y = 10, w = 24, h = 40): Raster {
  const r: Raster = { data: new Uint8ClampedArray(CELL * CELL * 4), w: CELL, h: CELL };
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const o = (py * CELL + px) * 4;
      const shade = (py - y) / h;                    // gradient ⇒ the quantizer has work to do
      r.data[o] = Math.round(rgb[0] * (0.6 + 0.4 * shade));
      r.data[o + 1] = Math.round(rgb[1] * (0.6 + 0.4 * shade));
      r.data[o + 2] = Math.round(rgb[2] * (0.6 + 0.4 * shade));
      r.data[o + 3] = 255;
    }
  }
  return r;
}

/** A triangle of the same bbox — same footprint, wrong body. Drives IoU below
 *  the gate without changing the crop geometry. */
function driftedFrame(): Raster {
  const r: Raster = { data: new Uint8ClampedArray(CELL * CELL * 4), w: CELL, h: CELL };
  for (let py = 10; py < 50; py++) {
    const half = Math.round(((py - 10) / 40) * 12);
    for (let px = 32 - half; px <= 32 + half; px++) {
      const o = (py * CELL + px) * 4;
      r.data[o] = 130; r.data[o + 1] = 120; r.data[o + 2] = 100; r.data[o + 3] = 255;
    }
  }
  return r;
}

/** What a well-behaved model would send back: the pose, upscaled, on the
 *  magenta backdrop it was shown. */
function goodGeneration(frame: Raster): Raster {
  const bb = opaqueBBox(frame)!;
  const padded = padRaster(nearestUpscale(cropRaster(frame, bb), 4), 16);
  return { data: compositeOverChroma(padded.data), w: padded.w, h: padded.h };
}

/** A model that ignored the backdrop instruction and painted a scene. */
function opaqueBackgroundGeneration(frame: Raster): Raster {
  const g = goodGeneration(frame);
  for (let i = 0; i < g.w * g.h; i++) {
    const o = i * 4;
    if (g.data[o] > 200 && g.data[o + 1] < 60) { g.data[o] = 40; g.data[o + 1] = 90; g.data[o + 2] = 40; }
  }
  return g;
}

/** Wire a backend whose decoded answers come from a queue, so a test states
 *  exactly what the model "returned" per call. */
function depsReturning(answers: Raster[], caps?: Parameters<typeof createMockBackend>[0]) {
  const backend = createMockBackend({ ...caps, costUsd: 0.01 });
  let n = 0;
  const notes: string[] = [];
  const deps: NpcSheetDeps = {
    backend,
    decodeImage: async () => answers[Math.min(n++, answers.length - 1)],
    encodeInit: async () => 'data:image/png;base64,AAAA',
    onNote: (m) => notes.push(m),
  };
  return { backend, deps, notes };
}

describe('npc-sprite pipeline — pure geometry', () => {
  it('upscales by integer nearest neighbour, introducing no new colours', () => {
    const src = poseFrame();
    const up = nearestUpscale(src, 3);
    expect([up.w, up.h]).toEqual([CELL * 3, CELL * 3]);
    const colours = new Set<number>();
    for (let i = 0; i < up.w * up.h; i++) {
      const o = i * 4;
      if (up.data[o + 3] > 0) colours.add((up.data[o] << 16) | (up.data[o + 1] << 8) | up.data[o + 2]);
    }
    const srcColours = new Set<number>();
    for (let i = 0; i < src.w * src.h; i++) {
      const o = i * 4;
      if (src.data[o + 3] > 0) srcColours.add((src.data[o] << 16) | (src.data[o + 1] << 8) | src.data[o + 2]);
    }
    expect([...colours].every((c) => srcColours.has(c))).toBe(true);
  });

  it('never downscales a subject that is already larger than the target', () => {
    expect(upscaleFactorFor(40, 40, 512)).toBe(12);
    expect(upscaleFactorFor(600, 900, 512)).toBe(1);
  });

  it('round-trips crop → paste and assemble → slice', () => {
    const f = poseFrame();
    const bb = opaqueBBox(f)!;
    const back = pasteInto(cropRaster(f, bb), CELL, CELL, bb.x, bb.y);
    expect(back.data).toEqual(f.data);

    const frames = [poseFrame(), poseFrame([90, 90, 160])];
    const sliced = sliceStrip(assembleStrip(frames), 2);
    expect(sliced[0].data).toEqual(frames[0].data);
    expect(sliced[1].data).toEqual(frames[1].data);
  });

  it('refuses a ragged sheet rather than cropping it silently', () => {
    expect(() => assembleStrip([poseFrame(), { data: new Uint8ClampedArray(16), w: 2, h: 2 }]))
      .toThrow(/differ in size/);
  });

  it('derives one seed per sheet, stable and recipe-versioned', () => {
    expect(npcSheetSeed('march', 'abc')).toBe(npcSheetSeed('march', 'abc'));
    expect(npcSheetSeed('march', 'abc')).not.toBe(npcSheetSeed('walk', 'abc'));
    expect(npcSheetSeed('march', 'abc')).not.toBe(npcSheetSeed('march', 'def'));
    expect(npcSheetSeed('march', 'abc', 'n1')).not.toBe(npcSheetSeed('march', 'abc', 'n2'));
  });

  it('measures shimmer only where both frames are opaque', () => {
    // A limb uncovering background must not read as colour change. Flat fill,
    // so the only difference between the two frames is coverage.
    const flat = (h: number): Raster => {
      const r: Raster = { data: new Uint8ClampedArray(CELL * CELL * 4), w: CELL, h: CELL };
      for (let py = 10; py < 10 + h; py++) for (let px = 20; px < 44; px++) {
        const o = (py * CELL + px) * 4;
        r.data[o] = 120; r.data[o + 1] = 140; r.data[o + 2] = 110; r.data[o + 3] = 255;
      }
      return r;
    };
    expect(meanFrameDistance(flat(40), flat(30))).toBeCloseTo(0, 6);
    const a = poseFrame();
    expect(sheetShimmer([a])).toBe(0);
    expect(sheetShimmer([a, poseFrame([220, 60, 60])])).toBeGreaterThan(0.05);
  });
});

describe('npc-sprite pipeline — refusals that happen BEFORE any spend', () => {
  it('refuses a pose wearing the chroma key colour, and never calls the backend', async () => {
    const violet = poseFrame([190, 40, 200]);
    expect(chromaCollisionFraction(cropRaster(violet, opaqueBBox(violet)!))).toBeGreaterThan(0.9);

    const prep = prepareFrame(violet);
    expect(typeof prep).toBe('string');
    expect(prep).toMatch(/chroma key colour/);

    const { backend, deps, notes } = depsReturning([goodGeneration(violet)]);
    const out = await generateNpcSheet(
      { clip: 'march', layerSetHash: 'h', prompt: 'a soldier', frames: [violet] }, deps,
    );
    expect(out).toBeNull();
    expect(backend.calls).toHaveLength(0);          // the whole point: no request, no bill
    expect(notes.join('\n')).toMatch(/chroma key colour/);
  });

  it('tolerates a few colliding pixels, because registration repairs those', () => {
    // One stray violet pixel out of ~960: the keyer punches a 1px hole, and
    // registerAlbedo fills it straight back from the mask.
    const f = poseFrame();
    const o = (20 * CELL + 25) * 4;
    f.data[o] = 190; f.data[o + 1] = 40; f.data[o + 2] = 200;
    expect(chromaCollisionFraction(cropRaster(f, opaqueBBox(f)!))).toBeGreaterThan(0);
    expect(typeof prepareFrame(f)).not.toBe('string');
  });

  it('refuses an empty frame', () => {
    expect(prepareFrame({ data: new Uint8ClampedArray(CELL * CELL * 4), w: CELL, h: CELL }))
      .toMatch(/empty/);
  });

  it('leaves a margin of backdrop around the subject, so the border gate can read one', () => {
    const prep = prepareFrame(poseFrame());
    expect(typeof prep).not.toBe('string');
    if (typeof prep === 'string') return;
    expect(prep.init.w).toBeGreaterThan(prep.mask.w * prep.factor);
    expect(prep.init.h).toBeGreaterThan(prep.mask.h * prep.factor);
  });
});

describe('npc-sprite pipeline — gates on what came back', () => {
  const job = (frames: Raster[]) => ({ clip: 'march', layerSetHash: 'h', prompt: 'a soldier', frames });

  it('accepts a faithful repaint and returns one palette for the whole sheet', async () => {
    const frames = [poseFrame(), poseFrame([124, 138, 112])];
    const { deps, backend } = depsReturning(frames.map(goodGeneration));
    const out = await generateNpcSheet(job(frames), deps);

    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.frames).toHaveLength(2);
    expect(out.frames[0].w).toBe(CELL);
    expect(out.strip.w).toBe(CELL * 2);
    expect(out.lineage).toBe('lpc-derived');
    expect(out.recipeVersion).toBe(NPC_ART_RECIPE_VERSION);
    expect(out.attempts).toBe(2);
    expect(backend.calls).toHaveLength(2);
    expect(out.iou.every((v) => v >= 0.93)).toBe(true);
    expect(out.costUsd).toBeCloseTo(0.02, 6);

    const colours = new Set<number>();
    for (const f of out.frames) {
      for (let i = 0; i < f.w * f.h; i++) {
        const o = i * 4;
        if (f.data[o + 3] > 8) colours.add((f.data[o] << 16) | (f.data[o + 1] << 8) | f.data[o + 2]);
      }
    }
    expect(colours.size).toBeLessThanOrEqual(NPC_QUANT_COLORS);
  });

  it('rejects a drifted silhouette, re-rolls once, then abandons the sheet', async () => {
    const frames = [poseFrame()];
    const { deps, backend, notes } = depsReturning([goodGeneration(driftedFrame()), goodGeneration(driftedFrame())]);
    const out = await generateNpcSheet(job(frames), deps);

    expect(out).toBeNull();
    expect(backend.calls).toHaveLength(NPC_MAX_FRAME_ATTEMPTS);
    expect(notes.join('\n')).toMatch(/silhouette IoU/);
  });

  it('takes the re-roll when the second attempt is good', async () => {
    const frames = [poseFrame()];
    const { deps, backend } = depsReturning([goodGeneration(driftedFrame()), goodGeneration(frames[0])]);
    const out = await generateNpcSheet(job(frames), deps);

    expect(out).not.toBeNull();
    expect(backend.calls).toHaveLength(2);
    expect(out?.attempts).toBe(2);
  });

  it('rejects a generation that painted a background instead of keying one', async () => {
    const frames = [poseFrame()];
    const bad = opaqueBackgroundGeneration(frames[0]);
    const { deps, notes } = depsReturning([bad, bad]);
    expect(await generateNpcSheet(job(frames), deps)).toBeNull();
    expect(notes.join('\n')).toMatch(/did not key out/);
  });

  it('rejects a sheet that shimmers more than the animation moves', async () => {
    // Two identical source frames — the animation asked for NO change at all.
    const frames = [poseFrame(), poseFrame()];
    const { deps, notes } = depsReturning([goodGeneration(frames[0]), goodGeneration(poseFrame([210, 70, 70]))]);
    const out = await generateNpcSheet(job(frames), deps);

    expect(out).toBeNull();
    expect(notes.join('\n')).toMatch(/frames disagree more than the animation does/);
    // The measurement is reported whether it passes or fails — that number is
    // what the untuned constant is waiting for.
    expect(notes.join('\n')).toMatch(/shimmer \d/);
  });

  it('records that a seed-blind backend generated unseeded art, rather than implying reproducibility', async () => {
    const frames = [poseFrame()];
    const { deps, notes } = depsReturning(
      [goodGeneration(frames[0])],
      { capabilities: { seed: false } },
    );
    const out = await generateNpcSheet(job(frames), deps);
    expect(out?.ignored).toContain('seed');
    expect(notes.join('\n')).toMatch(/not reproducible/);
  });

  it('abandons the whole sheet when one frame fails — a cycle with a hole is not a degraded cycle', async () => {
    const frames = [poseFrame(), poseFrame(), poseFrame()];
    const { deps } = depsReturning([
      goodGeneration(frames[0]),
      goodGeneration(driftedFrame()), goodGeneration(driftedFrame()),
    ]);
    expect(await generateNpcSheet(job(frames), deps)).toBeNull();
  });
});
