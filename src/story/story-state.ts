/**
 * Story scope + host bridge.
 *
 * `Scope` is the flat, dotted-key field store the interpreter reads and writes
 * (`elder.faith`, `omenSent`, …). Reads fall through to the host for paths the
 * scope doesn't hold, so a storylet guard can consult live sim state
 * (`world.year`, `npc.elder.faith`) without the scope owning a copy. WRITES only
 * ever land in the scope map — world mutation flows through effects/commands,
 * never direct field writes, preserving the World dual-index + determinism rules.
 */
import type { Value, Effect } from './story-ir';

/** The narrow seam the engine needs from the game (bus-backed in production). */
export interface StoryHost {
  /** Resolve a field the scope doesn't hold, e.g. "world.year". Pure read. */
  read?(path: string): Value | undefined;
  /** Dispatch an effect onto the command bus. */
  dispatch(effect: Effect): void;
}

/** A read-only view handed to AI directors so they can condition on state. */
export interface ReadonlyScope {
  get(path: string): Value | undefined;
  has(path: string): boolean;
}

export class Scope implements ReadonlyScope {
  private readonly map = new Map<string, Value>();

  constructor(
    private readonly host?: StoryHost,
    init?: Record<string, Value>,
  ) {
    if (init) for (const [k, v] of Object.entries(init)) this.map.set(k, v);
  }

  get(path: string): Value | undefined {
    if (this.map.has(path)) return this.map.get(path);
    return this.host?.read?.(path);
  }

  has(path: string): boolean {
    return this.map.has(path) || this.host?.read?.(path) !== undefined;
  }

  set(path: string, value: Value): void {
    this.map.set(path, value);
  }

  /** Seed a field only if neither scope nor host already provides it. */
  initIfAbsent(path: string, value: Value): void {
    if (!this.map.has(path) && this.host?.read?.(path) === undefined) {
      this.map.set(path, value);
    }
  }

  /** Serializable snapshot of the locally-owned fields (host reads excluded). */
  snapshot(): Record<string, Value> {
    return Object.fromEntries(this.map);
  }

  static restore(data: Record<string, Value>, host?: StoryHost): Scope {
    return new Scope(host, data);
  }
}
