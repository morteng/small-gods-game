// src/world/desire-line-adoption.ts
//
// Road-wear economy S4 — desire-line ADOPTION: the seam that closes the bottom of the road
// ladder (spec: docs/superpowers/specs/2026-07-17-road-wear-economy-spec.md §5, §9 decisions
// 3–4). A promoted trample corridor that has sustained qualifying wear between two anchors
// becomes a real `RoadEdge` — `class: 'path'`, `surface: 'dirt'`, `emergent: true` — whose
// polyline IS the traced desire line (no walker re-route; the geometry the feet chose is the
// whole point). "The mill path became a road."
//
// This module owns the COMMIT + PERSISTENCE half; the pure tracing half lives in
// `desire-line-corridors.ts` (`traceAdoptionCorridors`). Three pieces:
//
//  1. `AdoptionLedger` — the snapshot-authoritative store (RuntimePoiStore pattern consumer
//     #3, after the runtime-POI store and the crossing-tier store): pre-adoption streaks +
//     one full `AdoptionRecord` per committed adoption. Optional `Snapshot.adoptions?` field,
//     no SAVE_VERSION bump (the `lords?`/`runtimePois?` precedent).
//  2. `adoptDesireLine` — the one-way commit (§9 decision 3: un-adoption is a named follow-up):
//     endpoint node resolution (an end mid-road SPLITS the host edge — `splitEdgeAtIndex`, the
//     first runtime splitter), edge insertion, raster through the normal tile rules with the
//     prior tile state captured for exact reversal, trample `release()` (the graph owns the
//     cells now), and the §9.4 ledger RE-KEY: a standing corridor log on the path becomes an
//     edge crossing of the new edge (same store, union key — no parallel system).
//  3. `reconcileAdoptions` — the scrub/restore replay. The road graph rides the MAP (mutated
//     in place, not snapshot-captured), so restore replays graph membership from the ledger:
//     scrub-back un-adopts (edge out, splits merged, tiles reverted from the recorded prior
//     state — the restored trample grid then owns the dirt again), scrub-forward re-adopts
//     byte-identically (same record ⇒ same split ids, same edge, same raster).
//
// Deterministic + RNG-free throughout. Every graph mutation bumps `graph.rev` (tile→edge
// index, crossing-openings memo, carve/surface caches all re-key on it) and every tile write
// goes through `bumpTilesRev` (the standing gotcha).

import type { GameMap, POI, Tile } from '@/core/types';
import type { World } from '@/world/world';
import { WATER_TYPES } from '@/core/constants';
import { bumpTilesRev } from '@/core/tile-rev';
import {
  ROAD_TILE_TYPES, splitEdgeAtIndex, unsplitEdge,
  type EdgeSplitRecord, type RoadEdge, type RoadGraph, type RoadNode,
} from '@/world/road-graph';
import { getCrossingOpenings, type CrossingOpening } from '@/world/connectome/crossing-openings';
import { buildTierSpanEntity, type CrossingTierStore } from '@/world/crossing-tier-store';
import {
  traceAdoptionCorridors, ADOPT_WEAR_MIN, N_ADOPT,
  type AdoptionCandidate, type CorridorLogSite,
} from '@/world/desire-line-corridors';
import { getRenderWaterMask } from '@/world/render-water';
import type { TrampleGrid } from '@/sim/trample';

// ── the ledger ───────────────────────────────────────────────────────────────

/** One tile's pre-adoption state — enough to reverse the raster byte-exactly.
 *  `baseType` absent ⇔ the tile had no `baseType` before the raster. */
export interface PriorTileRec {
  x: number;
  y: number;
  type: string;
  walkable: boolean;
  baseType?: string;
}

/** A graph node the commit CREATED (an off-road POI anchor) — removed again on un-adopt. */
export interface CreatedNodeRec {
  id: string;
  x: number;
  y: number;
  poiRef?: string;
}

/** Everything needed to replay (or reverse) one committed adoption. */
export interface AdoptionRecord {
  /** The candidate key (anchor-pair identity) — the ledger's primary key. */
  key: string;
  /** The emergent edge's id (`re-adopt:<key>`). */
  edgeId: string;
  polyline: { x: number; y: number }[];
  /** Flat indices (`y*width+x`) of deck cells over standing corridor logs. */
  bridgeCells: number[];
  /** Endpoint node ids of the adopted edge (post-split / post-create). */
  nodeA: string;
  nodeB: string;
  /** Nodes the commit created (POI anchors with no prior graph presence). */
  createdNodes: CreatedNodeRec[];
  /** Host-edge splits, in the order performed (reversed on un-adopt). */
  splits: EdgeSplitRecord[];
  /** Pre-raster tile state for every cell the raster wrote (skipped cells absent). */
  priorTiles: PriorTileRec[];
  adoptedAtTick: number;
  fromPoiId?: string;
  toPoiId?: string;
}

