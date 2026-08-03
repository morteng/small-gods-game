// @vitest-environment node
/**
 * The imported clips as BAKED PIXELS, not as pose data.
 *
 * `motion-import-determinism.test.ts` pins the other end of this pipe: that
 * re-running the importer reproduces the checked-in `Clip` modules byte for
 * byte. That says the numbers are stable. It says nothing about what those
 * numbers do once `bakeClip` turns them into frames, and everything downstream
 * — the studio bench, the runtime rig rows — consumes the frames.
 *
 * So this suite bakes every landed clip on every authored facing and hashes the
 * result. A hash moving means the rendered motion changed: a keyframe, a chip
 * rect, a pivot, the sampler, the rasteriser. Any of those is a real change
 * worth reading a diff over, and none of them are visible in the clip modules.
 *
 * The layers are synthetic on purpose. Baking against the vendored LPC sheets
 * would need a DOM and a fetch, and would fold "did the art change" into "did
 * the motion change" — two failures with one hash between them. A coordinate
 * ramp instead makes every chip's transform legible in the output bytes: the
 * pixel at (x,y) carries x and y, so a chip that rotates by a degree writes
 * different values, and a chip that does not move cannot hide behind flat fill.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { bakeClip, type AnimTemplate, type Clip, type PoseLayer } from '@/render/paperdoll/rig';
import { fragmentation } from '@/render/paperdoll/clip-measure';
import {
  CLIP_IDLE_SHIFT,
  CLIP_PRAY_RAISE,
  DEFAULT_HUMANOID_LAYERS,
  HUMANOID_SOURCE,
  LPC_HUMANOID_SOUTH,
} from '@/render/paperdoll/lpc-humanoid';
import { HUMANOID_SOURCE_NORTH, LPC_HUMANOID_NORTH } from '@/render/paperdoll/lpc-humanoid-north';
import { HUMANOID_WEST_SOURCE, LPC_HUMANOID_WEST } from '@/render/paperdoll/lpc-humanoid-west';
import { IMPORTED_CLIPS, IMPORTED_CLIP_META } from '@/render/paperdoll/clips';
import type { Raster } from '@/render/sprite-postprocess';

const FACINGS = ['down', 'up', 'left'] as const;
type Facing = (typeof FACINGS)[number];

const TEMPLATES: Record<Facing, AnimTemplate> = {
  down: LPC_HUMANOID_SOUTH,
  up: LPC_HUMANOID_NORTH,
  left: LPC_HUMANOID_WEST,
};

function djb2hex(buf: Uint8ClampedArray): string {
  let h = 5381;
  for (let i = 0; i < buf.length; i++) h = ((h << 5) + h + buf[i]) | 0;
  return (h >>> 0).toString(16);
}

/** A cell whose every pixel states its own coordinate — see the header. */
function coordinateRamp(cell: number): Raster {
  const data = new Uint8ClampedArray(cell * cell * 4);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      data.set([(x * 4) & 255, (y * 4) & 255, 128, 255], (y * cell + x) * 4);
    }
  }
  return { data, w: cell, h: cell };
}

const layersFor = (t: AnimTemplate): PoseLayer[] => [{ raster: coordinateRamp(t.cell) }];

/** One hash over every frame of a bake, so a change anywhere in the clip shows. */
function bakeHash(t: AnimTemplate, clip: Clip): string {
  const frames = bakeClip(t, layersFor(t), clip);
  const joined = new Uint8ClampedArray(frames.reduce((n, f) => n + f.data.length, 0));
  let at = 0;
  for (const f of frames) {
    joined.set(f.data, at);
    at += f.data.length;
  }
  return djb2hex(joined);
}

const CLIP_IDS = Object.keys(IMPORTED_CLIPS).sort();
const cases = CLIP_IDS.flatMap((id) => FACINGS.map((facing) => ({ id, facing })));

/**
 * UPDATE DELIBERATELY. A moved hash is not noise — re-run the studio bench
 * (`?studio=motion`) and look at the clip before pasting a new value here.
 */
