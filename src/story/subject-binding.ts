/**
 * Subject binding — the pure, deterministic bridge from a beat's ThreadSubject to
 * a storylet's runtime targeting/reads.
 *
 * When Fate (or a recognizer) arms a beat "on" someone — an NPC, a settlement —
 * the played storylet's `do` effects should act on THAT subject, not on an id
 * literally baked into the pack JSON. Authors express this with a sentinel:
 *
 *   { verb: 'omen',    args: { subject: true, kind: 'clouds' } }   // preferred
 *   { verb: 'whisper', args: { npc: '$subject', tone: 'gentle' } } // equivalent
 *
 * and reads/interpolation reference a `subject`-rooted path:
 *
 *   "$subject.name"                 // say text
 *   { var: 'subject.faith' }        // guard
 *
 * This module is the fully-testable core: no RNG, no I/O, no game deps beyond the
 * ThreadSubject/CommandTarget/Effect *types*. `story-host-bus.ts` wraps its default
 * resolveTarget/read with these helpers when a subject is present, and defers to
 * the existing defaults otherwise — so behaviour is unchanged for un-subjected
 * plays (the `__debug.playStory` path, any beat without a subject).
 *
 * Scope cut (v1): effect TARGETING resolves for npc + settlement subjects;
 * spirit/site subjects resolve to `{kind:'none'}` (no command target, same as an
 * un-bound effect today). Subject READS resolve for npc subjects only; other
 * kinds return null → the caller falls through to the default read, leaving the
 * path verbatim exactly as an unknown path behaves today.
 */
import type { ThreadSubject } from '@/sim/threads/thread-types';
import type { CommandTarget } from '@/sim/command/types';
import type { Effect } from './story-ir';

/**
 * Effect-arg keys consumed by target resolution (never leaked into params/payload).
 * `subject` is the sentinel key; `npc`/`settlement` are the literal-target keys the
 * default resolver already reads. The args splitter strips all three.
 */
export const SUBJECT_ARG_KEYS: ReadonlySet<string> = new Set(['subject', 'npc', 'settlement']);

/** The authored sentinel used in a `$subject` string arg and read path root. */
const SUBJECT_SENTINEL = '$subject';
const SUBJECT_READ_ROOT = 'subject';

/**
 * Map a ThreadSubject to the CommandTarget an effect should fire on.
 *   npc        → { kind: 'npc', npcId }
 *   settlement → { kind: 'settlement', poiId }
 *   spirit/site→ { kind: 'none' }   (no command target in v1)
 */
export function subjectToTarget(subject: ThreadSubject): CommandTarget {
  switch (subject.kind) {
    case 'npc': return { kind: 'npc', npcId: subject.npcId };
    case 'settlement': return { kind: 'settlement', poiId: subject.poiId };
    // spirit / site have no divine-command target vocabulary in v1.
    default: return { kind: 'none' };
  }
}

/**
 * Does this effect want to act on the beat subject? True when the author used the
 * `subject: true` sentinel or the `npc:'$subject'` / `settlement:'$subject'` form.
 */
export function effectTargetsSubject(effect: Effect): boolean {
  const a = effect.args ?? {};
  return a.subject === true || a.npc === SUBJECT_SENTINEL || a.settlement === SUBJECT_SENTINEL;
}

/**
 * Rewrite a `subject`-rooted read path to a concrete rooted path the default read
 * resolver understands, or null when the path is not subject-rooted / the subject
 * kind is unsupported (v1: npc only).
 *
 *   'subject.<field>' , npc subject → 'npc.<npcId>.<field>'
 *
 * Non-`subject` roots return null (the caller uses the original path). Non-npc
 * subjects return null (the caller falls through to the default read, which leaves
 * the unknown `subject.*` path resolving to undefined — same as today).
 */
export function rewriteSubjectReadPath(path: string, subject: ThreadSubject): string | null {
  const dot = path.indexOf('.');
  const root = dot === -1 ? path : path.slice(0, dot);
  if (root !== SUBJECT_READ_ROOT) return null;
  if (subject.kind !== 'npc') return null;
  const rest = dot === -1 ? '' : path.slice(dot + 1);
  // subject.<field> → npc.<npcId>.<field>  (bare 'subject' → npc.<npcId>)
  return rest ? `npc.${subject.npcId}.${rest}` : `npc.${subject.npcId}`;
}
