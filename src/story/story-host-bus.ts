/**
 * Bus-backed StoryHost — the runtime bridge between a storylet and the live game.
 *
 *  - `dispatch(effect)` maps a `StoryEffect` onto a real `Command` and emits it on
 *    the GameBus, so authored `do` nodes are genuine divine/authoring actions that
 *    inherit the bus's validation, gating, ordering and replay. Because the bus
 *    only exposes REGISTERED capabilities, this is also the sandbox boundary for
 *    user-authored packs (pair with `validatePack(pack, { allowedVerbs })`).
 *  - `read(path)` resolves storylet guards against live read-only query state
 *    (`npc.<id>.faith`, `belief.power`, `world.tick`, …) without the scope owning
 *    a copy — so an agent can gate a beat on the actual world.
 *
 * Effect→Command arg convention (keeps authored JSON declarative):
 *   { verb, args: { npc: "<id>" | settlement: "<poiId>", ...rest } }
 *     · `npc` / `settlement`  → the Command target
 *     · primitive rest        → `params`
 *     · object/array rest     → `payload`
 *   `source` is supplied by config (the acting spirit; 'fate' for Fate-authored).
 */
import type { GameBus } from '@/game/game-bus';
import type { Command, CommandVerb, CommandTarget } from '@/sim/command/types';
import type { SpiritId } from '@/core/spirit';
import type { ThreadSubject } from '@/sim/threads/thread-types';
import type { Value, Effect } from './story-ir';
import type { StoryHost } from './story-state';
import {
  SUBJECT_ARG_KEYS, effectTargetsSubject, subjectToTarget, rewriteSubjectReadPath,
} from './subject-binding';

export interface BusHostConfig {
  /** Who the authored effects act as. */
  source: SpiritId;
  /** Override target resolution; default reads args.npc / args.settlement. */
  resolveTarget?: (effect: Effect) => CommandTarget;
  /** Override read resolution; default walks the query facade (see below). */
  read?: (path: string) => Value | undefined;
  /**
   * The beat subject this storylet was armed on, if any. When present, effects
   * flagged with the `$subject`/`subject:true` sentinel resolve their target to
   * this subject, and `subject.<field>` read paths rewrite to it — see
   * subject-binding.ts. Absent → behaviour is identical to before (the
   * `__debug.playStory` path and any un-subjected beat).
   */
  subject?: ThreadSubject;
}

/** The set of verbs the bus will actually accept — feed to the validator. */
export function busAllowedVerbs(bus: GameBus): Set<string> {
  return new Set(bus.capabilities().map((c) => c.verb));
}

export function createBusStoryHost(bus: GameBus, config: BusHostConfig): StoryHost {
  const allowed = busAllowedVerbs(bus);

  const baseResolveTarget = config.resolveTarget ?? ((e: Effect): CommandTarget => {
    const a = e.args ?? {};
    if (typeof a.npc === 'string') return { kind: 'npc', npcId: a.npc };
    if (typeof a.settlement === 'string') return { kind: 'settlement', poiId: a.settlement };
    return { kind: 'none' };
  });

  const baseRead = config.read ?? ((path: string) => defaultRead(bus, path));

  // Wrap (never replace) the defaults with the subject binding when a beat armed
  // this storylet on a subject. Absent subject ⇒ the base fns pass straight through.
  const subject = config.subject;
  const resolveTarget = subject
    ? (e: Effect): CommandTarget =>
        effectTargetsSubject(e) ? subjectToTarget(subject) : baseResolveTarget(e)
    : baseResolveTarget;

  const read = subject
    ? (path: string): Value | undefined => baseRead(rewriteSubjectReadPath(path, subject) ?? path)
    : baseRead;

  return {
    read,
    dispatch(effect: Effect): void {
      // Runtime sandbox check — a validated pack never trips this, but a
      // dynamically-authored effect might. Drop rather than throw mid-story.
      if (!allowed.has(effect.verb)) return;
      const { params, payload } = splitArgs(effect.args ?? {});
      const cmd: Omit<Command, 'seq'> = {
        verb: effect.verb as CommandVerb,
        source: config.source,
        target: resolveTarget(effect),
        ...(params && { params }),
        ...(payload && { payload }),
      };
      bus.emit(cmd);
    },
  };
}

/** Partition effect args (minus target keys) into primitive params vs object payload. */
function splitArgs(args: Record<string, unknown>): {
  params?: Record<string, number | string>;
  payload?: Record<string, unknown>;
} {
  let params: Record<string, number | string> | undefined;
  let payload: Record<string, unknown> | undefined;
  for (const [k, v] of Object.entries(args)) {
    if (SUBJECT_ARG_KEYS.has(k)) continue; // consumed by the target (npc/settlement/subject sentinel)
    if (typeof v === 'number' || typeof v === 'string') (params ??= {})[k] = v;
    else if (v !== undefined) (payload ??= {})[k] = v;
  }
  return { params, payload };
}

/**
 * Default read resolver: dotted paths over the read-only query facade.
 *   npc.<id>.<field>     → query.npc(id)[field]
 *   belief.<field>       → query.beliefState()[field]   (power, believers, …)
 *   world.tick           → timeline current tick
 *   world.<field>        → query.worldSummary()[field]
 * Returns only primitive Values (object hops are walked, leaves coerced).
 */
function defaultRead(bus: GameBus, path: string): Value | undefined {
  const [root, ...rest] = path.split('.');
  const q = bus.query;
  switch (root) {
    case 'npc': {
      const id = rest[0];
      if (!id) return undefined;
      return deepPrimitive(q.npc(id), rest.slice(1));
    }
    case 'belief':
    case 'spirit':
      return deepPrimitive(q.beliefState(), rest);
    case 'world': {
      if (rest[0] === 'tick') return q.timeline().currentTick;
      return deepPrimitive(q.worldSummary(), rest);
    }
    default:
      return undefined;
  }
}

function deepPrimitive(obj: unknown, keys: string[]): Value | undefined {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  if (cur === null) return null;
  if (typeof cur === 'string' || typeof cur === 'number' || typeof cur === 'boolean') return cur;
  return undefined;
}
