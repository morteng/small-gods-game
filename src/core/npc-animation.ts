/**
 * LPC (Liberated Pixel Cup) universal-spritesheet animation table.
 *
 * The vendored character generator (`src/render/lpc/`) composites each NPC into
 * a single 64px-cell "universal sheet" whose rows follow the classic LPC layout
 * (spellcast at row 0, thrust 4, walk 8, slash 12, shoot 16, hurt 20). This
 * table is the single source of truth for which row/column a given animation +
 * direction + frame maps to — consumed by the renderer (`getSpriteCoords`) and
 * by the sim's movement system (frame advance + animation selection).
 *
 * Frame counts mirror the upstream `ANIMATION_CONFIGS` cycle arrays in
 * `src/render/lpc/state/constants.js` (verified against the vendored sheets).
 * Walk reserves column 0 as the idle stand (outside its 1..8 cycle); the action
 * animations start at column 0. `hurt` is the one non-directional row (the death
 * collapse faces south only in the LPC standard).
 *
 * Below the vendored block sit the RIG ROWS (M3): frames baked at runtime from
 * the paper-doll rig (`src/render/paperdoll/`) out of the NPC's own part sheets,
 * addressed in this same row space as if they were appended under the standard
 * sheet. They are the seam that finally puts the authored devotional clips on
 * live NPCs. Which rows exist is pure data and belongs here; HOW they are baked
 * is `src/render/lpc/rig-rows.ts`'s business.
 *
 * Lives in `core/` so both `render/` and `sim/` can import it without crossing a
 * layer boundary (it is pure data — no DOM, no render deps).
 */
import type { Direction } from './types';

export type NpcAnimation =
  | 'walk' | 'spellcast' | 'thrust' | 'slash' | 'shoot' | 'hurt'
  // Rig rows — baked, not vendored (see STANDARD_SHEET_ROWS).
  | 'pray-raise' | 'idle-shift' | 'march';

/**
 * Rows the vendored universal sheet itself occupies (`SHEET_HEIGHT` 3456 ÷ 64 in
 * `src/render/lpc/canvas/renderer.js`, i.e. through the halfslash block at row
 * 50). Every rig row sits at or beyond this line, so a rig `rowBase` can never
 * collide with a vendored one — pinned by `tests/unit/lpc-spritesheet-rows.test.ts`.
 */
export const STANDARD_SHEET_ROWS = 54;

/** True when this row block is baked by the rig rather than shipped by LPC. */
export function isRigRow(spec: LpcAnimSpec): boolean {
  return spec.rowBase >= STANDARD_SHEET_ROWS;
}

/** What to draw instead while a rig row is unbaked (or unauthored for this facing). */
export interface AnimFallback {
  /** A STANDARD-block animation — the fallback must always be renderable. */
  readonly anim: NpcAnimation;
  /**
   * Pin this column instead of carrying the live frame (walk col 0 = idle
   * stand). Omit it to carry the live frame — but "carry" means the fallback
   * plays at the SAME fractional position in ITS OWN cycle, not literally
   * `npc.frame` unchanged: a rig row's ping-ponged strip and the vendored
   * row it falls back to rarely share a column count (march's 32-column
   * strip against walk's 8), so passing the raw index through would just
   * clamp to the narrower spec's `lastCol` for most of the wider cycle —
   * frozen, not moving. `resolveNpcFrame` (`render/npc-animator.ts`) does the
   * proportional remap; this field only says whether to do it.
   */
  readonly col?: number;
}

export interface LpcAnimSpec {
  /** Row of the north-facing frame in the 64px universal sheet (×64 = sy). */
  readonly rowBase: number;
  /** First column of the cycle (walk's idle stand is column 0, before this). */
  readonly firstCol: number;
  /** Last column of the cycle (inclusive). */
  readonly lastCol: number;
  /** false → single non-directional row (hurt/death faces south only). */
  readonly directional: boolean;
  /** false → play once and hold the last frame (death does not loop). */
  readonly loop: boolean;
  /**
   * Facings whose rows actually carry pixels. Absent → all four (the vendored
   * rows are complete). A rig row bakes EITHER the front pair (south stationary
   * poses, sharing one chip vocabulary with north) OR the profile pair (march,
   * authored against west's own vocabulary and mirrored to east) — never all
   * four, since the unbaked facings fall back instead (`RIG_FACINGS` vs
   * `MARCH_FACINGS`, `facing.ts`).
   */
  readonly facings?: readonly Direction[];
  /** Set on rig rows: what to play until the bake lands. */
  readonly fallback?: AnimFallback;
}