const GOLDEN: Record<string, string> = {
  // down/up MOVED under M5a: the frontal forearm bones (`armL_fore`/`armR_fore`)
  // became `mode: 'translate'` in `HUMANOID_BVH_MAP` (see `bvh.ts`), so their
  // rotation now cancels the parent instead of carrying the elbow bend — a
  // projection change, not a capture change. `left` is untouched.
  'walk/down': 'REGEN',
  'walk/up': 'REGEN',
  'walk/left': '1a75c1d5',
  'walk-brisk/down': 'REGEN',
  'walk-brisk/up': 'REGEN',
  'walk-brisk/left': '2a106379',
  // wave/down and wave/up carry BOTH M5a (translate forearms) and M5b
  // (`Clip.skinBand: 1` on CLIP_WAVE_DOWN/_UP, closing the arm tear at the
  // wave's 150°+ swing) — see `clips/wave.ts`.
  'wave/down': 'REGEN',
  'wave/up': 'REGEN',
  'wave/left': '687e7abb',
  'march/down': 'REGEN',
  'march/up': 'REGEN',
  'march/left': '5c2b00c1',
  'dig/down': '12a79a43',
  'dig/up': 'e4ed8cd5',
  'dig/left': '6831d2f8',
};

describe('imported clips — the bake, not just the keyframes', () => {
  it.each(cases)('$id/$facing bakes to its pinned bytes', ({ id, facing }) => {
    const hash = bakeHash(TEMPLATES[facing], IMPORTED_CLIPS[id][facing]);
    expect(`${id}/${facing} = ${hash}`).toBe(`${id}/${facing} = ${GOLDEN[`${id}/${facing}`]}`);
  });

  it.each(cases)('$id/$facing bakes the same twice', ({ id, facing }) => {
    // Determinism of the BAKE, separate from the pin above: a hash that matched
    // the file but wandered between runs would be a cache or an iteration order,
    // and the pin alone cannot tell those apart from a correct one.
    const t = TEMPLATES[facing];
    expect(bakeHash(t, IMPORTED_CLIPS[id][facing])).toBe(bakeHash(t, IMPORTED_CLIPS[id][facing]));
  });

  it.each(cases)('$id/$facing puts pixels in every frame', ({ id, facing }) => {
    // A clip whose chips all rotate off the cell bakes to transparent frames and
    // still hashes stably. Cheap to assert, and the failure it catches is total.
    const t = TEMPLATES[facing];
    for (const f of bakeClip(t, layersFor(t), IMPORTED_CLIPS[id][facing])) {
      let opaque = 0;
      for (let i = 3; i < f.data.length; i += 4) if (f.data[i] > 0) opaque++;
      expect(opaque).toBeGreaterThan(200);
    }
  });

  it.each(cases)('$id/$facing bakes exactly the frames it declares', ({ id, facing }) => {
    const clip = IMPORTED_CLIPS[id][facing];
    expect(clip.frames).toBeGreaterThan(0);
    expect(bakeClip(TEMPLATES[facing], layersFor(TEMPLATES[facing]), clip)).toHaveLength(clip.frames);
  });
});

describe('imported clips — a looping clip must not pop at the wrap', () => {
  it.each(CLIP_IDS.map((id) => ({ id })))('$id: first and last frame agree iff it loops', ({ id }) => {
    // The meta claims loop closure from POSE equality. This checks the claim
    // where a player would actually notice it — in the pixels. A one-shot is
    // required to differ, so that "loops" never becomes a label nothing tests.
    const looping = IMPORTED_CLIP_META[id].loop;
    const agree = FACINGS.map((facing) => {
      const t = TEMPLATES[facing];
      const frames = bakeClip(t, layersFor(t), IMPORTED_CLIPS[id][facing]);
      return djb2hex(frames[0].data) === djb2hex(frames[frames.length - 1].data);
    });
    if (looping) {
      // loop:true is a promise EVERY facing closes — one facing popping at the
      // wrap while the meta claims otherwise is exactly the bug this exists to
      // catch, so nothing short of unanimous agreement passes.
      expect(agree).toEqual(FACINGS.map(() => true));
    } else {
      // `IMPORTED_CLIP_META[id].loop` is the importer's own `FACINGS.every(...)`
      // (`runImport`'s `metrics.loops`), so it reads false the moment ONE facing
      // fails to close — not because none of them do. `dig` is exactly that:
      // `down`/`up` close at 0° gap but `left` measures 11.5° on `armFar_up`, a
      // real capture asymmetry (see the importer's capture table), so the
      // honest assertion is "at least one facing disagrees", not "all of them".
      expect(agree.some((a) => !a)).toBe(true);
    }
  });
});

