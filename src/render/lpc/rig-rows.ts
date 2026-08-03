/**
 * Rig rows — the seam that puts the authored paper-doll clips on live NPCs.
 *
 * Until now the rig (`src/render/paperdoll/`) had NO runtime consumer: its seven
 * devotional clips were studio and bake-script artifacts while live NPCs played
 * the vendored LPC universal sheet's own baked rows. This module bakes a chosen
 * few of those clips PER LAYER from an NPC's own part sheets and lays them out
 * as extra rows in the same row space as the standard sheet, continuing below it
 * (`STANDARD_SHEET_ROWS`) — so a rig animation is addressed exactly like a
 * vendored one, by `rowBase + direction offset` and a column.
 *
 * PER LAYER is load-bearing. Re-posing the FLATTENED composite drags the baked
 * inter-layer shadow smear around with it (visible on the forearms); rotating
 * raw layers with clean alpha edges and painting chip-z-outer / layer-order-inner
 * is what `scripts/paperdoll-bake.ts` does offline, and it is what happens here.
 *
 * THREE THINGS THE CODE INSISTED ON, against the first sketch:
 *
 * 1. The strip is its OWN canvas, not extra rows drawn onto the composed sheet.
 *    `GpuScene.uploadTexture` memoizes textures in a `WeakMap` keyed by the
 *    canvas OBJECT, so pixels painted into a canvas that has already been
 *    uploaded never reach the GPU. A lazily-baked block therefore cannot live on
 *    the published sheet; it lives on a companion canvas whose identity appears
 *    only once it is complete. The ROW SPACE is still unified — strip row 0 IS
 *    sheet row `STANDARD_SHEET_ROWS` — so the animation table reads as one sheet.
 * 2. Which facings a row bakes is PER ROW, not a module-wide constant. The
 *    stationary clips (`pray-raise`, `idle-shift`) bake SOUTH and NORTH: west
 *    is a separate profile chip vocabulary (near/far limbs) and neither clip
 *    is authored against it — baking south's tracks on the west template
 *    would just produce a rest stand. `march` inverts this: it IS authored
 *    against west (a marching leg swings in the sagittal plane, which the
 *    profile view shows and the frontal view all but erases — ~24° projected
 *    onto the coronal plane against 61–68° in profile), so it bakes WEST and
 *    mirrors to EAST, leaving south/north to the vendored walk-row fallback.
 *    Whichever pair a row does not bake, the animation table routes to the
 *    fallback (`LpcAnimSpec.facings`).
 * 3. The strip is PING-PONGED. Both clips end somewhere other than they start,
 *    so laying the frames out forward-then-back closes the loop without a pop —
 *    a property of the strip, not an edit to the authored clip.
 */
import type { NpcAnimation } from '@/core/npc-animation';
import { LPC_ANIMATIONS, LPC_DIR_OFFSET, STANDARD_SHEET_ROWS } from '@/core/npc-animation';
import type { Direction } from '@/core/types';
import type { Raster } from '@/render/sprite-postprocess';
import { bakeClipFrames, type AnimTemplate, type Clip, type PoseLayer } from '@/render/paperdoll/rig';
import {
  CLIP_IDLE_SHIFT,
  CLIP_PRAY_RAISE,
  HUMANOID_SOURCE,
  LPC_HUMANOID_SOUTH,
} from '@/render/paperdoll/lpc-humanoid';
import { HUMANOID_SOURCE_NORTH, LPC_HUMANOID_NORTH } from '@/render/paperdoll/lpc-humanoid-north';
import { HUMANOID_WEST_SOURCE, LPC_HUMANOID_WEST, mirrorFrame } from '@/render/paperdoll/lpc-humanoid-west';
import { CLIP_MARCH_LEFT } from '@/render/paperdoll/clips/march';
import { sliceSourceCell } from '@/render/paperdoll/humanoid-loader';

/** Cell size of every rig row (the LPC frame size). */
export const RIG_CELL = LPC_HUMANOID_SOUTH.cell;

/**
 * Supersample factor for the RUNTIME bake — half the offline default of 4.
 * Measured (node, 5-layer default stack, warmed): pray-raise south 490 ms at
 * ss=4 vs 56 ms at ss=2, and the two bakes differ on 4.9% of pixels, none of
 * them legible at the 1:1 size NPCs actually render. The offline script keeps
 * ss=4; the live game will not spend half a second per wardrobe for it.
 */
