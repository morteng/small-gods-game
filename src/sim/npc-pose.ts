// src/sim/npc-pose.ts
// POSE + FACING — the pure leaf that answers "what is this NPC doing with its body while it is
// standing still, and which way is it looking?". Extracted from `npc-movement.ts` so BOTH the
// ordinary 60 Hz walker AND the wall-garrison phase machine (`@/sim/garrison.ts`) can animate a
// standing NPC without importing each other: a re-export from `npc-movement.ts` would NOT have cut
// that edge (the `src/sim/divine-costs.ts` pattern — pull the leaf out, then REPOINT the importer).
// Imports nothing from `src/sim/`; keep it that way.
import type { Direction, NpcProperties } from '@/core/types';
import { LPC_ANIMATIONS, ACTION_FRAME_MS, nextFrame, type NpcAnimation } from '@/core/npc-animation';

/** Combat poses a soldier cycles through (seeded per-NPC so the crowd varies). */
export const COMBAT_POSES: NpcAnimation[] = ['slash', 'thrust', 'shoot'];

/** What a soldier HOLDING A WALL STATION does: weapon presented over the field, never the
 *  practice-yard slash. Seeded per-NPC so a manned rampart reads as a mixed line of spears and
 *  bows rather than one pose repeated down the allure. */
export const WATCH_POSES: NpcAnimation[] = ['thrust', 'shoot'];

/** Derive cardinal direction from a movement (or facing) delta. */
export function directionFromDelta(dx: number, dy: number): Direction {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'down' : 'up';
}

/**
 * Which animation a *stationary* NPC should play. Drives the visible
 * behaviours: worshippers pray, soldiers-at-work drill with a seeded
 * melee/ranged pose, a soldier STATIONED on a wall-walk keeps watch with a
 * presented weapon, and everyone else shifts their weight.
 *
 * `pray-raise` and `idle-shift` are RIG rows (`core/npc-animation.ts`): the sim
 * names the state unconditionally and the renderer falls back to the idle stand
 * for as long as that NPC's wardrobe has not been baked. Naming a state the
 * renderer may not be able to draw yet is deliberate — the sim is truth.
 */
export function stationaryAnimation(p: NpcProperties): NpcAnimation {
  // Rig rows are baked from the NPC's OWN cell, so — unlike the vendored action
  // rows below — worship reads right on every body, children included.
  // (This retires the old blanket child guard: it existed because upstream child
  // bodies ship only walk/slash/hurt, so a child worshipper drew an EMPTY
  // spellcast row. The remaining vendored poses below are soldier-only, and no
  // soldier is a child, so nothing else needs guarding.)
  if (p.activity === 'worship') return 'pray-raise';
  if (p.role === 'soldier') {
    // Manning the walls: a posted man watches the field; only when he is off the
    // wall does the ordinary work-drill pose apply.
    if (p.garrison?.phase === 'stationed') return WATCH_POSES[p.seed % WATCH_POSES.length];
    if (p.activity === 'work') return COMBAT_POSES[p.seed % COMBAT_POSES.length];
  }
  return 'idle-shift';
}

/** Milliseconds per frame of the walk cycle (columns 1..8; column 0 is the idle stand). */
const WALK_FRAME_MS = 150;

/** Advance the walk cycle for an NPC that is MOVING — ground path, mural stair or wall-walk alike.
 *  (Facing is the caller's business: it knows what it is moving toward.) */
export function animateWalking(p: NpcProperties, dtMs: number): void {
  if (p.animation !== 'walk') { p.animation = 'walk'; p.frame = 0; }
  if (p.frame === 0) p.frame = 1;
  p.frameTimer += dtMs;
  if (p.frameTimer >= WALK_FRAME_MS) {
    p.frameTimer -= WALK_FRAME_MS;
    p.frame = p.frame >= 8 ? 1 : p.frame + 1;
  }
}

/**
 * Set `p.animation` and advance its frame for an NPC that is standing still.
 *
 * There is no longer a "frozen on walk column 0" case: standing still is its own
 * animation (`idle-shift`) with its own cycle. Holding the idle stand is what the
 * RENDERER does for an unbaked rig row, which is where that decision belongs.
 */
export function animateStationary(p: NpcProperties, dtMs: number): void {
  const anim = stationaryAnimation(p);
  if (p.animation !== anim) {
    p.animation = anim;
    p.frame = LPC_ANIMATIONS[anim].firstCol;
    p.frameTimer = 0;
  }
  p.frameTimer += dtMs;
  if (p.frameTimer >= ACTION_FRAME_MS) {
    p.frameTimer -= ACTION_FRAME_MS;
    p.frame = nextFrame(anim, p.frame);
  }
}
