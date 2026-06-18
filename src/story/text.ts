/**
 * Text-slot resolution — where the dual-consumer seam actually fires.
 *
 *  - literal string  → interpolate `$path` against scope.
 *  - { pick }        → seeded deterministic variant, then interpolate.
 *  - { fallback, enrich } → ask the director to enrich; if it declines (the dumb
 *    director ALWAYS declines), fall back to the authored `fallback`. Either way
 *    the result is interpolated. This is the line that makes no-key play possible.
 */
import type { Rng } from '@/core/rng';
import type { TextSlot } from './story-ir';
import type { ReadonlyScope } from './story-state';
import type { Director } from './director';

export function resolveText(
  slot: TextSlot,
  scope: ReadonlyScope,
  rng: Rng,
  director?: Director,
): string {
  let raw: string;
  if (typeof slot === 'string') {
    raw = slot;
  } else if ('pick' in slot) {
    raw = slot.pick.length ? rng.pick(slot.pick) : '';
  } else {
    // AI-optional: deterministic fallback unless a director rewrites it.
    raw = director?.enrich?.(slot.enrich, scope) ?? slot.fallback;
  }
  return interpolate(raw, scope);
}

const INTERP = /\$([a-zA-Z_][a-zA-Z0-9_.]*)/g;

/** Replace `$path` tokens with scope values; unknown paths are left verbatim. */
export function interpolate(text: string, scope: ReadonlyScope): string {
  return text.replace(INTERP, (whole, path: string) => {
    const v = scope.get(path);
    return v === undefined || v === null ? whole : String(v);
  });
}
