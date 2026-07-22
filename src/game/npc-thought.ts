/**
 * npc-thought.ts — deterministic, LLM-free "current thought" for an NPC.
 *
 * The always-on OFFLINE layer of the mind-reading feature: a short first-person-ish
 * inner-monologue line derived PURELY from sim state (no rng, no side effects, no
 * network). When an LLM is configured, `openMindPage` (`src/game/mind-orchestrator.ts`)
 * reworks this into a richer prose page — but this must stand alone and read well
 * with no LLM at all, the same contract `interaction-memory.ts` (deterministic prose
 * tables) and `whisper-card.ts` (dominantNeed × phrase table) already keep.
 *
 * Also the seed of a later NPC-dialog templater: phrase tables are kept small,
 * flat, and keyed the same way (need × register / activity) so they extend cleanly.
 *
 * Voice: terse, folk, a bit mythic — present-tense, ~4-14 words, never contradicts
 * the numbers (a starving NPC never sounds content).
 */
import type { NpcActivity, NpcNeeds, NpcPersonality, MemoryEntry } from '@/core/types';

/** Personality is optional on the input — only the fields this module reads. */
export type Personality = Pick<NpcPersonality, 'piety' | 'skepticism'>;

export interface ThoughtInput {
  activity: NpcActivity;
  needs: NpcNeeds;
  mood?: number;
  personality?: Personality;
  prayerNeed?: string | null;
  epithet?: string;
  memories?: MemoryEntry[];
  /** dominant belief context, optional: the spirit name they most believe in + faith
   *  level, for meaning/worship flavor. */
  faithNote?: { spiritName: string; faith: number } | null;
}

type NeedKey = keyof NpcNeeds;

/** Fixed need order — the deterministic tie-break for "which need is the driver"
 *  (mirrors `NEED_ORDER` in `src/game/affordance/whisper-card.ts:37`). */
const NEED_ORDER: readonly NeedKey[] = ['safety', 'prosperity', 'community', 'meaning'];

/** Below this a need reads as "critically low" and drives the thought (policy step 2). */
const CRITICAL_NEED = 0.3;

/** Above this mood colors the activity-flavor line as content/uneasy. */
const GOOD_MOOD = 0.6;
const BAD_MOOD = 0.4;

/** A recent, salient memory is worth surfacing verbatim (policy step 3 flavor). */
const MEMORY_SALIENCE_FLOOR = 0.5;

// ── Pleading — worship + a subject need (policy step 1) ──────────────────────
// Mirrors the register split below: a pious mortal frames the plea as devotion,
// a skeptical one as a plain, almost embarrassed ask.
const PLEA_PIOUS: Record<NeedKey, string> = {
  safety: 'Shelter us, if you are truly there.',
  prosperity: 'Fill our hands, and we will not forget it.',
  community: 'Do not let us drift apart from one another.',
  meaning: 'Show me what any of this is for.',
};
const PLEA_PLAIN: Record<NeedKey, string> = {
  safety: 'Please — just keep us safe a while longer.',
  prosperity: 'Please, something. Anything would help now.',
  community: 'I don’t know who else to ask.',
  meaning: 'I don’t know why I’m even praying.',
};

// ── Critical-need distress (policy step 2) — register keyed by piety/skepticism ──
// A pious NPC frames a lack as a TEST; a skeptical one as bad luck / the world's
// indifference; the plain register is the deterministic fallback with neither trait.
const LACK_PIOUS: Record<NeedKey, string> = {
  safety: 'This danger is a trial. I will not break.',
  prosperity: 'Hard times are a test — I will bear them.',
  community: 'Even alone, I am not forsaken.',
  meaning: 'Even the silence must mean something.',
};
const LACK_SKEPTIC: Record<NeedKey, string> = {
  safety: 'Bad luck, nothing more. Stay sharp anyway.',
  prosperity: 'Rotten luck again. No one’s watching out for me.',
  community: 'People drift. That’s just how it goes.',
  meaning: 'Meaning’s a story people tell. I stopped listening.',
};
const LACK_PLAIN: Record<NeedKey, string> = {
  safety: 'Something out there means us harm.',
  prosperity: 'The stores run thin. What will we eat?',
  community: 'No one would even notice if I were gone.',
  meaning: 'What is any of this for?',
};

