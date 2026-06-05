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
