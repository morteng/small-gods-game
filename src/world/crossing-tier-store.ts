// src/world/crossing-tier-store.ts
//
// Road-wear economy S3 — the CROSSING TIER STORE: runtime crossing upgrades as the
// SECOND consumer of the snapshot-authoritative store pattern (`RuntimePoiStore` is the
// first; per its header rule a second owner system JOINS the established reconcile
// pattern rather than inventing a parallel one).
//
// What it owns: every crossing whose BUILT structure deviates from the gen-time pick —
// a span upgraded past what worldgen raised (`bridgeClassFor` at gen is UNCHANGED, spec
// §4: the store records deviations only, no WCV bump), and the tier-0 log a promoted
// trample corridor earns pre-adoption (§9 decision 4 — the epic's founding image: the
// humble trail gets its strategically-placed log without waiting for graph membership).
//
// Rules (spec §4 + §9):
//  1. ONE statistic, one more consumer. The earned tier is `tierForUse(edge.use.ema01,
//     class, wealth)` — the same number the class ladder reads — stepped through the
//     SAME promote-fast hysteresis (`stepCrossing`, N_UP sustained applies) at the SAME
//     year-pass cadence. No forked thresholds.
//  2. NEVER physically un-builds. The built tier is monotonic non-decreasing; a demoted
//     road keeps its stone bridge (it just stops being maintained — the existing
//     condition/overgrowth economy). There is no down-streak at all.
//  3. SNAPSHOT-AUTHORITATIVE. `serialize`/`hydrate` ride the Snapshot (optional
//     `crossingTiers?`, no SAVE_VERSION bump); span ENTITIES ride `Snapshot.entities`
//     as every entity does, so a scrub already restores the right structures —
//     `reconcileCrossingTiers` is the idempotent belt-and-braces pass that repairs any
//     store↔entity divergence (a stale save) and evicts orphaned store spans.
//  4. DETERMINISTIC. Entity identity is stable (`crossing-tier:<crossingId>`), variety
//     is seeded from the crossingId (FNV hash — no Math.random), elevation is a pure
//     function of the map: same store + same map ⇒ byte-identical entity.
//
// Layering: world-side (imports blueprint + the curve helper like terrain-detail.ts);
// the sim system and time-skip call `stepCrossingTiers` and emit its upgrades.

import type { Entity, GameMap } from '@/core/types';
import type { World } from '@/world/world';
import type { RoadEdge } from '@/world/road-graph';
import { getCrossingOpenings } from '@/world/connectome/crossing-openings';
import { getComposedHeightfield } from '@/world/road-deformation';
import { getRenderWaterMask } from '@/world/render-water';
import { curveRenderElev } from '@/render/gpu/terrain-field';
import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { worldStyleOf } from '@/core/world-style';
import { bridgeBlueprintByName } from '@/blueprint/presets/bridges';
import { resolveBlueprint } from '@/blueprint/resolve';
import { blueprintEntity, type StoredBlueprint } from '@/blueprint/entity';
import type { Orientation } from '@/blueprint/orientation';
import {
  tierForUse, stepCrossing, tierSpans, N_UP,
  CROSSING_TIER_RECIPES, GEN_BRIDGE_CLASS_TIER,
  type CrossingTier,
} from '@/world/road-use';
import type { CorridorCrossingSite } from '@/world/corridor-crossings';

/** One managed crossing. Entries exist from the first QUALIFYING apply (the streak must
 *  persist across year-passes and scrubs) — `entityId` present ⇔ a store-owned span stands. */
export interface CrossingTierEntry {
  /** Edge crossings: the spec id (`crossing@<edgeId>#<n>`). Corridor sites: the corridorId. */
  crossingId: string;
  kind: 'edge' | 'corridor';
  /** The road edge (edge crossings only). */
  edgeId?: string;
  /** The BUILT tier. For a streak-only entry (no entityId) this is the frozen gen baseline —
   *  captured at first qualifying apply so later class drift can't re-litigate it. */
  tier: CrossingTier;
  /** Consecutive qualifying year-passes toward the next rung (the `stepCrossing` streak). */
  upStreak: number;
  /** Tick of the last physical change (0 while streak-only). */
  upgradedAtTick: number;
  /** The store-owned span entity, when one stands. */
  entityId?: string;
  /** The gen-time span this store's entity replaced — reconcile keeps it absent. */
  replacedEntityId?: string;
  /** Site geometry, captured at management time so reconcile can rebuild without re-detection. */
  banks: [{ x: number; y: number }, { x: number; y: number }];
  axis: [number, number];
  spanTiles: number;
}

/** Plain structured-clone-friendly snapshot of the store. */
export interface CrossingTierSnapshot {
  entries: CrossingTierEntry[];
}

export class CrossingTierStore {
  private entries = new Map<string, CrossingTierEntry>();

