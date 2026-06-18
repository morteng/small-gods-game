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
import type { Value, Effect } from './story-ir';
import type { StoryHost } from './story-state';

export interface BusHostConfig {
  /** Who the authored effects act as. */
  source: SpiritId;
  /** Override target resolution; default reads args.npc / args.settlement. */
  resolveTarget?: (effect: Effect) => CommandTarget;
  /** Override read resolution; default walks the query facade (see below). */
  read?: (path: string) => Value | undefined;
}

/** The set of verbs the bus will actually accept — feed to the validator. */
export function busAllowedVerbs(bus: GameBus): Set<string> {
  return new Set(bus.capabilities().map((c) => c.verb));
}

export function createBusStoryHost(bus: GameBus, config: BusHostConfig): StoryHost {
  const allowed = busAllowedVerbs(bus);

  const resolveTarget = config.resolveTarget ?? ((e: Effect): CommandTarget => {
    const a = e.args ?? {};
    if (typeof a.npc === 'string') return { kind: 'npc', npcId: a.npc };
    if (typeof a.settlement === 'string') return { kind: 'settlement', poiId: a.settlement };
    return { kind: 'none' };
  });

  const read = config.read ?? ((path: string) => defaultRead(bus, path));

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
    if (k === 'npc' || k === 'settlement') continue; // consumed by the target
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
