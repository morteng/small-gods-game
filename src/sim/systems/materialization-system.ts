/**
 * MaterializationSystem (P2 living-population, slice 1 — RESIDENTS ONLY).
 *
 * A tickHz-4 reconcile controller: when the player FOCUSES a settlement (zoom
 * band `settlement`/`soul` with a poiId), it draws that town's statistical
 * cohort souls into real `kind:'npc'` World entities so up to MATERIALIZE_CAP
 * townsfolk walk out of their homes; when focus leaves, it banks them back into
 * the cohort (conservation-exact). Because the extras are real npc entities with
 * a home + role, the shipped NpcActivitySystem/NpcMovementSystem drive their
 * home↔sleep loop for FREE — this system never touches them.
 *
 * CONSERVATION: materialize = `drawCohortSouls` (removeSoul + drawCount++ per
 * soul, exact running-sum subtraction) → create named entity carrying the soul.
 * Fold = read the entity's CURRENT observation (belief may have drifted) →
 * `addSoul` back → remove the entity. Per settlement the combined named+stat
 * count is invariant across a materialize/fold cycle; CohortSystem's audit is
 * relaxed (same commit) to recognise souls_materialized/souls_folded as
 * ledgered flows.
 *
 * DETERMINISM: no Math.random, no ctx.rng. Band allocation is the deterministic
 * largest-remainder `apportion` inside `drawCohortSouls`; each extra's id is
 * minted from the monotonic `sc.drawCount` (`${poiId}-mat-${drawCount}`), so a
 * replay that reaches the same cohort state mints the same souls. Focus is
 * per-session VIEW state (never snapshotted): a headless SilentEventLog replay
 * sees focus=null and materializes nothing; the world snapshot carries any live
 * extras and this system re-adopts them from `materializedTemp` on hydrate.
 */

import type { System, SystemContext } from '@/core/scheduler';
import type { SerializableSystem } from '@/core/system-state';
import type { NpcRole, GameMap, EntityId, NpcProperties } from '@/core/types';
import type { ZoomBand } from '@/game/affordance/zoom-band';
import type { SettlementCohorts } from '@/sim/cohorts';
import {
  cohortPopulation, addSoul, drawCohortSouls, bandIndexForAge,
} from '@/sim/cohorts';
import {
  foldObservation, residentCapacityForPoi, residentSlots, homeTileFor,
  workplaceSlots, workTileFor, type MaterializedRef,
} from '@/sim/materialization';
import { initNpcProps, queryNpcs, npcProps, NPC_KIND } from '@/world/npc-helpers';
import { snapToLand } from '@/world/land-snap';
import { TICKS_PER_YEAR, ageInYears } from '@/sim/mortality';

/** Max simultaneously-materialized extras per settlement. */
export const MATERIALIZE_CAP = 64;
/** Spawn/fold ops per tick — caps the frame cost of a settlement snap-in. */
export const RECONCILE_BUDGET = 8;
/** Focus must persist this many sim ticks before spawning (anti-jitter). */
export const MATERIALIZE_DWELL_TICKS = 30;
/** Extras linger this many sim ticks after focus leaves before folding. */
export const FOLD_LINGER_TICKS = 240;

const MAT_NAMES = ['Ada', 'Ceol', 'Edda', 'Godric', 'Hilda', 'Ivo', 'Leof', 'Maud', 'Osric', 'Wynn'];

/** Same 31-mul hash the spawner mints seeds with (placement parity). */
function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Role by age band — child / elder / working. Deliberately never `noble` or
 *  `soldier`, so extras never perturb LordSystem's lord/garrison picks. */
function roleForAge(age: number, seed: number): NpcRole {
  if (age < 15) return 'child';
  if (age >= 60) return 'elder';
  return (seed & 1) === 0 ? 'farmer' : 'merchant';
}

/** The working-age roles roleForAge mints — the ones that commute to a workplace
 *  (children wander, elders idle). Kept local; must agree with roleForAge. */
