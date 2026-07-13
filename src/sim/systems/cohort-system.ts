import type { System, SystemContext } from '@/core/scheduler';
import type { SerializableSystem } from '@/core/system-state';
import type { EntityId } from '@/core/types';
import { GAME_HOUR_HZ } from '@/core/calendar';
import { NPC_KIND, REMAINS_KIND } from '@/world/npc-helpers';
import {
  censusCohorts, cohortPopulation,
  type SettlementCohorts,
} from '@/sim/cohorts';

/** Conservation-of-souls flow counters, cumulative since the last (re)census. */
export interface CohortLedgerCounters {
  births: number;
  deaths: number;
  /** Living souls whose bucket (homePoiId) changed between checks. */
  migrations: number;
  /** Souls that left the registry entirely (authored_remove) — a sink outside
   *  the fiction, ledgered separately from deaths (which leave remains). */
  removals: number;
  /** Conservation violations detected (each also appends a system_error). */
  violations: number;
}

/**
 * Two-tier population P0 — SHADOW BOOKKEEPING. Once per game hour (the day-keyed
 * lifecycle cadence of MortalitySystem/BirthSystem), census the living named
 * population into per-settlement age-band cohorts and audit conservation of
 * souls: per-bucket totals may evolve ONLY by births − deaths ± migration
 * (removals ledgered separately), and every structural flow must be explained
 * by a lifecycle event (npc_birth/npc_death/npc_spawn/authored_*). A code path
 * that mints or vanishes souls outside those seams trips a `system_error` —
 * the executable form of the epic's "houses never create people" invariant.
 *
 * ZERO gameplay effect: reads the world + event log, writes only its own state
 * (and the diagnostic event on violation). No rng. Later slices (P1+) grow this
 * into the live statistical tier the belief economy reads.
 */
export class CohortSystem implements System, SerializableSystem {
  readonly name = 'cohorts';
  readonly tickHz = GAME_HOUR_HZ;

  /** null = uninitialized → the next tick censuses a fresh baseline. */
  private cohorts: Map<string, SettlementCohorts> | null = null;
  /** Living named soul → bucket at the last check (the structural-diff basis). */
  private known = new Map<EntityId, string>();
  /** Event-log watermark for the flow-explanation cross-check. */
  private cursor = 0;
  private counters: CohortLedgerCounters = {
    births: 0, deaths: 0, migrations: 0, removals: 0, violations: 0,
  };