export interface AdoptionLedgerEntry {
  key: string;
  /** Consecutive qualifying year-passes toward adoption (0 once adopted). */
  streak: number;
  adopted?: AdoptionRecord;
}

export interface AdoptionLedgerSnapshot {
  entries: AdoptionLedgerEntry[];
}

export class AdoptionLedger {
  private entries = new Map<string, AdoptionLedgerEntry>();

  /** All entries, sorted by key (deterministic iteration/serialization order). */
  all(): AdoptionLedgerEntry[] {
    return [...this.entries.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  byKey(key: string): AdoptionLedgerEntry | undefined {
    return this.entries.get(key);
  }

  upsert(entry: AdoptionLedgerEntry): void {
    this.entries.set(entry.key, entry);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  reset(): void {
    this.entries.clear();
  }

  serialize(): AdoptionLedgerSnapshot {
    // Deep-clone both directions — the RuntimePoiStore.serialize aliasing lesson.
    return structuredClone({ entries: this.all() });
  }

  hydrate(snap: AdoptionLedgerSnapshot): void {
    this.entries.clear();
    for (const e of structuredClone(snap.entries ?? [])) this.entries.set(e.key, e);
  }
}

// ── the commit ───────────────────────────────────────────────────────────────

/** The emitted-event payload for one adoption (the caller appends it to the log). */
export interface AdoptedEvent {
  edgeId: string;
  x: number;
  y: number;
  lengthT: number;
  fromPoiId?: string;
  toPoiId?: string;
}

export interface AdoptOpts {
  world: World;
  map: GameMap;
  candidate: AdoptionCandidate;
  nowTick: number;
  /** The S3 store, for the §9.4 log re-key (and host-split crossing re-ids). */
  crossingTiers?: CrossingTierStore | null;
}

function poiIdOfAnchor(a: AdoptionCandidate['anchors'][number]): string | undefined {
  return a.kind === 'poi' ? a.poiId : a.kind === 'node' ? a.poiId : undefined;
}

/** Match two openings by their (unordered) bank-cell pair. */
function sameBanks(a: CrossingOpening, banks: [{ x: number; y: number }, { x: number; y: number }]): boolean {
  const eq = (p: [number, number], q: { x: number; y: number }): boolean => p[0] === q.x && p[1] === q.y;
  return (eq(a.a, banks[0]) && eq(a.b, banks[1])) || (eq(a.a, banks[1]) && eq(a.b, banks[0]));
}

/** Re-key a crossing-tier store entry onto a fresh opening id: the entry moves under the new
 *  id and its store-owned span (if one stands) is REBUILT with the new id's variety seed —
 *  rebuild-over-rename so a later reconcile rebuild is byte-identical to this path. */
function rekeyStoreEntry(
  world: World, map: GameMap, store: CrossingTierStore,
  oldId: string, op: CrossingOpening,
): void {
  const entry = store.byId(oldId);
  if (!entry) return;
  store.delete(oldId);
  let entityId = entry.entityId;
  if (entry.entityId && world.registry.get(entry.entityId)) {
    world.removeEntity(entry.entityId);
    const e = buildTierSpanEntity(map, { crossingId: op.id, banks: entry.banks, axis: entry.axis }, entry.tier);
    if (e) {
      world.addEntity(e);
      entityId = e.id;
    } else {
      entityId = undefined; // missing recipe — entry survives span-less; reconcile may heal later
    }
  }
  store.upsert({ ...entry, crossingId: op.id, kind: 'edge', edgeId: op.edgeId, entityId });
}

/**
 * Commit one adoption. Mutates the graph (splits + new edge), tiles (raster), the trample grid
 * (release) and — where the path crosses a standing corridor log or a split moves a crossing's
 * identity — the crossing-tier store + span entities. Returns the ledger record + the event
 * payload, or null when the graph/anchors can't support the commit (nothing mutated on null:
 * failed split resolution unwinds any earlier split before returning).
 */
export function adoptDesireLine(opts: AdoptOpts): { record: AdoptionRecord; event: AdoptedEvent } | null {
  const { world, map, candidate, nowTick } = opts;
  const graph = map.roadGraph;
  if (!graph || candidate.path.length < 2) return null;
  const width = map.width;

  // Capture the pre-surgery crossing identities of every host edge we are about to split —
  // splitting renames the halves, so `crossing@<host>#<n>` ids (and the gen `-bridge` entities
  // + store entries keyed on them) must move with the crossing they name.
  const hostIds = [...new Set(candidate.anchors.filter((a) => a.kind === 'edge').map((a) => (a as { edgeId: string }).edgeId))];
  const preOps = hostIds.length
    ? getCrossingOpenings(map).filter((op) => hostIds.includes(op.edgeId))
        .map((op) => ({ id: op.id, banks: [{ x: op.a[0], y: op.a[1] }, { x: op.b[0], y: op.b[1] }] as [{ x: number; y: number }, { x: number; y: number }] }))
    : [];

  // ── endpoint resolution (splits ordered larger-index-first so a double landing on ONE host
  //    edge keeps the second index valid inside the `a` half) ──
  const splits: EdgeSplitRecord[] = [];
  const createdNodes: CreatedNodeRec[] = [];
  const unwind = (): null => {
    for (const rec of [...splits].reverse()) unsplitEdge(graph, rec);
    for (const n of createdNodes) {
      const i = graph.nodes.findIndex((gn) => gn.id === n.id);
      if (i >= 0) graph.nodes.splice(i, 1);
    }
    return null;
  };

  const order = candidate.anchors[0].kind === 'edge' && candidate.anchors[1].kind === 'edge'
    && candidate.anchors[0].edgeId === candidate.anchors[1].edgeId
    && candidate.anchors[0].index < candidate.anchors[1].index
    ? [1, 0] : [0, 1];
  const nodeIds: [string, string] = ['', ''];
  for (const ai of order) {
    const anchor = candidate.anchors[ai];
    if (anchor.kind === 'node') {
      if (!graph.nodes.some((n) => n.id === anchor.nodeId)) return unwind();
      nodeIds[ai] = anchor.nodeId;
    } else if (anchor.kind === 'poi') {
      const existing = graph.nodes.find((n) => n.id === `rn-adopt:${anchor.poiId}`);
      if (existing) {
        nodeIds[ai] = existing.id;
      } else {
        const node: RoadNode = { id: `rn-adopt:${anchor.poiId}`, x: anchor.cell.x, y: anchor.cell.y, kind: 'poi', poiRef: anchor.poiId };
        graph.nodes.push(node);
        createdNodes.push({ id: node.id, x: node.x, y: node.y, poiRef: anchor.poiId });
        nodeIds[ai] = node.id;
      }
    } else {
      // Mid-edge landing. When BOTH anchors share one host, the larger index was split first
      // (order above) and this smaller index now lives at the same position inside `<host>a`.
      const hostId = splits.some((s) => s.hostEdgeId === anchor.edgeId) ? `${anchor.edgeId}a` : anchor.edgeId;
      const rec = splitEdgeAtIndex(graph, hostId, anchor.index, width);
      if (!rec) return unwind();
      splits.push(rec);
      nodeIds[ai] = rec.nodeId;
    }
  }

  // ── the emergent edge: the traced desire line IS the geometry ──
  const edgeId = `re-adopt:${candidate.key}`;
  const bridgeSet = new Set(candidate.bridgeIndices);
  const bridgeCells = candidate.bridgeIndices
    .map((i) => candidate.path[i].y * width + candidate.path[i].x).sort((m, n) => m - n);
  const edge: RoadEdge = {
    id: edgeId,
    a: nodeIds[0],
    b: nodeIds[1],
    polyline: candidate.path.map((c) => ({ x: c.x, y: c.y })),
    feature: 'road',
    class: 'path',
    surface: 'dirt',
    bridgeCells,
    emergent: true,
    // Pin EVERY polyline point: the smoothed centerline is forced through the walked cells, so
    // a wobbly trail can't bow onto illegal ground (`roads.ribbon-legal` holds by construction
    // — no runtime bow-reconciliation pass needed) and the road keeps its hand-worn look.
    pins: candidate.path.map((_, i) => i),
  };
  graph.edges.push(edge);
  graph.rev = (graph.rev ?? 0) + 1;

  // ── raster: dirt path over the (mostly already-dirt) trail, deck over the log cells.
  //    Existing road cells are the host's — never rewritten, never recorded. ──
  const priorTiles: PriorTileRec[] = [];
  for (let i = 0; i < edge.polyline.length; i++) {
    const c = edge.polyline[i];
    const t: Tile | undefined = map.tiles[c.y]?.[c.x];
    if (!t || ROAD_TILE_TYPES.has(t.type)) continue;
    const isDeck = bridgeSet.has(i);
    if (!isDeck && WATER_TYPES.has(t.type)) continue; // defensive: only log jumps may cross water
    const prior: PriorTileRec = { x: c.x, y: c.y, type: t.type, walkable: t.walkable !== false };
    if (t.baseType !== undefined) prior.baseType = t.baseType;
    priorTiles.push(prior);
    if (t.baseType === undefined) t.baseType = t.type; // preserveBaseType (road-graph raster rule)
    t.type = isDeck ? 'bridge' : 'dirt_road';
    t.walkable = true;
  }
  if (priorTiles.length) bumpTilesRev(map);

  // ── release: the graph owns the corridor cells now (trample.ts adoption seam). The caller
  //    passes the grid via the world state; release is done by the driver (`stepAdoptions`)
  //    so this commit stays callable from replay paths that have no live grid. ──

  // ── §9.4 re-key + host-split crossing identity moves ──
  const store = opts.crossingTiers;
  if (store) {
    const newOps = getCrossingOpenings(map); // rev-aware — recomputed post-surgery
    // (a) crossings that lived on a split host edge follow their banks to the renamed half.
    for (const pre of preOps) {
      const op = newOps.find((o) => sameBanks(o, pre.banks));
      if (!op || op.id === pre.id) continue;
      rekeyStoreEntry(world, map, store, pre.id, op);
      const gen = world.registry.get(`${pre.id}-bridge`);
      if (gen && !world.registry.get(`${op.id}-bridge`)) {
        world.removeEntity(gen.id);
        world.addEntity({ ...gen, id: `${op.id}-bridge`, properties: structuredClone(gen.properties) });
      }
    }
    // (b) the corridor log the trail earned becomes an edge crossing of the new edge — the
    //     ledger re-key (§9 decision 4). Same tier, same banks; the span is rebuilt under its
    //     edge-crossing identity.
    for (const corridorId of candidate.logCorridorIds) {
      const entry = store.byId(corridorId);
      if (!entry) continue;
      const op = newOps.find((o) => o.edgeId === edgeId && sameBanks(o, entry.banks));
      if (!op) {
        console.warn(`[adoption] no opening matched corridor log ${corridorId} on ${edgeId} — log entry left corridor-keyed`);
        continue;
      }
      rekeyStoreEntry(world, map, store, corridorId, op);
    }
  }

  const mid = candidate.path[Math.floor(candidate.path.length / 2)];
  const record: AdoptionRecord = {
    key: candidate.key,
    edgeId,
    polyline: edge.polyline.map((c) => ({ ...c })),
    bridgeCells,
    nodeA: nodeIds[0],
    nodeB: nodeIds[1],
    createdNodes,
    splits,
    priorTiles,
    adoptedAtTick: nowTick,
  };
  const fromPoiId = poiIdOfAnchor(candidate.anchors[0]);
  const toPoiId = poiIdOfAnchor(candidate.anchors[1]);
  if (fromPoiId) record.fromPoiId = fromPoiId;
  if (toPoiId) record.toPoiId = toPoiId;
  const event: AdoptedEvent = {
    edgeId, x: mid.x, y: mid.y, lengthT: candidate.path.length,
    ...(fromPoiId ? { fromPoiId } : {}), ...(toPoiId ? { toPoiId } : {}),
  };
  return { record, event };
}

// ── the year-pass driver (live tick + time-skip both drive THIS) ─────────────

/** Derive the tracer's log-site jump list from the S3 store: every STANDING corridor log. */
export function corridorLogSites(store: CrossingTierStore | null | undefined): CorridorLogSite[] {
  if (!store) return [];
  const out: CorridorLogSite[] = [];
  for (const e of store.all()) {
    if (e.kind !== 'corridor' || !e.entityId) continue;
    const water: Array<{ x: number; y: number }> = [];
    const [a, b] = e.banks;
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    for (let i = 1; i < steps; i++) water.push({ x: a.x + dx * i, y: a.y + dy * i });
    out.push({ corridorId: e.crossingId, banks: e.banks, water });
  }
  return out;
}

export interface StepAdoptionsOpts {
  world: World;
  map: GameMap;
  ledger: AdoptionLedger;
  trample: TrampleGrid;
  nowTick: number;
  crossingTiers?: CrossingTierStore | null;
  pois?: POI[];
  /** Pre-traced candidates (the time-skip detects once per burst); omit ⇒ trace now. */
  candidates?: AdoptionCandidate[];
}

/**
 * Apply ONE year-pass of the adoption ladder: every traced corridor whose mean wear qualifies
 * accrues its streak; at `N_ADOPT` consecutive qualifying passes the corridor is committed via
 * {@link adoptDesireLine} and its cells released from the trample grid. A non-qualifying pass
 * breaks the streak (prune); a corridor whose trace vanished prunes too — adopted records are
 * permanent (one-way, §9 decision 3). Returns the events to emit. Deterministic; RNG-free.
 */
export function stepAdoptions(opts: StepAdoptionsOpts): AdoptedEvent[] {
  const { world, map, ledger, trample, nowTick } = opts;
  const graph = map.roadGraph;
  if (!graph) return [];
  const candidates = opts.candidates ?? traceAdoptionCorridors(trample, map, graph, {
    pois: opts.pois ?? map.worldSeed?.pois,
    logSites: corridorLogSites(opts.crossingTiers),
    isWater: getRenderWaterMask(map),
  });
  const events: AdoptedEvent[] = [];
  const liveKeys = new Set(candidates.map((c) => c.key));
  for (const c of candidates) {
    const entry = ledger.byKey(c.key);
    if (entry?.adopted) continue;
    if (c.meanWear >= ADOPT_WEAR_MIN) {
      const streak = (entry?.streak ?? 0) + 1;
      if (streak >= N_ADOPT) {
        const res = adoptDesireLine({ world, map, candidate: c, nowTick, crossingTiers: opts.crossingTiers });
        if (res) {
          trample.release(c.path);
          ledger.upsert({ key: c.key, streak: 0, adopted: res.record });
          events.push(res.event);
        } else {
          ledger.upsert({ key: c.key, streak }); // commit blocked — hold the streak, retry next pass
        }
      } else {
        ledger.upsert({ key: c.key, streak });
      }
    } else if (entry) {
      ledger.delete(c.key); // non-qualifying pass breaks the streak (consecutive, not lifetime)
    }
  }
  // A streak whose corridor is no longer traced (the trail faded / was partly built over)
  // prunes; ADOPTED records are permanent — the road outlives the trail that earned it.
  for (const e of ledger.all()) {
    if (!e.adopted && !liveKeys.has(e.key)) ledger.delete(e.key);
  }
  return events;
}

// ── snapshot restore reconcile (replay graph membership from the ledger) ─────

function revertTiles(map: GameMap, rec: AdoptionRecord, coveredElsewhere: Set<number>): number {
  let touched = 0;
  for (const p of rec.priorTiles) {
    if (coveredElsewhere.has(p.y * map.width + p.x)) continue; // another edge owns this cell now
    const t = map.tiles[p.y]?.[p.x];
    if (!t) continue;
    t.type = p.type;
    t.walkable = p.walkable;
    if (p.baseType === undefined) delete t.baseType;
    else t.baseType = p.baseType;
    touched++;
  }
  return touched;
}

function rerasterTiles(map: GameMap, rec: AdoptionRecord): number {
  const bridges = new Set(rec.bridgeCells);
  let touched = 0;
  for (const p of rec.priorTiles) {
    const t = map.tiles[p.y]?.[p.x];
    if (!t) continue;
    // Reproduce the live raster's post-state exactly (type/walkable/baseType), so a replayed
    // adoption is byte-identical to the one the live commit made.
    t.type = bridges.has(p.y * map.width + p.x) ? 'bridge' : 'dirt_road';
    t.walkable = true;
    t.baseType = p.baseType !== undefined ? p.baseType : p.type;
    touched++;
  }
  return touched;
}

function unadopt(map: GameMap, graph: RoadGraph, rec: AdoptionRecord): boolean {
  const pos = graph.edges.findIndex((e) => e.id === rec.edgeId);
  if (pos < 0) return false;
  graph.edges.splice(pos, 1);
  for (const s of [...rec.splits].reverse()) unsplitEdge(graph, s);
  for (const n of rec.createdNodes) {
    if (!graph.edges.some((e) => e.a === n.id || e.b === n.id)) {
      const i = graph.nodes.findIndex((gn) => gn.id === n.id);
      if (i >= 0) graph.nodes.splice(i, 1);
    }
  }
  const covered = new Set<number>();
  for (const e of graph.edges) {
    if (e.feature !== 'road') continue;
    for (const c of e.polyline) covered.add(c.y * map.width + c.x);
  }
  revertTiles(map, rec, covered);
  graph.rev = (graph.rev ?? 0) + 1;
  return true;
}

function readopt(map: GameMap, graph: RoadGraph, rec: AdoptionRecord): void {
  // Replay the splits (identical ids by construction — `rn-split:<host>@<i>` / `<host>a/b`).
  for (const s of rec.splits) {
    if (graph.edges.some((e) => e.id === s.halfIds[0])) continue; // already split
    splitEdgeAtIndex(graph, s.hostEdgeId, s.atIndex, map.width);
  }
  for (const n of rec.createdNodes) {
    if (!graph.nodes.some((gn) => gn.id === n.id)) {
      graph.nodes.push({ id: n.id, x: n.x, y: n.y, kind: 'poi', ...(n.poiRef ? { poiRef: n.poiRef } : {}) });
    }
  }
  graph.edges.push({
    id: rec.edgeId, a: rec.nodeA, b: rec.nodeB,
    polyline: rec.polyline.map((c) => ({ ...c })),
    feature: 'road', class: 'path', surface: 'dirt',
    bridgeCells: [...rec.bridgeCells],
    emergent: true,
    pins: rec.polyline.map((_, i) => i),
  });
  rerasterTiles(map, rec);
  graph.rev = (graph.rev ?? 0) + 1;
}

/**
 * Reconcile the road graph + tiles against the restored ledger. The graph rides the map
 * (mutated in place, not snapshot-captured), so this is where scrub semantics come from:
 * an adoption the restored ledger lacks (scrub-back past the commit) is REVERSED — edge out,
 * splits merged back, tiles reverted to the recorded prior state (the restored trample grid,
 * reconciled just before this in `restoreSnapshot`, owns the dirt again) — and an adoption
 * it carries whose edge is missing (scrub-forward after a back-scrub) is REPLAYED
 * byte-identically. `prev` is the ledger that was live before this restore; emergent edges
 * with no record in either ledger are evicted best-effort (tiles fall back to `baseType`).
 * Span/crossing ENTITIES need no handling here: they ride `Snapshot.entities`, and the
 * crossing-tier reconcile (which runs after this) heals any store↔entity divergence.
 * Idempotent; bumps tiles/graph revs only when something changed.
 */
export function reconcileAdoptions(
  map: GameMap, ledger: AdoptionLedger, prev?: AdoptionLedger | null,
): void {
  const graph = map.roadGraph;
  if (!graph) return;
  const now = new Map(ledger.all().filter((e) => e.adopted).map((e) => [e.key, e.adopted!]));
  let tilesTouched = false;

  // 1. Un-adopt what the previous live ledger had committed but the restored one lacks.
  for (const e of prev?.all() ?? []) {
    if (e.adopted && !now.has(e.key)) tilesTouched = unadopt(map, graph, e.adopted) || tilesTouched;
  }
  // 2. Evict orphan emergent edges neither ledger explains (a stale save): best-effort revert.
  const known = new Set([...now.values()].map((r) => r.edgeId));
  for (const e of [...graph.edges]) {
    if (!e.emergent || known.has(e.id)) continue;
    const pos = graph.edges.findIndex((g) => g.id === e.id);
    if (pos >= 0) graph.edges.splice(pos, 1);
    const covered = new Set<number>();
    for (const g of graph.edges) {
      if (g.feature !== 'road') continue;
      for (const c of g.polyline) covered.add(c.y * map.width + c.x);
    }
    for (const c of e.polyline) {
      if (covered.has(c.y * map.width + c.x)) continue;
      const t = map.tiles[c.y]?.[c.x];
      if (!t || !ROAD_TILE_TYPES.has(t.type)) continue;
      t.type = t.baseType ?? 'dirt';
      t.walkable = true;
      tilesTouched = true;
    }
    graph.rev = (graph.rev ?? 0) + 1;
  }
  // 3. Re-adopt what the restored ledger carries but the graph lacks.
  for (const rec of now.values()) {
    if (!graph.edges.some((e) => e.id === rec.edgeId)) {
      readopt(map, graph, rec);
      tilesTouched = true;
    }
  }
  if (tilesTouched) bumpTilesRev(map);
}
