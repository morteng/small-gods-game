// src/world/runtime-poi.ts
//
// M4 (mortal power) — RUNTIME POIs: permanent, first-class places the SIM creates
// (the lord's castle), as decided by the 2026-07-17 runtime-POI spike.
//
// This is the causal-site pattern (src/world/causal-site.ts — a snapshot-authoritative
// store whose serialize/hydrate ride the Snapshot so scrub/commit/replay reproduce the
// places exactly) with the OPPOSITE table semantics: causal sites are deliberately
// second-class and transient (`causal:` ids, gated out of settlement behaviour by
// `isSiteId`), while runtime POIs are PROJECTED into the canonical directory
// `worldSeed.pois` as real `POI` records so every directory consumer — perception,
// naming, focus/fly-to, minimap, zone roster, Fate prose — works unchanged.
//
// Three rules keep this honest (spike §3, §7):
//
//  1. PROJECTION, NOT READER MIGRATION. `projectRuntimePois` reconciles
//     `worldSeed.pois` = authored ∪ store entries on add AND on every snapshot
//     restore (add missing, remove orphans). The store is the truth for runtime
//     entries; the table is the directory. Projected entries carry `runtime: true`.
//
//  2. HEIGHTFIELD-INERT BY RULE. A runtime `castle` POI must NEVER move the base
//     terrain (`POI_INFLUENCES.castle` has an elevation cap — naively projecting it
//     would re-key and recompute the heightfield under every standing building).
//     `poiHeightSignature` (heightfield.ts) and `applyPoiInfluences`
//     (poi-influence.ts) both skip `runtime: true` POIs; the castle's ground
//     expression is EARTHWORKS — the deformation channel `placeComplexOnPatch`
//     already writes.
//
//  3. THE PHYSICAL STAMP IS OWNED AND RECONCILED. The earthworks + barrier runs a
//     runtime complex commits are tagged `ownerPoiId` and ALSO recorded on the store
//     entry, so `reconcileRuntimePoiStamps` can re-derive `map.earthworks` /
//     `map.barrierRuns` from the restored store on every snapshot restore — a scrub
//     to before the castle's bornTick un-builds it (walls, motte, ditch), a scrub
//     forward rebuilds it byte-identically. (Barrier/keep ENTITIES restore from
//     `Snapshot.entities`; this reconcile keeps the map-level dual representation
//     from diverging.)
//
// Ids are `castle:0001` — deterministic monotonic counter (snapshotted so re-founds
// after a scrub never collide with captured ids), and deliberately NOT matching
// `isSiteId`'s `causal:` prefix so Fate treats a runtime castle as a settlement,
// not a soft-beat-only site. Founder/cause live in provenance, not the id (§7.6).
//
// Determinism + layering: pure data, no render import, no `Math.random`.

import type { POI, WorldSeed, GameMap } from '@/core/types';
import type { Earthwork } from '@/blueprint/connectome/earthworks';
import type { PlacedBarrier } from '@/world/barrier';

/** Who/what founded the place, and from which complex recipe. */
export interface RuntimePoiProvenance {
  /** Sim tick the place was founded. */
  bornTick: number;
  /** Attribution: a spirit id, `lord:<npcId>`, 'fate', … */
  cause: string;
  /** The complexType that stamped the ground, e.g. 'motte_and_bailey'. */
  complexTypeId: string;
  /** M4 S4: the settlement whose seated lord founded this place — the
   *  `found_castle` verb's one-castle-per-seat gate keys on it. Absent on
   *  harness/studio foundations. */
  foundedFromPoiId?: string;
}

/** A runtime-created place: the projected POI record + its provenance + the
 *  map-level physical stamp it owns (source of truth for the scrub reconcile). */
export interface RuntimePoiEntry {
  /** Full POI record (always `runtime: true`); projected into `worldSeed.pois`. */
  poi: POI;
  provenance: RuntimePoiProvenance;
  /** Earthworks this place committed to `map.earthworks` (each `ownerPoiId === poi.id`). */
  earthworks: Earthwork[];
  /** Barrier runs this place committed to `map.barrierRuns` (each `ownerPoiId === poi.id`). */
  barrierRuns: PlacedBarrier[];
}

/** Plain, structured-clone-friendly snapshot of the whole store: entries + the id
 *  counter (so a re-found after a scrub never collides with a captured id). */
export interface RuntimePoiSnapshot {
  entries: RuntimePoiEntry[];
  nextId: number;
}

