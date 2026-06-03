import type { Spirit } from '@/core/spirit';
import type { EventLog } from '@/core/events';
import type { EntityId } from '@/core/types';

/** Power cost to open a mind page at the given depth: surface free, then 2^(depth-1). */
export function mindProbeCost(depth: number): number {
  if (depth <= 0) return 0;
  return 2 ** (depth - 1);
}

/**
 * Deterministic floor for reading a mind page: spend the depth-scaled power and log it.
 * Mutates NO npc state (observation only, v1). No randomness.
 * @returns true if applied (or free at depth 0); false if power insufficient.
 */
export function probeMind(spirit: Spirit, depth: number, log: EventLog, npcId: EntityId): boolean {
  const cost = mindProbeCost(depth);
  if (spirit.power < cost) return false;
  spirit.power -= cost;
  log.append({ type: 'mind_probed', spiritId: spirit.id, npcId, depth });
  return true;
}