function isWorkingRole(role: NpcRole): boolean {
  return role === 'farmer' || role === 'merchant';
}

export class MaterializationSystem implements System, SerializableSystem {
  readonly name = 'materialization';
  readonly tickHz = 4;

  private live = new Map<EntityId, MaterializedRef>();
  private activePoi: string | null = null;
  private pendingPoi: string | null = null;
  private pendingSince = 0;
  private leftSince: number | null = null;
  /** Set after construct/hydrate → next tick rebuilds `live` from the world's
   *  materializedTemp entities (rebuild-on-load / scrub-restore adoption). */
  private needsAdopt = true;

  constructor(
    private readonly getCohorts: () => ReadonlyMap<string, SettlementCohorts> | null | undefined,
    private readonly getMap: () => GameMap | null | undefined,
    private readonly focusView: () => { poiId: string | null; band: ZoomBand },
  ) {}

  tick(ctx: SystemContext): void {
    const cohorts = this.getCohorts();
    const map = this.getMap();
    if (!cohorts || !map) return;

    if (this.needsAdopt) { this.adoptFromWorld(ctx); this.needsAdopt = false; }
    else this.pruneDead(ctx);

    const { poiId, band } = this.focusView();
    const desired = (band === 'settlement' || band === 'soul') && poiId ? poiId : null;

    let budget = RECONCILE_BUDGET;
    const materialized = new Map<string, EntityId[]>();
    const folded = new Map<string, EntityId[]>();

    if (desired !== null && desired === this.activePoi) {
      // Steady focus on the active settlement → converge toward its target.
      this.leftSince = null;
      this.pendingPoi = null;
      budget = this.reconcile(ctx, this.activePoi, budget, materialized, folded);
    } else {
      // Focus differs from (or left) the active settlement.
      if (this.activePoi !== null) {
        if (this.leftSince === null) this.leftSince = ctx.now;
        if (ctx.now - this.leftSince >= FOLD_LINGER_TICKS) {
          budget = this.foldN(ctx, this.activePoi, this.liveCount(this.activePoi), budget, folded);
          if (this.liveCount(this.activePoi) === 0) { this.activePoi = null; this.leftSince = null; }
        }
      }
      if (this.activePoi === null && desired !== null && budget > 0) {
        if (this.pendingPoi !== desired) { this.pendingPoi = desired; this.pendingSince = ctx.now; }
        if (ctx.now - this.pendingSince >= MATERIALIZE_DWELL_TICKS) {
          this.activePoi = desired;
          this.pendingPoi = null;
          this.leftSince = null;
          budget = this.reconcile(ctx, this.activePoi, budget, materialized, folded);
        }
      } else if (desired === null) {
        this.pendingPoi = null;
      }
    }

    for (const [poi, ids] of materialized) {
      if (ids.length) ctx.log.append({ type: 'souls_materialized', poiId: poi, entityIds: ids, count: ids.length });
    }
    for (const [poi, ids] of folded) {
      if (ids.length) ctx.log.append({ type: 'souls_folded', poiId: poi, entityIds: ids, count: ids.length });
    }
  }

  // ── reconcile ──────────────────────────────────────────────────────────────

  /** Step the live extra set at `poi` toward its target, within `budget`. */
  private reconcile(
    ctx: SystemContext, poi: string, budget: number,
    materialized: Map<string, EntityId[]>, folded: Map<string, EntityId[]>,
  ): number {
    const sc = this.getCohorts()?.get(poi);
    const map = this.getMap();
    if (!sc || !map) return budget;

    const live = this.liveCount(poi);
    const sTotal = cohortPopulation(sc) + live;              // conserved total (invariant)
    const named = this.namedResidents(ctx, poi);
    const cap = Math.max(0, residentCapacityForPoi(map, poi) - named);
    const target = Math.max(0, Math.min(MATERIALIZE_CAP, cap, sTotal));

    if (target > live) return this.spawnN(ctx, poi, target - live, budget, materialized);
    if (target < live) return this.foldN(ctx, poi, live - target, budget, folded);
    return budget;
  }