/**
 * Rig rows fall back to the WALK IDLE STAND, never to a look-alike action row:
 * `spellcast` would read as casting rather than praying, and the vendored child
 * bodies ship no spellcast row at all (it would render empty). Standing still is
 * the honest thing to show while the bake is queued.
 */
const RIG_FALLBACK: AnimFallback = { anim: 'walk', col: 0 };

/** Facings the rig bakes (south + north share one chip vocabulary). */
const RIG_FACINGS: readonly Direction[] = ['down', 'up'];

/**
 * `march`'s fallback for the facings it does NOT bake — the inverse of
 * `RIG_FALLBACK`. `pray-raise`/`idle-shift` are STATIONARY, so standing still
 * while unbaked is the honest picture; march's whole point is an NPC in
 * motion, so its fallback is the vendored WALK ROW carrying the live cycle
 * position (no `col` pin) rather than the idle stand — a marching soldier
 * seen head-on reads as walking, not as frozen mid-stride or standing still.
 */
const MARCH_FALLBACK: AnimFallback = { anim: 'walk' };

/**
 * Facings march bakes. Unlike `RIG_FACINGS`, this is PROFILE only: march is
 * authored against the west chip vocabulary (`lpc-humanoid-west.ts`) and reads
 * as a march only there — projected onto the coronal (frontal) plane the
 * marching leg swing all but vanishes (~24° against 61–68° in profile), so
 * the south/north bake is structurally clean but visually reads as standing
 * with a bob, not marching. East is never authored — `left` bakes WEST and
 * `right` is the mirrored result (`facing.ts`).
 */
const MARCH_FACINGS: readonly Direction[] = ['left', 'right'];

export const LPC_ANIMATIONS: Record<NpcAnimation, LpcAnimSpec> = {
  spellcast: { rowBase: 0,  firstCol: 0, lastCol: 6,  directional: true,  loop: true },
  thrust:    { rowBase: 4,  firstCol: 0, lastCol: 7,  directional: true,  loop: true },
  walk:      { rowBase: 8,  firstCol: 1, lastCol: 8,  directional: true,  loop: true },
  slash:     { rowBase: 12, firstCol: 0, lastCol: 5,  directional: true,  loop: true },
  shoot:     { rowBase: 16, firstCol: 0, lastCol: 12, directional: true,  loop: true },
  hurt:      { rowBase: 20, firstCol: 0, lastCol: 5,  directional: false, loop: false },
  // Rig rows. `lastCol` counts the PING-PONGED strip, not the authored clip:
  // both clips end somewhere other than they start (arms up; weight on one leg),
  // so the bake lays frames out forward-then-back — 2n−2 columns — and the loop
  // closes without a pop. pray-raise is 7 frames → 12 cols; idle-shift 8 → 14.
  'pray-raise': { rowBase: 54, firstCol: 0, lastCol: 11, directional: true, loop: true, facings: RIG_FACINGS, fallback: RIG_FALLBACK },
  'idle-shift': { rowBase: 58, firstCol: 0, lastCol: 13, directional: true, loop: true, facings: RIG_FACINGS, fallback: RIG_FALLBACK },
  // march is 17 frames (the importer's own aliasing sweep: 9 sat at 8.0° RMS /
  // 26.6° worst step, 17 clears it at 2.7° / 6.3°) → 2×17−2 = 32 ping-ponged
  // columns, lastCol 31 — by far the widest row the shared strip carries.
  'march': { rowBase: 62, firstCol: 0, lastCol: 31, directional: true, loop: true, facings: MARCH_FACINGS, fallback: MARCH_FALLBACK },
};

/** Direction → row offset from an animation's `rowBase` (LPC order: n,w,s,e). */
export const LPC_DIR_OFFSET: Record<Direction, number> = { up: 0, left: 1, down: 2, right: 3 };

/** Frames-per-second cadence for action animations (slightly snappier than walk). */
export const ACTION_FRAME_MS = 120;

/**
 * Advance `frame` one step within `anim`'s cycle. Looping animations wrap to
 * `firstCol`; non-looping ones hold at `lastCol`. Pure — caller owns the clock.
 */
export function nextFrame(anim: NpcAnimation, frame: number): number {
  const spec = LPC_ANIMATIONS[anim];
  if (frame >= spec.lastCol) return spec.loop ? spec.firstCol : spec.lastCol;
  return frame + 1;
}
