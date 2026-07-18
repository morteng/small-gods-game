/**
 * interest-predicate.ts — "is this event worth stopping a fast-forward for?"
 *
 * Round 9 (Time Controls) needs a single, shared answer to "what counts as an
 * interesting moment" so the seek engine ("jump to next event") lands on the same
 * beats Fate reacts to — no third taxonomy. This module is the union of the two
 * halves that already exist:
 *
 *   1. STORY SIGNIFICANCE — `isStorySignificant` is the exact predicate the Fate
 *      brain wakes on (`fate-trigger.ts` imports it from here now, so the two can
 *      never drift). Fate's firing behavior is unchanged: same events, same logic.
 *   2. SALIENCE-BAND EVENTS — the wider ring the divine inbox surfaces to the
 *      player: a rival claiming a prayer, a settlement changing, a believer born
 *      or dying, belief/mood crossings, and the player's own dramatic acts.
 *
 * `isInterestingEvent` is the seek predicate. `describeInterest` gives the landing
 * card a short, ranked label for the triggering event.
 *
 * Pure functions over the event + read-only state — no sim mutation, no RNG.
 */
import type { SimEvent } from '@/core/events';
import type { GameState } from '@/core/state';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';

/**
 * STORY SIGNIFICANCE — the recognized-story beats the Fate brain wakes on. This
 * is the SINGLE definition; `fate-trigger.ts` imports it so Fate's trigger and
 * the seek predicate cannot drift apart. Do NOT widen this without intending to
 * change WHEN Fate deliberates (see tests/unit/fate-trigger.test.ts).
 */
export function isStorySignificant(ev: SimEvent): boolean {
  if (ev.type === 'thread_opened' || ev.type === 'thread_resolved') return true;
  if (ev.type === 'thread_advanced') return ev.weight === 'climax';
  // A settlement going under water is a dramatic beat (wrath, refugees, a rival's
  // counter-claim); the waters making a NEW place is likewise beat-worthy.
  if (ev.type === 'place_flooded') return true;
  if (ev.type === 'site_born') return true;
  return false;
}

/** A rival (non-player spirit) claiming a prayer via the shared `answer_prayer` path. */
function isRivalClaim(ev: SimEvent): boolean {
  return ev.type === 'answer_prayer' && ev.spiritId !== PLAYER_SPIRIT_ID;
}

/**
 * The seek predicate: is `ev` interesting enough to STOP a fast-forward on?
 *
 * = story significance ∪ the salience band the inbox surfaces. `state` is accepted
 * for future belief-scoped filtering (e.g. "only believers of the player"), but by
 * DESIGN we currently accept ALL births/deaths: a death's NPC is often already
 * gone from the world by the time the event fires, so a belief lookup would be
 * unreliable and costly. The task explicitly allows "all deaths/births" here.
 *
 * `belief_cross`/`mood_cross` are deliberately EXCLUDED: they are the low-salience
 * tidings band (0.1–0.35) and fire every few game-seconds in a live world —
 * measured in the R9 integration smoke, they landed every seek within ~75 ticks,
 * making the skip button a no-op. They still appear in the landing summary's
 * passedCounts and in `describeInterest` (for coalesced headlines).
 */
export function isInterestingEvent(ev: SimEvent, _state?: GameState): boolean {
  if (isStorySignificant(ev)) return true;
  if (isRivalClaim(ev)) return true;
  switch (ev.type) {
    case 'beat_fired':
    case 'settlement_begin':
    case 'settlement_end':
    case 'settlement_grown':
    case 'settlement_upgraded':
    case 'npc_death':
    case 'npc_birth':
    case 'power_depleted':
    case 'summon_storm':
    case 'smite':
    case 'miracle':
    // M6 — the Peace of God: the player's dramatic act (like miracle/smite) and
    // the moment the oath runs out (the lord's men unbound again — actionable).
    case 'peace_proclaimed':
    case 'peace_lapsed':
    // M5 — knights: a settlement passing under (or out of) a castle's grip is
    // an extraction-pressure edge the player can act on (need is opportunity).
    case 'grip_taken':
    case 'grip_broken':
    // Road-wear S2 — a road climbing to a highway (or a route falling back to a
    // path) is a visible shift in the land's connective fabric worth landing on.
    case 'road_promoted':
    case 'road_demoted':
      return true;
    default:
      return false;
  }
}

/**
 * A short, RANKED description of why an event is interesting — the landing card's
 * headline. `rank` orders competing triggers (higher = more dramatic); the seek
 * engine lands on the FIRST interesting event, but the summary can use `rank` to
 * pick a headline among several that fired in the same landing chunk.
 */
export function describeInterest(ev: SimEvent): { rank: number; label: string } {
  switch (ev.type) {
    case 'thread_resolved':   return { rank: 90, label: 'A story reached its end' };
    case 'thread_opened':     return { rank: 80, label: 'A new story took shape' };
    case 'thread_advanced':   return { rank: 85, label: 'A story reached its climax' };
    case 'place_flooded':     return { rank: 88, label: `The waters took ${ev.name}` };
    case 'site_born':         return { rank: 70, label: `A new place was born: ${ev.name}` };
    case 'answer_prayer':
      return ev.spiritId !== PLAYER_SPIRIT_ID
        ? { rank: 75, label: 'A rival answered a prayer you left unanswered' }
        : { rank: 40, label: 'A prayer was answered' };
    case 'beat_fired':        return { rank: 78, label: 'A story beat came to pass' };
    case 'settlement_upgraded': return { rank: 60, label: 'A settlement rose in the world' };
    case 'settlement_grown':  return { rank: 55, label: 'A settlement grew' };
    case 'settlement_begin':  return { rank: 65, label: 'Something befell a settlement' };
    case 'settlement_end':    return { rank: 50, label: 'A settlement found its peace' };
    case 'npc_death':         return { rank: 68, label: 'A soul passed from the world' };
    case 'npc_birth':         return { rank: 58, label: 'A child was born' };
    case 'belief_cross':      return { rank: 52, label: ev.kind === 'high' ? 'Faith surged in a follower' : 'Faith faltered in a follower' };
    case 'mood_cross':        return { rank: 45, label: ev.kind === 'high' ? 'Spirits soared' : 'Spirits sank' };
    case 'power_depleted':    return { rank: 72, label: 'Your power ran dry' };
    case 'summon_storm':      return { rank: 82, label: 'A deluge was summoned' };
    case 'smite':             return { rank: 84, label: 'Lightning struck' };
    case 'miracle':           return { rank: 62, label: 'A miracle was worked' };
    case 'peace_proclaimed':  return { rank: 66, label: 'The Peace of God was proclaimed' };
    case 'peace_lapsed':      return { rank: 48, label: 'The Peace of God lapsed' };
    case 'grip_taken':        return { rank: 64, label: 'Knights took a settlement in their grip' };
    case 'grip_broken':       return { rank: 56, label: "A castle's grip on a settlement was broken" };
    case 'road_promoted':     return { rank: 46, label: ev.to === 'highway' ? "A lord's highway was built" : 'A road rose in the world' };
    case 'road_demoted':      return { rank: 42, label: 'A road fell into disuse' };
    default:                  return { rank: 0, label: 'Something happened' };
  }
}