  /** WP-D scrub-ghost pattern: the ledger is HISTORY (baseline census, flow
   *  counters, log watermark) — a scrub-back must restore the baseline the
   *  discarded future diffed against, or the first post-restore check would
   *  mis-ledger every re-rolled birth/death. Absent field (old save) → reset,
   *  which re-censuses on the next tick: rebuild-on-load, no SAVE_VERSION bump. */
  serialize(): unknown {
    return {
      cohorts: this.cohorts
        ? [...this.cohorts.keys()].sort().map(k => structuredClone(this.cohorts!.get(k)!))
        : null,
      known: [...this.known.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      cursor: this.cursor,
      counters: { ...this.counters },
    };
  }

  hydrate(state: unknown): void {
    this.cohorts = null;
    this.known = new Map();
    this.cursor = 0;
    this.counters = { births: 0, deaths: 0, migrations: 0, removals: 0, violations: 0 };
    const s = state as {
      cohorts?: unknown; known?: unknown; cursor?: unknown; counters?: unknown;
    } | undefined;
    if (!s) return;
    if (Array.isArray(s.cohorts)) {
      this.cohorts = new Map();
      for (const sc of s.cohorts as SettlementCohorts[]) {
        if (sc && typeof sc.poiId === 'string' && Array.isArray(sc.bands)) {
          this.cohorts.set(sc.poiId, sc);
        }
      }
    }
    if (Array.isArray(s.known)) {
      for (const entry of s.known) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
          this.known.set(entry[0], entry[1]);
        }
      }
    }
    if (typeof s.cursor === 'number') this.cursor = s.cursor;
    const c = s.counters as Partial<CohortLedgerCounters> | undefined;
    if (c) {
      this.counters = {
        births: c.births ?? 0, deaths: c.deaths ?? 0, migrations: c.migrations ?? 0,
        removals: c.removals ?? 0, violations: c.violations ?? 0,
      };
    }
  }

  /** Read-only view for tests / the dev census readout. */
  cohortsByPoi(): ReadonlyMap<string, SettlementCohorts> {
    return this.cohorts ?? new Map();
  }

  ledgerCounters(): Readonly<CohortLedgerCounters> {
    return this.counters;
  }

  tick(ctx: SystemContext): void {
    const { cohorts: census, homes: living } = censusCohorts(ctx.world, ctx.now);

    // Lifecycle events since the last check, for the flow-explanation audit.
    // SilentEventLog (replay) yields nothing AND size() 0, so the explanation
    // check self-disables during replay — the structural ledger still runs.
    const window = ctx.log.since(this.cursor);
    for (const e of window) if (e.id > this.cursor) this.cursor = e.id;

    if (this.cohorts === null) {
      // Initialize by census (world gen / save load / post-reset baseline).
      this.cohorts = census;
      this.known = living;
      return;
    }

    // ── Structural diff: births / deaths / removals / migrations by entity id ──
    const births: EntityId[] = [];
    const deaths: EntityId[] = [];
    const removals: EntityId[] = [];
    let migrations = 0;
    const flow = new Map<string, number>(); // bucket → net souls this window
    const bump = (poi: string, d: number) => flow.set(poi, (flow.get(poi) ?? 0) + d);

    for (const [id, poi] of living) {
      const prev = this.known.get(id);
      if (prev === undefined) { births.push(id); bump(poi, +1); }
      else if (prev !== poi) { migrations++; bump(prev, -1); bump(poi, +1); }
    }
    for (const [id, poi] of this.known) {
      if (living.has(id)) continue;
      const e = ctx.world.registry.get(id);
      if (e && e.kind === REMAINS_KIND) deaths.push(id);
      else if (!e || e.kind !== NPC_KIND) removals.push(id);
      bump(poi, -1);
    }

    // ── Invariant: per-bucket totals evolve only by the ledgered flows ──
    const buckets = new Set([...this.cohorts.keys(), ...census.keys(), ...flow.keys()]);
    for (const poi of [...buckets].sort()) {
      const expected = (this.cohorts.get(poi) ? cohortPopulation(this.cohorts.get(poi)!) : 0)
        + (flow.get(poi) ?? 0);
      const actual = census.get(poi) ? cohortPopulation(census.get(poi)!) : 0;
      if (expected !== actual) {
        this.violate(ctx, `bucket '${poi}' expected ${expected} souls (births−deaths±migration), censused ${actual}`);
      }
    }

    // ── Flow explanation: every structural flow must trace to a lifecycle event.
    // Skipped when the log is empty: a real log always holds the very events
    // these flows emit (birthNpc/killNpc append), so empty ⇒ SilentEventLog.
    if (ctx.log.size() > 0) {
      const born = new Set<EntityId>();
      const died = new Set<EntityId>();
      const removed = new Set<EntityId>();
      for (const { event } of window) {
        if (event.type === 'npc_birth' || event.type === 'npc_spawn') born.add(event.npcId);
        else if (event.type === 'npc_death') died.add(event.npcId);
        else if (event.type === 'authored_spawn' || event.type === 'authored_place') {
          for (const id of event.entityIds) born.add(id);
        } else if (event.type === 'authored_remove') {
          for (const id of event.entityIds) removed.add(id);
        }
      }
      const orphanBirths = births.filter(id => !born.has(id));
      const orphanDeaths = deaths.filter(id => !died.has(id));
      const orphanRemovals = removals.filter(id => !removed.has(id));
      if (orphanBirths.length > 0) {
        this.violate(ctx, `${orphanBirths.length} soul(s) appeared without a birth/spawn event: ${orphanBirths.slice(0, 3).join(', ')}`);
      }
      if (orphanDeaths.length > 0) {
        this.violate(ctx, `${orphanDeaths.length} soul(s) became remains without an npc_death event: ${orphanDeaths.slice(0, 3).join(', ')}`);
      }
      if (orphanRemovals.length > 0) {
        this.violate(ctx, `${orphanRemovals.length} soul(s) vanished without an authored_remove event: ${orphanRemovals.slice(0, 3).join(', ')}`);
      }
    }

    this.counters.births += births.length;
    this.counters.deaths += deaths.length;
    this.counters.migrations += migrations;
    this.counters.removals += removals.length;

    // Adopt the census: the shadow ledger tracks the named tier exactly (counts,
    // aging drift between bands, belief sums) — self-healing after a violation.
    this.cohorts = census;
    this.known = living;
  }

  private violate(ctx: SystemContext, detail: string): void {
    this.counters.violations++;
    ctx.log.append({
      type: 'system_error', system: this.name,
      message: `conservation of souls violated: ${detail}`,
    });
  }
}