  /** Materialize up to `n` extras at `poi` (budget-limited). */
  private spawnN(
    ctx: SystemContext, poi: string, n: number, budget: number,
    materialized: Map<string, EntityId[]>,
  ): number {
    const sc = this.getCohorts()?.get(poi);
    const map = this.getMap();
    if (!sc || !map) return budget;

    const start = this.liveCount(poi);
    const total = start + n;
    const slots = residentSlots(map, poi, total);       // ordered home slots [0..total)
    const jobs = workplaceSlots(map, poi, total);        // ordered job slots [0..total) (slice 2)
    let made = 0;
    while (made < n && budget > 0) {
      const drawIndex = sc.drawCount;                    // id anchor (pre-bump)
      const [obs] = drawCohortSouls(sc, 1);              // removeSoul + drawCount++
      if (!obs) break;                                   // cohort exhausted
      const id = `${poi}-mat-${drawIndex}`;
      const seed = hashId(id);
      const idx = start + made;                          // stable materialization index
      const slot = slots[idx] ?? slots[slots.length - 1];
      const home = slot
        ? homeTileFor(slot, map)
        : this.poiFallbackTile(ctx, poi, map, seed);

      const role = roleForAge(obs.age, seed);
      const props = initNpcProps(MAT_NAMES[seed % MAT_NAMES.length], role, seed);
      props.beliefs = obs.beliefs;                       // already a fresh clone
      props.needs = obs.needs;
      props.birthTick = ctx.now - Math.round(obs.age * TICKS_PER_YEAR);
      props.homePoiId = poi;
      props.homeBuildingId = slot?.buildingId;
      props.homeX = home.x;
      props.homeY = home.y;
      // Slice 2: a working-age extra with a job commutes there by day. Index-
      // driven (jobs[idx]) so the assignment is fold-stable and rng-free; extras
      // past the job count (or in a workless hamlet) work from home.
      if (isWorkingRole(role)) {
        const job = jobs[idx];
        if (job) { const t = workTileFor(job, map); props.workX = t.x; props.workY = t.y; }
      }
      props.materializedTemp = true;
      props.lineageId = id;
      props.parentIds = [];

      ctx.world.addEntity({ id, kind: NPC_KIND, x: home.x, y: home.y, properties: props as unknown as Record<string, unknown> });
      this.live.set(id, { id, poiId: poi, bandIndex: bandIndexForAge(obs.age) });
      (materialized.get(poi) ?? materialized.set(poi, []).get(poi)!).push(id);
      made++;
      budget--;
    }
    return budget;
  }