  /** All entries, sorted by crossingId (deterministic iteration/serialization order). */
  all(): CrossingTierEntry[] {
    return [...this.entries.values()].sort((a, b) => (a.crossingId < b.crossingId ? -1 : a.crossingId > b.crossingId ? 1 : 0));
  }

  byId(crossingId: string): CrossingTierEntry | undefined {
    return this.entries.get(crossingId);
  }

  upsert(entry: CrossingTierEntry): void {
    this.entries.set(entry.crossingId, entry);
  }

  /** Drop an entry (streak-only prune; a built entry is never deleted by the stepper). */
  delete(crossingId: string): void {
    this.entries.delete(crossingId);
  }

  reset(): void {
    this.entries.clear();
  }

  serialize(): CrossingTierSnapshot {
    // Deep-clone: snapshots (the timeline ring) must never alias live entries the
    // stepper keeps mutating — the RuntimePoiStore.serialize aliasing lesson.
    return structuredClone({ entries: this.all() });
  }

  hydrate(snap: CrossingTierSnapshot): void {
    // Clone the incoming side too: the snapshot ring is authoritative and must not be
    // aliased by the live store it just restored.
    this.entries.clear();
    for (const e of structuredClone(snap.entries ?? [])) this.entries.set(e.crossingId, e);
  }
}

// ── deterministic entity realization ─────────────────────────────────────────

/** Stable store-owned entity id for a crossing (constant across tier upgrades — a swap is
 *  remove + re-add of the same id, so no id churn rides the snapshots). */
export function tierEntityIdFor(crossingId: string): string {
  return `crossing-tier:${crossingId}`;
}

/** Per-site variety seed: FNV-1a over the crossingId — deterministic, never Math.random
 *  (§10 "variety is the spice": no two humble crossings identical, every rebuild identical). */
export function varietySeedFor(crossingId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < crossingId.length; i++) {
    h ^= crossingId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) || 1;
}

/** The site geometry a span entity needs (subset of an entry; corridor sites match too). */
export interface TierSpanSite {
  crossingId: string;
  banks: [{ x: number; y: number }, { x: number; y: number }];
  axis: [number, number];
}

/**
 * Build the span entity for a crossing at a ladder tier: the canonical `bridge-<recipe>`
 * preset for the rung, variety-seeded per site, quarter-turned onto the crossing axis and
 * seated at bank grade (its own short supports stand into the channel) — exactly the swap the
 * crossing-site studio previews. Pure + deterministic; undefined if the recipe is missing.
 */
export function buildTierSpanEntity(map: GameMap, site: TierSpanSite, tier: CrossingTier): Entity | undefined {
  const recipe = CROSSING_TIER_RECIPES[tier];
  if (!recipe) return undefined;
  const seed = varietySeedFor(site.crossingId);
  const bp = bridgeBlueprintByName(`bridge-${recipe}`, seed);
  if (!bp) return undefined;
  const rb = resolveBlueprint([bp], seed);
  const [b0, b1] = site.banks;
  const q: Orientation = Math.abs(site.axis[0]) >= Math.abs(site.axis[1]) ? 0 : 1;
  const placed = q ? { ...rb, orientation: q } : rb;
  const fpW = q ? rb.footprint.h : rb.footprint.w;
  const fpH = q ? rb.footprint.w : rb.footprint.h;
  const mid = { x: (b0.x + b1.x) / 2, y: (b0.y + b1.y) / 2 };
  const e = blueprintEntity(tierEntityIdFor(site.crossingId), placed,
    Math.round(mid.x - fpW / 2), Math.round(mid.y - fpH / 2), { poiId: site.crossingId });
  // Seat at the higher bank's render elevation — same curved composed-heightfield space the
  // gen spans and the studio use (raw seed heights read the carved channel as ~flat).
  const composed = getComposedHeightfield(map);
  const style = worldStyleOf(map.worldSeed ?? undefined);
  const elev = (x: number, y: number): number =>
    curveRenderElev(composed[Math.round(y) * map.width + Math.round(x)] ?? ELEVATION_SEA_LEVEL,
      ELEVATION_SEA_LEVEL, style.terrainHeightGamma);
  (e.properties as Record<string, unknown>).liftElev = Math.max(elev(b0.x, b0.y), elev(b1.x, b1.y));
  return e;
}

/** The ladder tier the crossing's CURRENT standing span represents. A store-built span is its
 *  entry's tier; a gen span is probed from its own blueprint (stone walls → the grand arch;
 *  a timber arch → the hump-backed rib; a flat trestle → the plank walk — the
 *  {@link GEN_BRIDGE_CLASS_TIER} mapping read from physical reality instead of re-deriving
 *  gen-time era/class inputs that no longer exist). No span at all → 0: the store may build
 *  up from the log (self-healing for degenerate gen crossings). */