/**
 * The tearing guard, against the REAL wardrobe.
 *
 * Everything above bakes a coordinate ramp: a full-cell opaque source, chosen so
 * a transform is legible in the bytes. That is exactly the wrong source for this
 * question — with no transparency anywhere, no chip can ever come apart, and
 * `fragmentation` would read zero forever.
 *
 * So this block loads the vendored LPC cells the way `motion-contact-sheet.ts`
 * does. What it pins is the failure that shipped undetected through M1 and M2:
 * the profile leg chips were rected tight to the limb, and a 61° swing carried
 * pixels out of the sampling window until shins detached and feet floated. Every
 * numeric gate in the suite stayed green — the angles were right, the loop
 * closed, the decimation was inside tolerance, the bytes were reproducible — and
 * silhouette IoU scored 0.78 because the damage is INSIDE the outline.
 */
describe('imported clips — the profile leg must not come apart', () => {
  const CELL = LPC_HUMANOID_WEST.cell;

  const cellAt = (sheet: Raster, col: number, row: number): Raster => {
    const data = new Uint8ClampedArray(CELL * CELL * 4);
    for (let y = 0; y < CELL; y++) {
      const si = ((row * CELL + y) * sheet.w + col * CELL) * 4;
      data.set(sheet.data.subarray(si, si + CELL * 4), y * CELL * 4);
    }
    return { data, w: CELL, h: CELL };
  };

  const westLayers = (): PoseLayer[] =>
    DEFAULT_HUMANOID_LAYERS.map((spec) => {
      const png = PNG.sync.read(readFileSync(`public/${spec.path}`));
      const sheet: Raster = { data: new Uint8ClampedArray(png.data), w: png.width, h: png.height };
      return { raster: cellAt(sheet, HUMANOID_SOURCE.col, HUMANOID_WEST_SOURCE.row), assign: spec.assign };
    });

  /**
   * Budgets, not exact counts — summed over the whole clip, so the frame count
   * is part of the scale (the wave is 33 frames against the walks' 9).
   *
   * Landed (margin 1, band 3) vs the pre-M4 tight rects with no skinning:
   *
   *   walk        0 stray /  10 hole   was  37 / 119
   *   walk-brisk 20        /  20        was  24 /  91
   *   wave        0        /  71        was 132 /  76
   *
   * The wave is the honest asterisk: its strays vanish, but its holes barely
   * move, because they are not the leg — they are the gesture's own arm chips,
   * and this change was aimed at the leg. Its budget is set to catch a real
   * regression, not to imply the wave came out clean.
   *
   * When one fires, LOOK at the clip (`scripts/motion-contact-sheet.ts`, or the
   * studio's reference lane) before touching the number. A budget raised to
   * match a regression is worse than no budget at all.
   */
  const BUDGET: Record<string, { stray: number; hole: number }> = {
    walk: { stray: 5, hole: 25 },
    'walk-brisk': { stray: 30, hole: 35 },
    wave: { stray: 10, hole: 90 },
    // march: 0 stray / 90 hole over 17 frames — clean, comparable to the wave's
    // west budget at roughly the same frame count.
    march: { stray: 5, hole: 100 },
    // dig: 0 stray / 963 hole over 65 frames — no severed pieces (`parts` stays
    // 1 every frame), but the per-frame hole count is real and this clip is
    // 65 frames against the walks' 9-17, so the SUM is not comparable to theirs
    // without accounting for length. See `tmp/motion/dig-worst-9x.png`: the
    // gap this is measuring is a bent-over dig pose's hip/thigh crease, not a
    // torn limb — worth the human's own look, not smoothed into a bigger walk
    // budget.
    dig: { stray: 5, hole: 1000 },
  };

  it.each(CLIP_IDS.map((id) => ({ id })))('$id west stays in one piece', ({ id }) => {
    const frames = bakeClip(LPC_HUMANOID_WEST, westLayers(), IMPORTED_CLIPS[id].left);
    let stray = 0;
    let hole = 0;
    for (const f of frames) {
      const g = fragmentation(f);
      stray += g.strayPx;
      hole += g.holePx;
    }
    expect({ id, stray: stray <= BUDGET[id].stray, hole: hole <= BUDGET[id].hole }).toEqual({
      id,
      stray: true,
      hole: true,
    });
  });

  it('the margin and the band are both load-bearing', () => {
    // Removing either one alone is enough to bring the tearing back, so neither
    // can be quietly dropped as "the other one handles it".
    const layers = westLayers();
    const tight = {
      ...LPC_HUMANOID_WEST,
      chips: LPC_HUMANOID_WEST.chips.map((c) =>
        c.name.startsWith('leg')
          ? { ...c, rect: { ...c.rect, x: c.rect.x + 1, w: c.rect.w - 2 } }
          : c,
      ),
    };
    const strayOf = (t: typeof LPC_HUMANOID_WEST, opts = {}): number =>
      bakeClip(t, layers, IMPORTED_CLIPS.walk.left, opts).reduce(
        (n, f) => n + fragmentation(f).strayPx,
        0,
      );
    const landed = strayOf(LPC_HUMANOID_WEST);
    expect(strayOf(tight)).toBeGreaterThan(landed);
    expect(strayOf({ ...LPC_HUMANOID_WEST, skinBand: undefined })).toBeGreaterThan(landed);
  });
});

