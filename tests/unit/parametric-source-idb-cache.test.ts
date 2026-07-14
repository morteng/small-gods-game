// The three parametric sources × the persistent sprite cache:
// miss → compose once + write-behind persist; a FRESH source (new session) with
// the same content → IDB hit, ZERO compose jobs; keepStages (studio) bypasses
// the cache entirely so stage capture always sees fresh composes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import { ParametricBarrierSource } from '@/render/parametric-barrier-source';
import { ParametricPlantSource } from '@/render/parametric-plant-source';
import { blueprintEntity } from '@/blueprint/entity';
import { synthesizeBlueprint, plantPresetNames } from '@/blueprint/presets';
import { canonicalJson } from '@/render/generated-art-cache';
import {
  parametricSpriteKey, readParametricSprite, spriteCacheStats, _resetParametricSpriteDbForTesting,
} from '@/render/parametric-sprite-cache';
import type { StructureResult, StructureSpec } from '@/assetgen/compose';
import type { Entity } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';
import type { SpritePack } from '@/render/iso/sprite-canvas';

const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - t0 > ms) throw new Error('until(): timed out');
    await flush(5);
  }
}

/** A compose result with REAL buffers so payloadFromResult can capture it. */
function realResult(): StructureResult {
  const size = 4, px = size * size * 4;
  const bbox = { x: 1, y: 1, w: 2, h: 2 };
  const buf = (seed: number): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(px);
    let h = seed | 0;
    for (let i = 0; i < px; i++) { h = (h * 1103515245 + 12345) | 0; out[i] = (h >>> 16) & 0xff; }
    return out;
  };
  return {
    grey: buf(1), normal: buf(2), material: buf(3), emissive: new Uint8ClampedArray(px),
    size, bbox,
    anchors: { doors: [], vents: [], wallEnds: [{ x: 0.25, y: 1 }], tags: [{ x: 0.5, y: 0.5, kind: 'sign' as never, z: 1 }] },
    meta: { bbox, anchors: { doors: [], vents: [] } },
  };
}

const spec: StructureSpec = { parts: [] };
const fakeSprite: SpritePack = { albedo: { width: 10, height: 8 } as unknown as HTMLCanvasElement };
const cachedSprite: SpritePack = { albedo: { width: 10, height: 8 } as unknown as HTMLCanvasElement };
const entity = (): Entity => blueprintEntity('b1', synthesizeBlueprint('cottage')!, 0, 0);

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  _resetParametricSpriteDbForTesting();
});
afterEach(() => {
  _resetParametricSpriteDbForTesting();
  vi.unstubAllGlobals();
});

describe('ParametricBuildingSource × sprite cache', () => {
  const idbKey = parametricSpriteKey('bld', canonicalJson(spec));

  it('cold: composes once and persists write-behind; warm (fresh source): IDB hit, NO compose', async () => {
    const compose1 = vi.fn(async () => realResult());
    const src1 = new ParametricBuildingSource({ toSpec: () => spec, compose: compose1, toSprite: () => fakeSprite });
    src1.warm(entity());
    await until(() => src1.peek(entity()) === fakeSprite);
    expect(compose1).toHaveBeenCalledTimes(1);
    await until(async () => (await readParametricSprite(idbKey)) !== null); // write-behind landed

    // "New session": fresh source, same content. jsdom has no canvas, so the
    // pack rebuild is injected — the assertion is that NO compose is scheduled.
    const compose2 = vi.fn(async () => realResult());
    const onWarm = vi.fn();
    const src2 = new ParametricBuildingSource({
      toSpec: () => spec, compose: compose2, toSprite: () => fakeSprite,
      packFromCache: () => cachedSprite, onWarm,
    });
    const v0 = src2.version();
    src2.warm(entity());
    await until(() => src2.peek(entity()) === cachedSprite);
    expect(compose2).not.toHaveBeenCalled();
    expect(src2.version()).toBe(v0 + 1);       // rev bump → static draw cache rebuilds
    expect(onWarm).toHaveBeenCalledTimes(1);   // render kick so an idle loop draws it
  });

  it('a cache hit whose pack rebuild fails (no canvas) degrades to composing', async () => {
    const compose1 = vi.fn(async () => realResult());
    const src1 = new ParametricBuildingSource({ toSpec: () => spec, compose: compose1, toSprite: () => fakeSprite });
    src1.warm(entity());
    await until(async () => (await readParametricSprite(idbKey)) !== null);

    const compose2 = vi.fn(async () => realResult());
    // Default packFromCache: jsdom has no canvas → null → must fall back to compose.
    const src2 = new ParametricBuildingSource({ toSpec: () => spec, compose: compose2, toSprite: () => fakeSprite });
    src2.warm(entity());
    await until(() => src2.peek(entity()) === fakeSprite);
    expect(compose2).toHaveBeenCalledTimes(1);
    // Let src2's own write-behind land before the test ends, so it can't leak
    // into the next test's freshly-stubbed IDBFactory.
    await until(() => spriteCacheStats.writes >= 2);
  });

  it('keepStages (studio) bypasses the cache: composes every time, persists nothing', async () => {
    const compose1 = vi.fn(async () => realResult());
    const src1 = new ParametricBuildingSource({ toSpec: () => spec, compose: compose1, toSprite: () => fakeSprite, keepStages: true });
    src1.warm(entity());
    await until(() => src1.peek(entity()) === fakeSprite);
    expect(compose1).toHaveBeenCalledTimes(1);
    expect(src1.stagesFor(entity())).not.toBeNull();  // stage capture intact
    await flush(20);
    expect(await readParametricSprite(idbKey)).toBeNull(); // nothing persisted

    const compose2 = vi.fn(async () => realResult());
    const src2 = new ParametricBuildingSource({ toSpec: () => spec, compose: compose2, toSprite: () => fakeSprite, keepStages: true, packFromCache: () => cachedSprite });
    src2.warm(entity());
    await until(() => src2.peek(entity()) === fakeSprite);
    expect(compose2).toHaveBeenCalledTimes(1); // fresh compose, not the cache
  });
});

