/**
 * Era constants + resolution. `ERAS` is the single source of truth; `Era` is
 * derived from it. `types.ts` re-exports `Era` so existing import sites keep
 * working unchanged. This module owns the runtime list, a type guard, and the
 * per-settlement resolution rule used by worldgen. Resolution is defensive: an
 * unknown era coerces to undefined and falls through, so a hand-edited seed
 * never crashes generation.
 */
import type { POI, WorldSeed } from '@/core/types';

export const ERAS = ['primordial', 'ancient', 'classical', 'medieval', 'current'] as const;
export type Era = typeof ERAS[number];

export function isEra(x: unknown): x is Era {
  return typeof x === 'string' && (ERAS as readonly string[]).includes(x);
}

function coerce(x: unknown): Era | undefined {
  return isEra(x) ? x : undefined;
}

/** poi.era ?? worldSeed.era ?? 'medieval', ignoring any unrecognized value. */
export function resolveSettlementEra(poi: POI, worldSeed?: WorldSeed | null): Era {
  return coerce(poi.era) ?? coerce(worldSeed?.era) ?? 'medieval';
}

/** Understanding at/above which a settlement's masons build as if a full era more advanced. */
export const UNDERSTANDING_ERA_STEP = 0.66;

/**
 * Lift an era by aggregate believer UNDERSTANDING — the buildability-envelope tech axis,
 * applied at growth time. A settlement whose people deeply understand their god (mean
 * understanding ≥ `UNDERSTANDING_ERA_STEP`) builds as if one era further on (capped at the
 * latest era). This is the god-game's progression made physical: the player cultivating
 * understanding literally unlocks grander architecture. Understanding 0 (early game) ⇒ the
 * era is unchanged, so live growth stays byte-identical until belief actually deepens.
 */
export function liftEraByUnderstanding(base: Era, understanding: number): Era {
  const idx = ERAS.indexOf(base);
  if (idx < 0) return base;
  const lift = understanding >= UNDERSTANDING_ERA_STEP ? 1 : 0;
  return ERAS[Math.min(ERAS.length - 1, idx + lift)];
}
