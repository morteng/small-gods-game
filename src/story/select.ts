/**
 * Reservoir selection — the storylet model's "graph" emerges here.
 *
 * Eligibility = not-already-spent (`once`) AND every `when` precondition truthy.
 * Among the eligible, the director may choose; otherwise the deterministic
 * default takes the highest `priority`, breaking ties with the seeded RNG so
 * selection is replayable. Returns null when the reservoir is dry.
 */
import type { Rng } from '@/core/rng';
import type { StoryPack, Storylet } from './story-ir';
import type { Scope } from './story-state';
import type { Director } from './director';
import { evalCondition } from './expr';

export function eligibleStorylets(
  pack: StoryPack,
  scope: Scope,
  rng: Rng,
  seen: ReadonlySet<string>,
): Storylet[] {
  return pack.storylets.filter((s) => {
    if (s.once && seen.has(s.id)) return false;
    if (s.when && !s.when.every((c) => evalCondition(c, scope, rng))) return false;
    return true;
  });
}

export function selectStorylet(
  pack: StoryPack,
  scope: Scope,
  rng: Rng,
  seen: ReadonlySet<string>,
  director?: Director,
): Storylet | null {
  const eligible = eligibleStorylets(pack, scope, rng, seen);
  if (eligible.length === 0) return null;

  const chosen = director?.select?.(eligible, scope, rng);
  if (chosen) return chosen;

  // Default: highest priority, seeded tiebreak among the top tier.
  let top = -Infinity;
  for (const s of eligible) top = Math.max(top, s.priority ?? 0);
  const best = eligible.filter((s) => (s.priority ?? 0) === top);
  return best.length === 1 ? best[0] : rng.pick(best);
}