// ── Activity flavor (policy step 3), split by mood ────────────────────────────
const ACTIVITY_GOOD: Record<NpcActivity, string> = {
  sleep: 'A good, deep sleep — no need to stir yet.',
  work: 'The work goes well today; my hands know it.',
  socialize: 'Good company, and the day feels lighter for it.',
  worship: 'A quiet, grateful moment before the shrine.',
  idle: 'Nothing pressing. Just the sun, and time to sit.',
  wander: 'Feet carry me where they will — no complaints.',
  patrol: 'The rounds are quiet. Long may it stay that way.',
};
const ACTIVITY_NEUTRAL: Record<NpcActivity, string> = {
  sleep: 'Sleep comes, slow and ordinary.',
  work: 'Just the work. One hand after the other.',
  socialize: 'Talk drifts by — nothing much said.',
  worship: 'Old words, said out of habit more than hope.',
  idle: 'Nothing much to do. Nothing much to want.',
  wander: 'Walking, mostly to be walking.',
  patrol: 'Round and round — the same stones as yesterday.',
};
const ACTIVITY_BAD: Record<NpcActivity, string> = {
  sleep: 'Sleep won’t settle. Too much on my mind.',
  work: 'The work drags. My heart isn’t in it today.',
  socialize: 'Even the company can’t lift this mood.',
  worship: 'I kneel, but the words feel hollow tonight.',
  idle: 'Restless. Can’t settle to anything.',
  wander: 'Walking off a bad mood, or trying to.',
  patrol: 'Every shadow looks wrong tonight.',
};

/** The most acute (lowest) need, tie-broken by `NEED_ORDER` (same rule as
 *  `dominantNeed` in `src/game/affordance/whisper-card.ts:70`). */
function dominantNeed(needs: NpcNeeds): NeedKey {
  let best: NeedKey = NEED_ORDER[0];
  for (const k of NEED_ORDER) if (needs[k] < needs[best]) best = k;
  return best;
}

/** true when personality clearly leans pious over skeptical (or vice versa);
 *  a flat/undefined personality is neither, and falls to the plain register. */
function register(personality: Personality | undefined): 'pious' | 'skeptic' | 'plain' {
  if (!personality) return 'plain';
  const { piety = 0, skepticism = 0 } = personality;
  if (piety > 0.55 && piety >= skepticism) return 'pious';
  if (skepticism > 0.55 && skepticism > piety) return 'skeptic';
  return 'plain';
}

/** The single most-salient recent memory worth surfacing, or null. Deterministic:
 *  highest salience wins, oldest tick breaks a tie (same rule as
 *  `selectMemoriesForPrompt`/`epithetFor` in `src/llm/interaction-memory.ts:106-134`). */
function mostSalientMemory(memories: MemoryEntry[] | undefined): MemoryEntry | null {
  if (!memories || memories.length === 0) return null;
  const best = memories.reduce((b, m) =>
    m.salience > b.salience || (m.salience === b.salience && m.tick < b.tick) ? m : b);
  return best.salience >= MEMORY_SALIENCE_FLOOR ? best : null;
}

/**
 * A short deterministic inner-monologue line. Pure, no rng, no side effects.
 * Always returns a non-empty readable sentence.
 *
 * Driver priority (first match wins):
 *   1. `activity === 'worship'` with a `prayerNeed` set → a pleading line about
 *      that need (register: pious/plain).
 *   2. any need critically low (< `CRITICAL_NEED`) → a distress line about the
 *      most acute one (register: pious/skeptic/plain).
 *   3. else the current `activity`, flavored by `mood` (good/neutral/bad); when a
 *      recent, high-salience memory is present its summary rides along instead of
 *      (not on top of) the plain activity line, so nothing reads padded.
 */
export function describeThought(input: ThoughtInput): string {
  const { activity, needs, mood, personality, prayerNeed } = input;

  // 1. worship + a subject need — the plea (pious devotion vs a plain, bare ask;
  //    skepticism has no separate plea register — a skeptic praying at all is
  //    already the exception, so it reads as the same bare ask as the default).
  if (activity === 'worship' && prayerNeed && prayerNeed in needs) {
    const need = prayerNeed as NeedKey;
    const table = register(personality) === 'pious' ? PLEA_PIOUS : PLEA_PLAIN;
    return table[need];
  }

  // 2. a critically low need — distress, before anything else (never sound content
  //    while starving/afraid, whatever the current activity happens to be).
  const need = dominantNeed(needs);
  if (needs[need] < CRITICAL_NEED) {
    const r = register(personality);
    const table = r === 'pious' ? LACK_PIOUS : r === 'skeptic' ? LACK_SKEPTIC : LACK_PLAIN;
    return table[need];
  }

  // 3. activity, flavored by mood; a recent salient memory overrides the plain line.
  const mem = mostSalientMemory(input.memories);
  if (mem) return `Still turning over: ${mem.summary}`;

  const m = mood ?? 0.5;
  const table = m >= GOOD_MOOD ? ACTIVITY_GOOD : m < BAD_MOOD ? ACTIVITY_BAD : ACTIVITY_NEUTRAL;
  return table[activity];
}