/**
 * M5b — the frontal arms must not come apart either.
 *
 * Same failure as the west leg, different limb: the imported `wave` clip
 * swings `armL_fore`/`armR_fore` past 150° on the south/north templates
 * (`lpc-humanoid.ts`, `lpc-humanoid-north.ts`), and the arm chips are rected
 * just as tight as the profile leg was. RAW bake, whole clip, before this fix:
 * south wave 1 stray / 235 hole px, north wave 0 / 132.
 *
 * UNLIKE the west leg, the fix here is NOT a template-level `skinBand`. A
 * first attempt put `skinBand: 6` on `LPC_HUMANOID_SOUTH`/`_NORTH` directly —
 * it closed the wave tear, but it also re-rendered `pray-raise`/`idle-shift`,
 * the two clips `rig-rows.ts` bakes onto every live NPC: 3.19% of pray-raise's
 * pixels moved (242 of them silhouette), and the runtime bake cost 1.4–1.7× at
 * the supersample `rig-rows.ts` actually uses. Wrong trade — a studio-only
 * clip should not cost shipped art or shipped bake time.
 *
 * The landed fix is `Clip.skinBand: 1` on `CLIP_WAVE_DOWN`/`_UP` alone
 * (`clips/wave.ts`), resolved in `bakeClipFrames` ahead of the template's own
 * band (see `Clip.skinBand`'s doc comment in `rig.ts`). The templates stay
 * RIGID — no template-level change at all — so this block's job is now split
 * in two: a budget on the ONE clip that changed, and a byte-identity pin on
 * the two that must not have.
 */