/**
 * The runtime-POI store. `serialize`/`hydrate` ride the Snapshot (the causal-site
 * W-G pattern) so scrub/commit/replay reproduce runtime places exactly; the game
 * re-asserts the directory projection + physical stamp on every restore.
 */
export class RuntimePoiStore {
  private entries: RuntimePoiEntry[] = [];
  private nextId = 1;

  /** Live entries, in foundation order (deterministic). */
  all(): readonly RuntimePoiEntry[] { return this.entries; }

  byId(id: string): RuntimePoiEntry | undefined {
    return this.entries.find(e => e.poi.id === id);
  }

  /** Allocate the next runtime poiId, e.g. `castle:0001`. Deterministic by call
   *  order; the counter never rewinds (snapshotted), so ids stay unique across
   *  scrubs even when a foundation is rolled back. Must NOT use the `causal:`
   *  prefix — that would trip Fate's `isSiteId` second-class gating. */
  allocateId(kind = 'castle'): string {
    return `${kind}:${String(this.nextId++).padStart(4, '0')}`;
  }

  /** Record a founded place. The entry's poi is forced `runtime: true` (the flag
   *  the terrain-inertness guards and the projection reconcile key on). */
  add(entry: RuntimePoiEntry): void {
    entry.poi.runtime = true;
    this.entries.push(entry);
  }

  /** Clear everything (fresh world). */
  reset(): void { this.entries = []; this.nextId = 1; }

  serialize(): RuntimePoiSnapshot {
    // Deep-clone: snapshots (the timeline ring) must never alias live map state —
    // the map arrays share these earthwork/run objects after a reconcile.
    return structuredClone({ entries: this.entries, nextId: this.nextId });
  }

  hydrate(snap: RuntimePoiSnapshot): void {
    // Deep-clone the incoming snapshot too: after `reconcileRuntimePoiStamps` the
    // live map aliases the store's objects, and the snapshot ring is authoritative.
    this.nextId = snap.nextId ?? 1;
    this.entries = structuredClone(snap.entries ?? []);
  }
}

/**
 * Reconcile the canonical POI directory: `worldSeed.pois` = authored ∪ store
 * entries. Removes orphaned `runtime: true` projections (e.g. a stale save whose
 * worldSeed carried a castle the restored store no longer has) and re-asserts the
 * live ones. Idempotent. Accepts multiple seeds because the load path can leave
 * `state.worldSeed` and `map.worldSeed` as DISTINCT clones — both directories
 * must agree.
 */
export function projectRuntimePois(
  store: RuntimePoiStore,
  seeds: Array<WorldSeed | null | undefined>,
): void {
  const runtime = store.all().map(e => e.poi);
  const done = new Set<WorldSeed>();
  for (const ws of seeds) {
    if (!ws || done.has(ws)) continue;
    done.add(ws);
    ws.pois = [...(ws.pois ?? []).filter(p => !p.runtime), ...runtime];
  }
}

/**
 * Reconcile the map-level PHYSICAL stamp against the store: drop every owned
 * (`ownerPoiId`-tagged) earthwork / barrier run, then re-append the stamps of the
 * live entries. Unowned entries (worldgen rings, studio placements) pass through
 * untouched, in order. Idempotent; called on every snapshot restore so a scrub to
 * before a foundation removes its motte/ditch/walls and a scrub forward restores
 * them byte-identically. The deformation memo re-keys automatically — its key
 * folds in `earthworks.length` and the barrier foundation/ditch counts
 * (`road-deformation.ts`), so no explicit invalidation (and no `bumpTilesRev`:
 * nothing here writes `tile.type`).
 *
 * NOTE: this store is the ONLY writer of `ownerPoiId` — any future second owner
 * system must join this reconcile rather than invent a parallel one.
 */
export function reconcileRuntimePoiStamps(map: GameMap, store: RuntimePoiStore): void {
  const earthworks = (map.earthworks ?? []).filter(e => !e.ownerPoiId);
  const runs = (map.barrierRuns ?? []).filter(b => !b.ownerPoiId);
  for (const entry of store.all()) {
    earthworks.push(...entry.earthworks);
    runs.push(...entry.barrierRuns);
  }
  // Avoid materialising empty arrays on maps that never had the fields (keeps
  // test stubs / studio grounds byte-identical); the memo key treats undefined
  // and [] the same (`?? 0`).
  if (map.earthworks !== undefined || earthworks.length > 0) map.earthworks = earthworks;
  if (map.barrierRuns !== undefined || runs.length > 0) map.barrierRuns = runs;
}