describe('ParametricBarrierSource × sprite cache', () => {
  // The barrier MISS path builds its pack through the real structureResultToPack
  // (no toSprite seam), which needs a working canvas — stub a minimal one.
  beforeEach(() => {
    class FakeOffscreen {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext(): unknown {
        return { putImageData: () => {}, drawImage: () => {}, imageSmoothingEnabled: false };
      }
    }
    class FakeImageData {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
    vi.stubGlobal('ImageData', FakeImageData);
  });

  const run: BarrierRun = {
    kind: 'fence', path: [[0, 0], [2, 0]], height: 1, thickness: 0.2,
    material: 'timber', gates: [],
  } as unknown as BarrierRun;
  const barrierEntity = (): Entity => ({
    id: 'w1', kind: 'barrier', x: 0, y: 0, tags: [], properties: { barrier: run },
  });

  it('cold: composes each element + persists; warm (fresh source): hits rebuild pack AND anchor, NO compose', async () => {
    const compose1 = vi.fn(async () => realResult());
    const src1 = new ParametricBarrierSource({ compose: compose1 });
    src1.warm(barrierEntity());
    await until(() => src1.peek(barrierEntity()) !== null);
    const composed = compose1.mock.calls.length;
    expect(composed).toBeGreaterThan(0);
    // peek() settles before the write-behind persists — wait for every element's write.
    await until(() => spriteCacheStats.writes >= composed);

    const compose2 = vi.fn(async () => realResult());
    const src2 = new ParametricBarrierSource({ compose: compose2, packFromCache: () => cachedSprite });
    src2.warm(barrierEntity());
    await until(() => src2.peek(barrierEntity()) !== null);
    expect(compose2).not.toHaveBeenCalled();
    const pieces = src2.peek(barrierEntity())!;
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces[0].pack).toBe(cachedSprite);
    // Placement anchor came from the PERSISTED anchors (wallEnds[0] of realResult).
    expect(pieces[0].anchorNX).toBe(0.25);
    expect(pieces[0].anchorNY).toBe(1);
  });
});

describe('ParametricPlantSource × sprite cache', () => {
  const kind = plantPresetNames()[0];

  it('cold: composes + persists; warm (fresh source): IDB hit, NO compose; prewarm promise still settles', async () => {
    // Inject a FIXED spec so all variants share one content-addressed key — exercise a
    // single variant (variant 0) to keep the cold→persist→warm-hit assertions clean.
    const compose1 = vi.fn(async () => realResult());
    const src1 = new ParametricPlantSource({ toSpec: () => spec, compose: compose1, toSprite: () => fakeSprite });
    await src1.warmVariant(kind, 0);
    expect(src1.peek(kind)).toBe(fakeSprite);
    expect(compose1).toHaveBeenCalledTimes(1);
    const idbKey = parametricSpriteKey('plt', canonicalJson(spec));
    await until(async () => (await readParametricSprite(idbKey)) !== null);

    const compose2 = vi.fn(async () => realResult());
    const src2 = new ParametricPlantSource({ toSpec: () => spec, compose: compose2, toSprite: () => fakeSprite, packFromCache: () => cachedSprite });
    await src2.warmVariant(kind, 0); // must resolve only once the pack is cached (prewarmAll contract)
    expect(src2.peek(kind)).toBe(cachedSprite);
    expect(compose2).not.toHaveBeenCalled();
  });
});