describe('imported clips — the frontal arms must not come apart', () => {
  const CELL = LPC_HUMANOID_SOUTH.cell;

  const cellAt = (sheet: Raster, col: number, row: number): Raster => {
    const data = new Uint8ClampedArray(CELL * CELL * 4);
    for (let y = 0; y < CELL; y++) {
      const si = ((row * CELL + y) * sheet.w + col * CELL) * 4;
      data.set(sheet.data.subarray(si, si + CELL * 4), y * CELL * 4);
    }
    return { data, w: CELL, h: CELL };
  };

  const frontalLayers = (row: number): PoseLayer[] =>
    DEFAULT_HUMANOID_LAYERS.map((spec) => {
      const png = PNG.sync.read(readFileSync(`public/${spec.path}`));
      const sheet: Raster = { data: new Uint8ClampedArray(png.data), w: png.width, h: png.height };
      return { raster: cellAt(sheet, HUMANOID_SOURCE.col, row), assign: spec.assign };
    });

  const southLayers = (): PoseLayer[] => frontalLayers(HUMANOID_SOURCE.row);
  const northLayers = (): PoseLayer[] => frontalLayers(HUMANOID_SOURCE_NORTH.row);

  const sumFrag = (frames: readonly Raster[]): { stray: number; hole: number } =>
    frames.reduce(
      (a, f) => {
        const g = fragmentation(f);
        return { stray: a.stray + g.strayPx, hole: a.hole + g.holePx };
      },
      { stray: 0, hole: 0 },
    );

  /**
   * Budgets, not exact counts — RAW bake, whole clip, `Clip.skinBand: 1` vs.
   * the pre-M5b rigid rects:
   *
   *   south  wave  1 stray / 127 hole   was  1 / 235
   *   north  wave  0        /  35        was  0 / 132
   *
   * 1 is the SMALLEST band that closes the literal (alpha=0) tears at the
   * shoulder/elbow — swept 1..10 against `scripts/motion-contact-sheet.ts`'s
   * `fragmentation` output and read at 9× (`tmp/motion/wave-*-band*.png`, not
   * committed): band 1 already erases both rest-pose arm holes this clip had
   * (south `armR_up`, north `armL_up`) without visibly thinning the sleeve.
   * Bands 2–3 buy only noise-level further reduction; bands ≥4 look better on
   * this COUNT but only by widening the gap between the legs until it merges
   * with the outer silhouette — reclassified, not filled, and the same failure
   * mode margin risked on the west leg. The residual hole here is real and it
   * is NOT the arm: it is a smaller, separate hip-adjacent tear (`legR_up`/
   * `legL_up`, small-angle rotation, same small-chip story as the west leg)
   * that this fix does not target and that raising the band cannot close
   * cleanly. `walk`/`walk-brisk` need no budget here — they carry no
   * `skinBand` and are pinned byte-identical by the golden hashes above.
   */
  const BUDGET: Record<'down' | 'up', { stray: number; hole: number }> = {
    down: { stray: 4, hole: 140 },
    up: { stray: 4, hole: 45 },
  };

  it.each(['down', 'up'] as const)('wave %s stays in one piece', (facing) => {
    const layers = facing === 'down' ? southLayers() : northLayers();
    const template = facing === 'down' ? LPC_HUMANOID_SOUTH : LPC_HUMANOID_NORTH;
    const { stray, hole } = sumFrag(bakeClip(template, layers, IMPORTED_CLIPS.wave[facing]));
    const budget = BUDGET[facing];
    expect({ facing, stray: stray <= budget.stray, hole: hole <= budget.hole }).toEqual({
      facing,
      stray: true,
      hole: true,
    });
  });

  /**
   * The hard gate, made structural rather than numeric: `pray-raise` and
   * `idle-shift` are what `rig-rows.ts` bakes onto every live NPC, and neither
   * clip carries a `skinBand` of its own, so their bake on `LPC_HUMANOID_SOUTH`/
   * `_NORTH` (both templates ALSO band-free) must be the exact bytes `main`
   * produces — not "close", not "no worse by some measure", identical. A hash
   * pin catches ANY future drift here, including a well-meaning `skinBand` on
   * the template or the clip that this file's other tests would not.
   */
  const SHIPPED_GOLDEN: Record<'down' | 'up', Record<'pray-raise' | 'idle-shift', string>> = {
    down: { 'pray-raise': '3c97ec1', 'idle-shift': '7fd524e3' },
    up: { 'pray-raise': '301b4d87', 'idle-shift': 'e9abc20c' },
  };

  it.each(
    (['down', 'up'] as const).flatMap((facing) =>
      (['pray-raise', 'idle-shift'] as const).map((id) => ({ id, facing })),
    ),
  )('shipped $id $facing bakes byte-identical to main', ({ id, facing }) => {
    expect(CLIP_PRAY_RAISE.skinBand).toBeUndefined();
    expect(CLIP_IDLE_SHIFT.skinBand).toBeUndefined();
    const layers = facing === 'down' ? southLayers() : northLayers();
    const template = facing === 'down' ? LPC_HUMANOID_SOUTH : LPC_HUMANOID_NORTH;
    const clip = id === 'pray-raise' ? CLIP_PRAY_RAISE : CLIP_IDLE_SHIFT;
    // North bakes strip stamps (see rig-rows.ts's RIG_FACING_BAKES) — the
    // south-donor palm/blink stamps would paste onto the wrong side of a
    // back-facing figure.
    const useClip = facing === 'up' ? { ...clip, stamps: undefined } : clip;
    const frames = bakeClip(template, layers, useClip);
    const joined = new Uint8ClampedArray(frames.reduce((n, f) => n + f.data.length, 0));
    let at = 0;
    for (const f of frames) {
      joined.set(f.data, at);
      at += f.data.length;
    }
    expect(`${id}/${facing} = ${djb2hex(joined)}`).toBe(`${id}/${facing} = ${SHIPPED_GOLDEN[facing][id]}`);
  });

  it('skinBand is load-bearing on the CLIP — dropping it reopens the wave tear', () => {
    const layers = southLayers();
    const holeOf = (clip: Clip): number => sumFrag(bakeClip(LPC_HUMANOID_SOUTH, layers, clip)).hole;
    expect(holeOf({ ...IMPORTED_CLIPS.wave.down, skinBand: undefined })).toBeGreaterThan(
      holeOf(IMPORTED_CLIPS.wave.down),
    );
  });

  it("the frontal templates carry no band of their own — the clip's is what fixes it", () => {
    expect(LPC_HUMANOID_SOUTH.skinBand).toBeUndefined();
    expect(LPC_HUMANOID_NORTH.skinBand).toBeUndefined();
    expect(IMPORTED_CLIPS.wave.down.skinBand).toBe(1);
    expect(IMPORTED_CLIPS.wave.up.skinBand).toBe(1);
  });
});
