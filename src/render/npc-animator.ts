import type { NpcInstance } from '@/core/types';

/** Walk cycle frame duration in ms (~6.7 FPS) */
export const FRAME_MS = 150;

const DIRECTION_ROW: Record<string, number> = {
  up: 2,
  left: 3,
  down: 4,
  right: 5,
};

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
 * Row layout: up=2, left=3, down=4, right=5.
 */
export function getSpriteCoords(npc: NpcInstance): { sx: number; sy: number } {
  const row = DIRECTION_ROW[npc.direction] ?? 4;
  return { sx: npc.frame * 64, sy: row * 64 };
}
