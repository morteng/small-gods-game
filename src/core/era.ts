/**
 * Era constants + resolution. `Era` itself lives in core/types; this module owns
 * the runtime list, a type guard, and the per-settlement resolution rule used by
 * worldgen. Resolution is defensive: an unknown era coerces to undefined and
 * falls through, so a hand-edited seed never crashes generation.
 */
import type { Era, POI, WorldSeed } from '@/core/types';

export const ERAS = ['primordial', 'ancient', 'classical', 'medieval', 'current'] as const;

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
