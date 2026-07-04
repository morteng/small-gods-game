/**
 * system-state.ts — the scrub-ghost reset pattern (Round 7 WP-D).
 *
 * Some tick systems keep internal state that is SIM TRUTH but lives outside the
 * entity/spirit world: cooldown deadlines, threshold edge-detection sides,
 * ever-believed history. Snapshots that don't carry this state leave "ghosts":
 * a committed scrubbed timeline inherits eligibility/edge state from the
 * DISCARDED future, silently suppressing (or double-firing) state-mutating
 * events.
 *
 * The pattern: a stateful system implements `serialize()/hydrate()` and is
 * registered here (in addition to the Scheduler). The registry rides on
 * `GameState.systemState`; `captureSnapshot`/`restoreSnapshot` are the single
 * choke point that drives it, so timeline scrub/commit AND save-file load all
 * restore system state uniformly. `hydrate(undefined)` — an old save or a
 * hand-built snapshot with no `systems` field — MUST reset the system to its
 * initial state (never throw).
 */

export interface SerializableSystem {
  /** Stable snapshot key. Reuse the Scheduler `System.name`. */
  readonly name: string;
  /** JSON-cloneable dump of internal state (fresh objects, no live refs). */
  serialize(): unknown;
  /** Restore from a dump. `undefined` (absent field / old save) = full reset. */
  hydrate(state: unknown): void;
}

export class SystemStateRegistry {
  private systems = new Map<string, SerializableSystem>();

  register(s: SerializableSystem): void {
    if (this.systems.has(s.name)) {
      throw new Error(`SystemStateRegistry: already registered: ${s.name}`);
    }
    this.systems.set(s.name, s);
  }

  /** One JSON-cloneable dict keyed by system name. Cloned here so a system
   *  returning a live reference can never alias snapshot state. */
  serialize(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, s] of this.systems) out[name] = structuredClone(s.serialize());
    return out;
  }

  /** Hydrate EVERY registered system: present key → restore, absent key /
   *  absent dict → reset. Cloned per-system so repeated restores of the same
   *  snapshot can never see mutations from a previous hydration. */
  hydrate(states: Record<string, unknown> | undefined): void {
    for (const [name, s] of this.systems) {
      const st = states?.[name];
      s.hydrate(st === undefined ? undefined : structuredClone(st));
    }
  }

  /** Registered system count (introspection/tests). */
  size(): number { return this.systems.size; }
}
