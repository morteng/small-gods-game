import type { NpcInstance, NpcProperties } from '@/core/types';
import type { World } from '@/world/world';
import { isRigRow, LPC_ANIMATIONS, LPC_DIR_OFFSET, STANDARD_SHEET_ROWS } from '@/core/npc-animation';

/** Walk cycle frame duration in ms (~6.7 FPS) */
export const FRAME_MS = 150;

/**
 * Advance NPC walk animation frames.
 * Frame 0 is idle — never auto-advanced.
 * Frames 1–8 cycle continuously.
 */
export function updateNpcs(npcs: NpcInstance[], deltaMs: number): void {
  for (const npc of npcs) {
    if (npc.frame === 0) continue; // idle — don't animate
    npc.frameTimer += deltaMs;
    if (npc.frameTimer >= FRAME_MS) {
      npc.frameTimer -= FRAME_MS;
      npc.frame = npc.frame >= 8 ? 1 : npc.frame + 1;
    }
  }
}

/** Where one NPC's current frame lives, and on WHICH sheet. */
export interface NpcFrameRef {
  sx: number;
  sy: number;
  /** true → read the rig strip (row space rebased to it), false → the LPC sheet. */
  rig: boolean;
}

/**
 * Resolve an NPC's current frame to source coordinates.
 * Spritesheet frame size: 64×64px.
 *
 * Row = the animation's `rowBase` + the direction offset (hurt is the one
 * non-directional row). Column = the NPC's current `frame`, clamped to the
 * animation's last column so a stale/foreign frame index can never read garbage
 * pixels from the next animation's row.
 *
 * Rig rows (`rowBase >= STANDARD_SHEET_ROWS`) are addressed in the same row
 * space but live on the companion strip canvas, so their row is rebased onto it.
 * When the strip has not been baked yet — or the sim picked a facing the rig
 * never authored (west/east) — the animation's `fallback` takes over, which is
 * why the sim can name a rig state unconditionally and the renderer degrades
 * gracefully instead of drawing a hole.
 */
export function resolveNpcFrame(npc: NpcInstance, rigReady: boolean): NpcFrameRef {
  const anim = npc.animation ?? 'walk';
  let spec = LPC_ANIMATIONS[anim] ?? LPC_ANIMATIONS.walk;
  let frame = npc.frame;
  let rig = false;
  if (isRigRow(spec)) {
    rig = rigReady && (spec.facings?.includes(npc.direction) ?? true);
    if (!rig) {
      const fb = spec.fallback ?? { anim: 'walk' as const, col: 0 };
      spec = LPC_ANIMATIONS[fb.anim];
      frame = fb.col ?? frame;
    }
  }
  const dirOff = spec.directional ? (LPC_DIR_OFFSET[npc.direction] ?? 2) : 0;
  const col = Math.min(Math.max(frame, 0), spec.lastCol);
  const row = spec.rowBase + dirOff - (rig ? STANDARD_SHEET_ROWS : 0);
  return { sx: col * 64, sy: row * 64, rig };
}

/** Source coordinates on the STANDARD sheet — a rig animation resolves to its
 *  fallback. The renderer that owns a rig strip calls `resolveNpcFrame` instead. */
export function getSpriteCoords(npc: NpcInstance): { sx: number; sy: number } {
  const { sx, sy } = resolveNpcFrame(npc, false);
  return { sx, sy };
}

/**
 * Advance WALK-cycle frames on the canonical entity properties (source of truth).
 *
 * Only the walk cycle. Every other animation — the vendored action rows and the
 * baked rig rows alike — has its frame driven by the sim's own cadence
 * (`animateStationary`, `ACTION_FRAME_MS`); stepping those a second time here on
 * walk's 1..8 both fights that cadence and reads columns the row does not own.
 * The rig rows made this visible (their strips are ping-ponged, so an
 * out-of-order column reads as jitter), but the collision was always there.
 */
export function advanceNpcFrames(world: World, deltaMs: number): void {
  for (const e of world.query({ kind: 'npc' })) {
    const p = e.properties as unknown as NpcProperties;
    if (p.animation !== undefined && p.animation !== 'walk') continue;
    p.frameTimer += deltaMs;
    if (p.frameTimer >= FRAME_MS) {
      p.frameTimer -= FRAME_MS;
      p.frame = (p.frame % 8) + 1;
    }
  }
}