export function standingSpanTier(world: World, crossingId: string, entry: CrossingTierEntry | undefined): CrossingTier {
  if (entry) return entry.tier;
  const gen = world.registry.get(`${crossingId}-bridge`);
  const rb = (gen?.properties?.blueprint as StoredBlueprint | undefined)?.rb;
  if (!rb) return 0;
  if (rb.materials?.walls === 'stone') return GEN_BRIDGE_CLASS_TIER['dressed-stone'];
  for (const part of rb.parts ?? []) {
    if (part.type === 'arch_span') return GEN_BRIDGE_CLASS_TIER.timber;
  }
  return GEN_BRIDGE_CLASS_TIER['log-plank'];
}

// ── the year-pass stepper (live tick + time-skip both drive THIS) ────────────

/** One physical change this apply made (the caller emits it as `crossing_upgraded`). */
export interface CrossingUpgrade {
  crossingId: string;
  x: number;
  y: number;
  to: CrossingTier;
  /** Absent when nothing stood here before (the corridor log / a span-less crossing). */
  from?: CrossingTier;
  edgeId?: string;
}

export interface StepCrossingTiersOpts {
  world: World;
  map: GameMap;
  store: CrossingTierStore;
  nowTick: number;
  /** Endpoint wealth 0..1 for an edge — the SAME number the use fold and class ladder read. */
  wealthFor: (edge: RoadEdge) => number;
  /** Corridor crossing sites (detected over the trample grid by the caller); omit ⇒ edge
   *  crossings only (tests / worlds without a trample grid). */
  corridorSites?: CorridorCrossingSite[];
}

/**
 * Apply ONE year-pass of the crossing-tier ladder to every crossing: the graph's seated
 * crossings (via the shared openings) step toward their earned tier; promoted trample
 * corridors earn their tier-0 log. Mutates the store and swaps world entities on a change;
 * returns the upgrades made (the caller emits events). Deterministic; RNG-free.
 */
export function stepCrossingTiers(opts: StepCrossingTiersOpts): CrossingUpgrade[] {
  const { world, map, store, nowTick, wealthFor } = opts;
  const upgrades: CrossingUpgrade[] = [];

  // ── graph crossings: earned = tierForUse(edge use, class, wealth), stepped with streaks ──
  const graph = map.roadGraph;
  if (graph) {
    const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
    for (const op of getCrossingOpenings(map)) {
      const edge = edgeById.get(op.edgeId);
      if (!edge || edge.feature !== 'road') continue;
      const banks: CrossingTierEntry['banks'] = [{ x: op.a[0], y: op.a[1] }, { x: op.b[0], y: op.b[1] }];
      const spanTiles = Math.hypot(op.b[0] - op.a[0], op.b[1] - op.a[1]);
      const earned = tierForUse(edge.use?.ema01 ?? 0, edge.class, wealthFor(edge));
      const entry = store.byId(op.id);
      const built = standingSpanTier(world, op.id, entry);
      const step = stepCrossing(built, earned, spanTiles, entry?.upStreak ?? 0);

      if (step.changed) {
        // Swap the span: raise the earned rung, THEN drop what stood (the previous store span,
        // or the gen span on the first deviation). Build-first so a failed build (missing
        // recipe) genuinely leaves the old span standing — remove-first would leave a gap.
        const genSpanId = `${op.id}-bridge`;
        const hadGenSpan = !entry?.entityId && !!world.registry.get(genSpanId);
        const replacedEntityId = entry?.replacedEntityId ?? (hadGenSpan ? genSpanId : undefined);
        const e = buildTierSpanEntity(map, { crossingId: op.id, banks, axis: op.axis }, step.tier);
        if (!e) continue; // missing recipe — the old span stands untouched
        if (entry?.entityId) world.removeEntity(entry.entityId);
        else if (hadGenSpan) world.removeEntity(genSpanId);
        world.addEntity(e);
        store.upsert({
          crossingId: op.id, kind: 'edge', edgeId: op.edgeId,
          tier: step.tier, upStreak: 0, upgradedAtTick: nowTick,
          entityId: e.id, replacedEntityId, banks, axis: op.axis, spanTiles,
        });
        // `from` is honest only when something actually stood here (gen span or store span).
        const stood = !!entry?.entityId || hadGenSpan;
        upgrades.push({
          crossingId: op.id, x: Math.round((banks[0].x + banks[1].x) / 2), y: Math.round((banks[0].y + banks[1].y) / 2),
          to: step.tier, ...(stood ? { from: built } : {}), edgeId: op.edgeId,
        });
      } else if (step.upStreak > 0) {
        // Accruing toward a rung: persist the streak (and freeze the gen baseline as `tier`
        // so later class drift can't re-litigate what physically stands).
        store.upsert(entry
          ? { ...entry, upStreak: step.upStreak, spanTiles }
          : {
              crossingId: op.id, kind: 'edge', edgeId: op.edgeId,
              tier: built, upStreak: step.upStreak, upgradedAtTick: 0,
              banks, axis: op.axis, spanTiles,
            });
      } else if (entry && !entry.entityId && entry.upStreak > 0) {
        // Streak broke before anything was built — prune; the store records deviations only.
        store.delete(op.id);
      }
    }
  }

  // ── corridor sites: the promoted trail earns its tier-0 log (§9 decision 4) ──
  // v1: corridors hold AT MOST the log — anything grander is adoption-gated (S4 inherits the
  // site onto the new edge). The same N_UP streak stops a wobbling trail flapping a log in
  // and out of the world; a standing log then NEVER un-builds even if the trail fades.
  const sites = opts.corridorSites ?? [];
  const liveSiteIds = new Set(sites.map((s) => s.corridorId));
  for (const site of sites) {
    const entry = store.byId(site.corridorId);
    if (entry?.entityId) continue;                    // the log stands — nothing above it here
    if (!tierSpans(0, site.spanTiles)) continue;      // too wide for a log — that's a ford
    const streak = (entry?.upStreak ?? 0) + 1;
    if (streak >= N_UP) {
      const e = buildTierSpanEntity(map, { crossingId: site.corridorId, banks: site.banks, axis: site.axis }, 0);
      if (!e) continue;
      world.addEntity(e);
      store.upsert({
        crossingId: site.corridorId, kind: 'corridor',
        tier: 0, upStreak: 0, upgradedAtTick: nowTick,
        entityId: e.id, banks: site.banks, axis: site.axis, spanTiles: site.spanTiles,
      });
      upgrades.push({
        crossingId: site.corridorId, to: 0,
        x: Math.round((site.banks[0].x + site.banks[1].x) / 2),
        y: Math.round((site.banks[0].y + site.banks[1].y) / 2),
      });
    } else {
      store.upsert({
        crossingId: site.corridorId, kind: 'corridor',
        tier: 0, upStreak: streak, upgradedAtTick: 0,
        banks: site.banks, axis: site.axis, spanTiles: site.spanTiles,
      });
    }
  }
  // A corridor streak whose site vanished (the trail decayed before the log was laid) prunes;
  // BUILT corridor entries stay forever (rule 2 — the log outlives the trail that earned it).
  for (const entry of store.all()) {
    if (entry.kind === 'corridor' && !entry.entityId && !liveSiteIds.has(entry.crossingId)) {
      store.delete(entry.crossingId);
    }
  }

  return upgrades;
}

