import type { NpcInstance, NpcProperties } from '@/core/types';
import type { World } from '@/world/world';
import { LPC_ANIMATIONS, LPC_DIR_OFFSET } from '@/core/npc-animation';

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

/**
 * Get source coordinates within an LPC spritesheet for a given NPC state.
 * Spritesheet frame size: 64×64px.
 *
 * Row = the animation's `rowBase` + the direction offset (hurt is the one
 * non-directional row). Column = the NPC's current `frame`, clamped to the
 * animation's last column so a stale/foreign frame index can never read garbage
 * pixels from the next animation's row.
 */
export function getSpriteCoords(npc: NpcInstance): { sx: number; sy: number } {
  const anim = npc.animation ?? 'walk';
  const spec = LPC_ANIMATIONS[anim] ?? LPC_ANIMATIONS.walk;
  const dirOff = spec.directional ? (LPC_DIR_OFFSET[npc.direction] ?? 2) : 0;
  const col = Math.min(Math.max(npc.frame, 0), spec.lastCol);
  return { sx: col * 64, sy: (spec.rowBase + dirOff) * 64 };
}

/** Advance walk-cycle frames on the canonical entity properties (source of truth). */
export function advanceNpcFrames(world: World, deltaMs: number): void {
  for (const e of world.query({ kind: 'npc' })) {
    const p = e.properties as unknown as NpcProperties;
    p.frameTimer += deltaMs;
    if (p.frameTimer >= FRAME_MS) {
      p.frameTimer -= FRAME_MS;
      p.frame = (p.frame % 8) + 1;
    }
  }
}