  /** Fold up to `n` of `poi`'s extras back into the cohort (LIFO), budget-limited. */
  private foldN(
    ctx: SystemContext, poi: string, n: number, budget: number,
    folded: Map<string, EntityId[]>,
  ): number {
    if (n <= 0) return budget;
    const sc = this.getCohorts()?.get(poi);
    // Most-recently materialized first (LIFO) for stable slot indices.
    const refs = [...this.live.values()].filter(r => r.poiId === poi).reverse();
    let done = 0;
    for (const ref of refs) {
      if (done >= n || budget <= 0) break;
      const e = ctx.world.registry.get(ref.id);
      if (e && e.kind === NPC_KIND && sc) {
        addSoul(sc, foldObservation(e, ctx.now));        // bank the (possibly drifted) soul
        ctx.world.removeEntity(ref.id);
      } else if (e) {
        // Entity mutated out of npc (shouldn't happen — extras are excluded from
        // mortality); drop it without double-banking.
        ctx.world.removeEntity(ref.id);
      }
      this.live.delete(ref.id);
      (folded.get(poi) ?? folded.set(poi, []).get(poi)!).push(ref.id);
      done++;
      budget--;
    }
    return budget;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private liveCount(poi: string): number {
    let n = 0;
    for (const r of this.live.values()) if (r.poiId === poi) n++;
    return n;
  }

  /** Permanent (non-materialized) named residents homed at `poi`. */
  private namedResidents(ctx: SystemContext, poi: string): number {
    let n = 0;
    for (const e of queryNpcs(ctx.world)) {
      const p = npcProps(e);
      if (p.homePoiId === poi && p.materializedTemp !== true) n++;
    }
    return n;
  }

  /** POI-centred jittered land tile — the spawner's fallback when a building has
   *  no resolvable door. Deterministic from the entity seed. */
  private poiFallbackTile(ctx: SystemContext, poi: string, map: GameMap, seed: number): { x: number; y: number } {
    const p = map.worldSeed?.pois?.find(q => q.id === poi)?.position;
    const px = p?.x ?? 0, py = p?.y ?? 0;
    void ctx;
    return snapToLand(map,
      Math.max(0, Math.min(map.width - 1, px + (seed % 3) - 1)),
      Math.max(0, Math.min(map.height - 1, py + ((seed >> 2) % 3) - 1)));
  }

  /** Rebuild `live` from the world's materializedTemp entities (rebuild-on-load
   *  / scrub-restore). Resumes `activePoi` on the settlement holding them. */
  private adoptFromWorld(ctx: SystemContext): void {
    this.live.clear();
    let adoptedPoi: string | null = null;
    for (const e of queryNpcs(ctx.world)) {
      const p = npcProps(e) as NpcProperties;
      if (p.materializedTemp !== true || !p.homePoiId) continue;
      this.live.set(e.id, {
        id: e.id, poiId: p.homePoiId,
        bandIndex: bandIndexForAge(ageInYears(p.birthTick, ctx.now)),
      });
      if (adoptedPoi === null || p.homePoiId < adoptedPoi) adoptedPoi = p.homePoiId;
    }
    // If the serialized activePoi no longer holds extras, adopt the one the world
    // actually carries so reconcile/fold can resume.
    if (adoptedPoi !== null && this.liveCount(this.activePoi ?? '') === 0) this.activePoi = adoptedPoi;
  }

  /** Drop refs whose entity vanished outside this system (defensive). */
  private pruneDead(ctx: SystemContext): void {
    for (const id of [...this.live.keys()]) {
      const e = ctx.world.registry.get(id);
      if (!e || e.kind !== NPC_KIND) this.live.delete(id);
    }
  }

  // ── snapshot (WP-D) ─────────────────────────────────────────────────────────
  // The extras themselves ride the WORLD snapshot; here we persist only the
  // hysteresis state, and rebuild `live` from materializedTemp on hydrate.
  serialize(): unknown {
    return {
      activePoi: this.activePoi,
      pendingPoi: this.pendingPoi,
      pendingSince: this.pendingSince,
      leftSince: this.leftSince,
    };
  }

  hydrate(state: unknown): void {
    this.live = new Map();
    this.activePoi = null;
    this.pendingPoi = null;
    this.pendingSince = 0;
    this.leftSince = null;
    this.needsAdopt = true;
    const s = state as {
      activePoi?: unknown; pendingPoi?: unknown; pendingSince?: unknown; leftSince?: unknown;
    } | undefined;
    if (!s) return;
    if (typeof s.activePoi === 'string') this.activePoi = s.activePoi;
    if (typeof s.pendingPoi === 'string') this.pendingPoi = s.pendingPoi;
    if (typeof s.pendingSince === 'number') this.pendingSince = s.pendingSince;
    if (typeof s.leftSince === 'number') this.leftSince = s.leftSince;
  }

  /** Read-only view for tests / dev readouts. */
  liveRefs(): ReadonlyMap<EntityId, MaterializedRef> {
    return this.live;
  }
}