/** Detect the corridor crossing sites for a live map: promoted trample chains crossing the
 *  RENDER water (the water the player sees — same mask the road crossings seat against).
 *  Thin convenience over `detectCorridorCrossings` so the sim system and time-skip share the
 *  exact same water source. */
export function corridorSitesFor(
  map: GameMap,
  trample: import('@/sim/trample').TrampleGrid,
  detect: (t: import('@/sim/trample').TrampleGrid, m: GameMap, isWater: (x: number, y: number) => boolean) => CorridorCrossingSite[],
): CorridorCrossingSite[] {
  const wet = getRenderWaterMask(map);
  return detect(trample, map, wet);
}

// ── snapshot restore reconcile (the RuntimePoiStore pattern's second consumer) ─

/**
 * Reconcile world entities against the restored store. Span entities already ride
 * `Snapshot.entities`, so after a normal scrub both sides agree — this pass is the
 * idempotent guard that repairs DIVERGENCE (a stale save, a future migration):
 *  - an entry with `entityId` whose span is missing is rebuilt deterministically
 *    (same site + tier + seed ⇒ byte-identical entity), and its `replacedEntityId`
 *    (the gen span it superseded) is removed if present;
 *  - a store-owned span entity (`crossing-tier:` prefix) with no live entry is an
 *    orphan and is evicted. (The reverse repair — resurrecting a GEN span the store
 *    no longer supersedes — is impossible post-hoc (its geometry needs the full gen
 *    context) and unnecessary: gen spans ride the same entity snapshot.)
 */
export function reconcileCrossingTiers(world: World, map: GameMap, store: CrossingTierStore): void {
  const owned = new Set<string>();
  for (const entry of store.all()) {
    if (!entry.entityId) continue;
    owned.add(entry.entityId);
    if (!world.registry.get(entry.entityId)) {
      const e = buildTierSpanEntity(map, entry, entry.tier);
      if (e) world.addEntity(e);
    }
    if (entry.replacedEntityId && world.registry.get(entry.replacedEntityId)) {
      world.removeEntity(entry.replacedEntityId);
    }
  }
  for (const e of world.query({})) {
    if (e.id.startsWith('crossing-tier:') && !owned.has(e.id)) world.removeEntity(e.id);
  }
}