export const RIG_BAKE_SUPERSAMPLE = 2;

/** An authored viewing angle a rig row can bake. East is never authored — a
 *  row that bakes `left` gets `right` for free by mirroring (see `RIG_MIRRORS`
 *  and `bakeRigStripRows`). */
type RigBakeDir = 'down' | 'up' | 'left';

/** The clips the live game bakes, paired with the animation row each one feeds
 *  and the facings THAT ROW bakes (the rest fall back — `LpcAnimSpec.facings`
 *  is this same list plus each baked `left`'s mirrored `right`). */
export const RIG_ROW_CLIPS: readonly {
  readonly anim: NpcAnimation;
  readonly clip: Clip;
  readonly facings: readonly RigBakeDir[];
}[] = [
  { anim: 'pray-raise', clip: CLIP_PRAY_RAISE, facings: ['down', 'up'] },
  { anim: 'idle-shift', clip: CLIP_IDLE_SHIFT, facings: ['down', 'up'] },
  { anim: 'march', clip: CLIP_MARCH_LEFT, facings: ['left'] },
];

/**
 * Facing → (template, source sheet row, whether stamps survive). One recipe
 * per AUTHORED angle; a row picks which of these it uses via its own
 * `facings` list above.
 */
const RIG_FACING_BAKES: Readonly<Record<RigBakeDir, {
  readonly template: AnimTemplate;
  readonly sheetRow: number;
  /**
   * North bakes carry NO stamps: south's are face pixel-clones (there is no
   * face from behind) or palms harvested from the spellcast sheet's SOUTH
   * row — wrong donor coordinates for a back-facing hand. See
   * `lpc-humanoid-north.ts`.
   *
   * West bakes ALSO carry no stamps, concluded rather than assumed: the one
   * clip baked against west (`march`) authors none (`clips/march.ts` sets no
   * `stamps` field), and even if a future west clip did, every donor sheet
   * `loadHumanoidCharacter` harvests is cropped from a SOUTH-row cell (the
   * spellcast palms, the face self-clones) — the same wrong-anatomy problem
   * north has, on a profile instead of a back view. There is no west-row
   * donor harvesting anywhere in this codebase to make a west stamp correct.
   */
  readonly stamps: boolean;
}>> = {
  down: { template: LPC_HUMANOID_SOUTH, sheetRow: HUMANOID_SOURCE.row, stamps: true },
  up: { template: LPC_HUMANOID_NORTH, sheetRow: HUMANOID_SOURCE_NORTH.row, stamps: false },
  left: { template: LPC_HUMANOID_WEST, sheetRow: HUMANOID_WEST_SOURCE.row, stamps: false },
};

/** A baked facing whose opposite is produced by MIRRORING the finished frames
 *  rather than a second pose-and-render pass — pixel-perfect and free, the
 *  same rule the studio's `facing.ts` states for west/east. */
const RIG_MIRRORS: Readonly<Partial<Record<RigBakeDir, Direction>>> = { left: 'right' };

/**
 * Frame indices laid out forward then back, endpoints unrepeated: 7 frames →
 * 0..6,5..1 (12 columns). One authored clip, a closed loop.
 */
export function pingPongOrder(frames: number): number[] {
  const order: number[] = [];
  for (let i = 0; i < frames; i++) order.push(i);
  for (let i = frames - 2; i > 0; i--) order.push(i);
  return order;
}

/** Rows the strip occupies (four per clip — the two facings a row does NOT
 *  bake stay empty rather than shifting the direction offsets into a second
 *  arithmetic; see head comment #2). */
export const RIG_STRIP_ROWS = RIG_ROW_CLIPS.length * 4;

/** Widest ping-ponged clip — the strip is as wide as its longest row. */
export const RIG_STRIP_COLS = Math.max(
  ...RIG_ROW_CLIPS.map(({ anim }) => LPC_ANIMATIONS[anim].lastCol + 1),
);

/** One baked row: its index WITHIN the strip, and the frames left-to-right. */
export interface RigStripRow {
  /** Strip-local row. Add `STANDARD_SHEET_ROWS` for the unified sheet row. */
  readonly row: number;
  readonly frames: readonly Raster[];
}

/** Yields the main thread between chunks so a bake never blocks a frame outright. */
export type YieldFn = () => Promise<void>;

interface IdleHost {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
}

