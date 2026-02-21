import type { NpcSimState } from '@/core/types';
import { clamp01 } from '@/sim/npc-sim';

export const WHISPER_COST               = 1;
export const WHISPER_FAITH_BOOST        = 0.15;
export const WHISPER_UNDERSTANDING_BOOST = 0.03;
export const WHISPER_COOLDOWN           = 5;   // sim ticks (= seconds)
export const POWER_REGEN_RATE           = 0.02;

/** Returns true if the player can whisper to this NPC right now. */
export function canWhisper(sim: NpcSimState, playerPower: number): boolean {
  return playerPower >= WHISPER_COST && sim.whisperCooldown <= 0;
}

/**
 * Apply a whisper to an NPC.
 * Mutates `sim` in place; returns the new playerPower after deducting cost.
 */
export function whisperNpc(sim: NpcSimState, playerPower: number): number {
  const belief = sim.beliefs['player'];
  if (belief) {
    belief.faith         = clamp01(belief.faith         + WHISPER_FAITH_BOOST);
    belief.understanding = clamp01(belief.understanding + WHISPER_UNDERSTANDING_BOOST);
  }
  sim.whisperCooldown = WHISPER_COOLDOWN;

  // Push event to ring buffer (max 5)
  sim.recentEvents.push('whisper');
  if (sim.recentEvents.length > 5) {
    sim.recentEvents.shift();
  }

  return playerPower - WHISPER_COST;
}

/**
 * Compute power regeneration per sim tick.
 * Simplified Phase 8 formula: Σ(faith) × POWER_REGEN_RATE
 */
export function computePowerRegen(sims: Map<string, NpcSimState>): number {
  let total = 0;
  for (const sim of sims.values()) {
    total += sim.beliefs['player']?.faith ?? 0;
  }
  return total * POWER_REGEN_RATE;
}
