/**
 * LPC humanoid paper-doll template — NORTH (row 0, "up"/back-facing).
 *
 * Design: reuse LPC_HUMANOID_SOUTH's chip NAMES verbatim, in the same order.
 * That's the point, not an accident — `Clip`s key their angle tracks purely
 * by chip name (`sampleClip` looks up `clip.tracks[ch.name]`), so any clip
 * authored against the south template (`CLIP_PRAY_RAISE`, `CLIP_DESPAIR`,
 * `CLIP_IDLE_SHIFT`, …) plays on this template unchanged — same FK math,
 * same couplings, same plants. No north-specific clip authoring needed.
 *
 * The LPC back-view standing rest pose (arms at sides, legs straight) is
 * silhouette-symmetric with the front view, so the working hypothesis was
 * "same rects, same pivots, zero deltas" — verified empirically, not assumed
 * (see `tmp/north-recon.ts` for the ASCII alpha dumps + `tmp/chip-
 * overflow-check2.ts` for the per-row extent diff against south). Result:
 * every chip's rect matched south's EXCEPT the two thigh chips — see below.
 *
 * DELTA — legL_up / legR_up widened by 2px: at y=54–55 (just above the boot
 * flare), the back-view thigh silhouette sits up to 2px wider than the
 * front-view one at the same rows (south's `legL_up` rect x[22,30) misses
 * north pixels down to x=20; `legR_up`'s x[34,42) misses north pixels out to
 * x=43). Left unwidened, those 1–2px would stay glued to the trunk (outside
 * every chip's rect, so `rootChipRaster` never clears them and they never
 * move) — a visible tear at the hip on any clip that moves the thigh chip
 * (idle-shift's weight-sway translates it every frame). Pivots are
 * UNCHANGED — the recon showed no joint-position delta, only a silhouette
 * bulge fully inside the widened rect, so HIP_L/HIP_R stay put.
 *
 * Everything else (head, both arm chips, both shin chips) had zero new
 * overflow vs. south at the same padded scan — those rects/pivots are
 * copied verbatim.
 *
 * STAMP CAVEAT: north bakes carry NO stamps. South's stamps are either
 * face/blink pixel-clones (meaningless from behind — there's no face) or
 * palm swaps harvested from the spellcast sheet's SOUTH row, col 5/6 (wrong
 * donor coordinates for a back-facing hand). Baking a south `Clip` on this
 * template must pass a stamp-stripped copy (`{ ...clip, stamps: undefined }`)
 * — see `tmp/north-bake.ts`. FOLLOW-UP: harvest north palm stamps from
 * spellcast row 0 (dumped for reference in `tmp/north-recon.ts`'s output,
 * not yet wired into a `StampRef` set).
 */
import type { AnimTemplate } from './rig';

/** Source cell the chips are authored against: walk sheet, col 0 (idle), NORTH row. */
export const HUMANOID_SOURCE_NORTH = { anim: 'walk', col: 0, row: 0 } as const;

// Joints (cell coords, y-down) — IDENTICAL to LPC_HUMANOID_SOUTH's. Recon
// found no back-view joint-position delta (see file-top doc comment).
const SHOULDER_L: [number, number] = [26, 37];
const ELBOW_L: [number, number] = [19, 44];
const SHOULDER_R: [number, number] = [39, 37];
const ELBOW_R: [number, number] = [44, 44];
const NECK: [number, number] = [32, 34];
const HIP_L: [number, number] = [25, 51];
const KNEE_L: [number, number] = [24, 56];
const HIP_R: [number, number] = [38, 51];
const KNEE_R: [number, number] = [39, 56];

/**
 * North-facing humanoid template. Chip names/order/parents/z MATCH
 * LPC_HUMANOID_SOUTH exactly — that identity is what lets every south clip
 * play here unchanged. Only `legL_up`/`legR_up`'s rects differ (widened
 * 2px toward the outside hip edge — see file-top doc comment).
 */
export const LPC_HUMANOID_NORTH: AnimTemplate = {
  name: 'lpc-humanoid-north',
  cell: 64,
  chips: [
    { name: 'trunk', rect: { x: 0, y: 0, w: 64, h: 64 }, pivot: [32, 49], parent: -1, z: 0 },
    { name: 'head', rect: { x: 21, y: 11, w: 22, h: 21 }, pivot: NECK, parent: 0, z: 10 },
    { name: 'armL_up', rect: { x: 15, y: 33, w: 9, h: 12 }, pivot: SHOULDER_L, parent: 0, z: 2 },
    { name: 'armL_fore', rect: { x: 15, y: 42, w: 9, h: 9 }, pivot: ELBOW_L, parent: 2, z: 3 },
    { name: 'armR_up', rect: { x: 40, y: 33, w: 9, h: 12 }, pivot: SHOULDER_R, parent: 0, z: 4 },
    { name: 'armR_fore', rect: { x: 40, y: 42, w: 9, h: 9 }, pivot: ELBOW_R, parent: 4, z: 5 },
    // Widened vs south: x20-29 (was x22-29) — covers the north thigh bulge
    // at y54-55 (recon delta: newOverflowL=2 at y55). Pivot unchanged.
    { name: 'legL_up', rect: { x: 20, y: 51, w: 10, h: 5 }, pivot: HIP_L, parent: 0, z: 6 },
    { name: 'legL_fore', rect: { x: 19, y: 56, w: 11, h: 6 }, pivot: KNEE_L, parent: 6, z: 7 },
    // Widened vs south: x34-43 (was x34-41) — mirror of legL_up's delta
    // (recon: newOverflowR=2 at y55). Pivot unchanged.
    { name: 'legR_up', rect: { x: 34, y: 51, w: 10, h: 5 }, pivot: HIP_R, parent: 0, z: 8 },
    { name: 'legR_fore', rect: { x: 34, y: 56, w: 11, h: 6 }, pivot: KNEE_R, parent: 8, z: 9 },
  ],
};