/**
 * Idle time when the browser offers it, a macrotask otherwise.
 *
 * A frame of a rig bake measured 16–50 ms — over a frame's budget — so handing
 * chunks back through a bare `setTimeout(0)` would still cost a dropped frame
 * apiece for as long as the queue runs. `requestIdleCallback` is exactly the
 * right instrument: the bake is a background enrichment of NPCs that already
 * render. The 200 ms timeout keeps it from starving forever on a busy page —
 * and if it did starve, the honest outcome is simply that those NPCs keep
 * standing.
 */
const idle: YieldFn = () => new Promise((resolve) => {
  const host = globalThis as IdleHost;
  if (host.requestIdleCallback) host.requestIdleCallback(() => { resolve(); }, { timeout: 200 });
  else setTimeout(resolve, 0);
});

/**
 * Bake every rig row for one wardrobe. `sheets` are the FULL vendored walk
 * sheets bottom→top; `layers` supplies each one's chip assignment and stamp
 * donors (i.e. the south-sliced stack `loadHumanoidCharacter` returns, aligned
 * with `sheets`).
 *
 * Awaits `onYield` after EVERY FRAME. Measured on real seeded wardrobes (node,
 * ss=2, 6–8 layers): a whole wardrobe is 0.5–1.5 s of raster math, so chunking
 * by clip or by facing would still land 100–400 ms blocks on a live frame loop.
 * One frame is 16–50 ms — and the frames come from `bakeClipFrames`, the same
 * producer `bakeClip` drains, so suspending between them costs the strip
 * nothing and it stays byte-identical to the offline bake
 * (`tests/unit/lpc-rig-rows.test.ts`).
 */
export async function bakeRigStripRows(
  sheets: readonly Raster[],
  layers: readonly PoseLayer[],
  onYield: YieldFn = idle,
): Promise<RigStripRow[]> {
  const out: RigStripRow[] = [];
  for (const { anim, clip, facings } of RIG_ROW_CLIPS) {
    const rowBase = LPC_ANIMATIONS[anim].rowBase - STANDARD_SHEET_ROWS;
    const order = pingPongOrder(clip.frames);
    for (const dir of facings) {
      const facing = RIG_FACING_BAKES[dir];
      const posed = sheets.map((sheet, i): PoseLayer => ({
        raster: sliceSourceCell(sheet, facing.sheetRow, HUMANOID_SOURCE.col, RIG_CELL),
        assign: layers[i]?.assign,
        donors: facing.stamps ? layers[i]?.donors : undefined,
      }));
      const baked: Raster[] = [];
      for (const frame of bakeClipFrames(
        facing.template,
        posed,
        facing.stamps ? clip : { ...clip, stamps: undefined },
        { supersample: RIG_BAKE_SUPERSAMPLE },
      )) {
        baked.push(frame);
        await onYield();
      }
      const frames = order.map((f) => baked[f]);
      out.push({ row: rowBase + LPC_DIR_OFFSET[dir], frames });

      // Free mirror: `left`'s baked frames flipped, never a second pose pass.
      const mirrorDir = RIG_MIRRORS[dir];
      if (mirrorDir) {
        out.push({ row: rowBase + LPC_DIR_OFFSET[mirrorDir], frames: frames.map(mirrorFrame) });
      }
    }
  }
  return out;
}

/**
 * Paint baked rows onto a strip canvas. Straight-alpha `putImageData` (the
 * frames are un-premultiplied RGBA straight out of `renderPose`); untouched
 * rows — whichever facing pair a row did not bake — stay transparent.
 */
export function paintRigStrip(rows: readonly RigStripRow[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = RIG_STRIP_COLS * RIG_CELL;
  canvas.height = RIG_STRIP_ROWS * RIG_CELL;
  // No `willReadFrequently`: unlike the composed sheet (which `npcBillboard`
  // reads back), the strip is written once and only ever uploaded as a texture,
  // so forcing a CPU-backed canvas would cost the upload and buy nothing.
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  for (const { row, frames } of rows) {
    for (let col = 0; col < frames.length; col++) {
      const f = frames[col];
      // Narrowed the same way the rest of the render layer does it — the DOM lib
      // types ImageData's buffer as a plain ArrayBuffer, our rasters as ArrayBufferLike.
      const img = new ImageData(f.data as unknown as Uint8ClampedArray<ArrayBuffer>, f.w, f.h);
      ctx.putImageData(img, col * RIG_CELL, row * RIG_CELL);
    }
  }
  return canvas;
}
