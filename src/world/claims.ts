// src/world/claims.ts
//
// The CLAIMS LEDGER — the single spatial authority for feature space claims.
//
// Worldgen is a pipeline of independent writers over shared state (tiles, heightfield
// deformations, entities). Each writer must remember every earlier writer's invariants,
// so N feature systems accrete O(N²) hand-written pairwise guards — each added only after
// someone spots the bug in a rendered frame (walls in water, bridgeless fords, roads
// through houses…). The ledger retires that class: every feature CLAIMS the cells it
// occupies, and cell-level intersections between INCOMPATIBLE kinds are detected
// STRUCTURALLY, once, here — never rediscovered visually.
//
// This module is OBSERVATIONAL (WP-B): `buildClaimsFromWorld` derives claims from already
// committed state, so the ledger is usable today without touching map-generator ordering.
// A compatible-by-design overlap (a road crossing water at a bridge, a wall opening over a
// channel) is legitimate ONLY when a RESOLUTION is registered for those cells — the seam
// where WP-C's junction artifacts (Bridge / WaterGate / Gatehouse / RoadJunction) plug in.
//
// Pure + deterministic: no `Math.random`, no `Date.now`; every iteration is over sorted
// keys so two builds of the same world produce byte-identical reports.

import type { GameMap, Entity } from '@/core/types';
import type { World } from '@/world/world';
import { WATER_TYPES } from '@/core/constants';
import { barrierFootprintTiles } from '@/world/barrier';
import { buildingStructureCells } from '@/world/connectome-diagnostics';

/** The kinds of space a feature can claim. `earthwork` and `stair` are reserved for later
 *  population (WP-C/WP-D); the matrix below still treats them, so adding a populator is a
 *  one-line change with no new conflict-detection code. */
export type ClaimKind =
  | 'water' | 'road' | 'barrier' | 'building' | 'earthwork' | 'stair' | 'crossing';

/** One feature's assertion that it occupies a cell. */
export interface Claim {
  featureId: string;
  kind: ClaimKind;
  meta?: Record<string, unknown>;
}

// ── Compatibility matrix ────────────────────────────────────────────────────────────
//
// How a cell shared by two DIFFERENT features of the given kinds is judged. Keyed by the
// two kinds sorted alphabetically and joined with '|', so lookup is order-independent.
//
//   'ok'       — compatible by design; never reported.
//   'overlap'  — allowed, but surfaced (info) because a junction artifact should own it.
//   'needs'    — legitimate ONLY where a resolution is registered for the cell; an
//                un-resolved cell is an error.
//   'conflict' — always incompatible until the resolving artifact type exists (none do yet).
//
// The `artifact` names the WP-C junction artifact that will (or does) resolve the class —
// the forward-pointer that turns "silent overlap" into "typed, representable object".

export type Disposition = 'ok' | 'overlap' | 'needs' | 'conflict';

export interface PairRule {
  /** Stable conflict-class id, e.g. `road-x-water`. */
  class: string;
  disposition: Disposition;
  /** The WP-C junction artifact that resolves this class ('' when none / not applicable). */
  artifact: string;
}

const OK: PairRule = { class: 'ok', disposition: 'ok', artifact: '' };

/** Keys are the two kinds sorted alphabetically, '|'-joined. Missing pairs default to `ok`
 *  (a new kind is compatible-until-ruled — observational code must not invent conflicts). */
const PAIR_RULES: Readonly<Record<string, PairRule>> = {
  // road over water is fine ONLY at a crossing (bridge/deck) covering the cell.
  'road|water': { class: 'road-x-water', disposition: 'needs', artifact: 'Bridge / WaterGate (crossing)' },
  // a wall over water must OPEN (gap / water-gate span), not wade it.
  'barrier|water': { class: 'barrier-x-water', disposition: 'needs', artifact: 'WaterGate (gap span)' },
  // a road crossing a wall must pass through a GATE opening.
  'barrier|road': { class: 'road-x-barrier', disposition: 'needs', artifact: 'Gatehouse (gate span)' },
  // no artifact type exists yet ⇒ always a conflict:
  'building|water': { class: 'building-x-water', disposition: 'conflict', artifact: '(none — buildings never site on water)' },
  'building|road': { class: 'road-x-building', disposition: 'conflict', artifact: '(none — reroute the road)' },
  'barrier|building': { class: 'barrier-x-building', disposition: 'conflict', artifact: 'Gatehouse (WP-C; none yet)' },
  'building|building': { class: 'building-x-building', disposition: 'conflict', artifact: '(none — displace one building)' },
  // allowed overlaps (a junction artifact should eventually own the seam, but it is not a bug):
  'road|road': { class: 'road-x-road', disposition: 'overlap', artifact: 'RoadJunction (WP-C)' },
  // crossings are the RESOLUTION to road×water / barrier×water, so they sit over both by design:
  'crossing|water': { class: 'crossing-x-water', disposition: 'ok', artifact: '' },
  'crossing|road': { class: 'road-x-crossing', disposition: 'ok', artifact: '' },
  'barrier|crossing': { class: 'barrier-x-crossing', disposition: 'ok', artifact: '' },
  'building|crossing': { class: 'building-x-crossing', disposition: 'ok', artifact: '' },
};

/** Judge a shared cell held by two different features of kinds `a` and `b`. */
export function classifyPair(a: ClaimKind, b: ClaimKind): PairRule {
  const k = a <= b ? `${a}|${b}` : `${b}|${a}`;
  return PAIR_RULES[k] ?? OK;
}

/** Every conflict class the matrix can emit, for docs / diagnostics. */
export function conflictClasses(): PairRule[] {
  return Object.values(PAIR_RULES)
    .filter((r) => r.disposition !== 'ok')
    .sort((p, q) => p.class.localeCompare(q.class));
}

// ── The ledger ──────────────────────────────────────────────────────────────────────

const key = (x: number, y: number): string => `${x},${y}`;
const parse = (k: string): [number, number] => {
  const i = k.indexOf(',');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
};
/** Numeric (y, then x) cell order — a stable, human-legible iteration for reports. */
const cellCmp = (a: string, b: string): number => {
  const [ax, ay] = parse(a), [bx, by] = parse(b);
  return ay - by || ax - bx;
};

/** One detected intersection between two features whose kinds are not freely compatible.
 *  Aggregated per (class, featureA, featureB); `cells` are the UN-resolved cells. */
export interface SpatialConflict {
  conflictClass: string;
  kindA: ClaimKind;
  kindB: ClaimKind;
  featureA: string;
  featureB: string;
  /** 'error' for un-resolved `needs`/`conflict`; 'info' for an allowed `overlap`. */
  severity: 'error' | 'info';
  /** Whether a resolution MECHANISM exists for this class (a `needs` pair). A `conflict`
   *  pair is `false` — nothing can resolve it until its artifact type ships. */
  resolvable: boolean;
  /** WP-C artifact that resolves the class. */
  artifact: string;
  /** Un-resolved cells (sorted). */
  cells: [number, number][];
  /** How many cells of this pair WERE resolved by a registered artifact (accounting). */
  resolvedCells: number;
}

/** A deterministic snapshot of the ledger's findings + accounting. */
export interface ClaimsReport {
  /** Un-resolved conflicts + info overlaps, sorted by (class, featureA, featureB). */
  conflicts: SpatialConflict[];
  /** conflictClass → count of cells resolved by a registered artifact. */
  resolved: Record<string, number>;
  /** Distinct claimed cells. */
  claimedCells: number;
  /** Claimed cells per kind (a cell counts once per kind present). */
  byKind: Record<string, number>;
  counts: { error: number; info: number };
}

export class ClaimsLedger {
  /** cellKey → claims at that cell (insertion order; sorted at read time). */
  private readonly cells = new Map<string, Claim[]>();
  /** conflictClass → (cellKey → artifactId) registered as resolving that class at that cell. */
  private readonly resolutions = new Map<string, Map<string, string>>();

  /** Assert that `featureId` (of `kind`) occupies `cells`. Idempotent per (feature, cell):
   *  a feature claiming the same cell twice is one claim. */
  claim(featureId: string, kind: ClaimKind, cells: Iterable<[number, number]>, meta?: Record<string, unknown>): void {
    for (const [x, y] of cells) {
      const k = key(Math.round(x), Math.round(y));
      const list = this.cells.get(k) ?? this.cells.set(k, []).get(k)!;
      if (list.some((c) => c.featureId === featureId && c.kind === kind)) continue;
      list.push(meta ? { featureId, kind, meta } : { featureId, kind });
    }
  }

  /** Register that a conflict of `conflictClass` is RESOLVED at `cells` by `artifactId`
   *  (e.g. a crossing over the road×water cells, a gate span over the barrier×water cells).
   *  `featureA`/`featureB` document the two features whose overlap is resolved; matching is
   *  by (class, cell) so a resolution covers whatever features intersect there. */
  resolve(
    conflictClass: string,
    _featureA: string,
    _featureB: string,
    artifactId: string,
    cells: Iterable<[number, number]>,
  ): void {
    const map = this.resolutions.get(conflictClass) ?? this.resolutions.set(conflictClass, new Map()).get(conflictClass)!;
    for (const [x, y] of cells) map.set(key(Math.round(x), Math.round(y)), artifactId);
  }

  private isResolved(conflictClass: string, cellKey: string): boolean {
    return this.resolutions.get(conflictClass)?.has(cellKey) ?? false;
  }

  /** Un-resolved conflicts + info overlaps, deterministically ordered. */
  conflicts(): SpatialConflict[] {
    return this.report().conflicts;
  }

  /** Full deterministic snapshot — the unit of the determinism guarantee. */
  report(): ClaimsReport {
    // bucketKey → aggregate. bucketKey = class \0 featureA \0 featureB (features sorted).
    interface Bucket {
      conflictClass: string; kindA: ClaimKind; kindB: ClaimKind;
      featureA: string; featureB: string; severity: 'error' | 'info';
      resolvable: boolean; artifact: string; cells: string[]; resolvedCells: number;
    }
    const buckets = new Map<string, Bucket>();
    const resolvedByClass = new Map<string, number>();
    const byKind: Record<string, number> = {};

    for (const cellKey of [...this.cells.keys()].sort(cellCmp)) {
      const raw = this.cells.get(cellKey)!;
      // Distinct (featureId, kind), sorted by (kind, featureId) for stable pair order.
      const claims = [...raw].sort((a, b) => a.kind.localeCompare(b.kind) || a.featureId.localeCompare(b.featureId));
      for (const kind of new Set(claims.map((c) => c.kind))) byKind[kind] = (byKind[kind] ?? 0) + 1;

      for (let i = 0; i < claims.length; i++) {
        for (let j = i + 1; j < claims.length; j++) {
          const ci = claims[i], cj = claims[j];
          if (ci.featureId === cj.featureId) continue;            // same feature self-overlap ignored
          const rule = classifyPair(ci.kind, cj.kind);
          if (rule.disposition === 'ok') continue;

          // Canonical feature order (by id) so the pair aggregates stably.
          const [fA, kA, fB, kB] = ci.featureId <= cj.featureId
            ? [ci.featureId, ci.kind, cj.featureId, cj.kind]
            : [cj.featureId, cj.kind, ci.featureId, ci.kind];

          const resolved = rule.disposition === 'needs' && this.isResolved(rule.class, cellKey);
          if (resolved) {
            resolvedByClass.set(rule.class, (resolvedByClass.get(rule.class) ?? 0) + 1);
          }

          const bk = `${rule.class} ${fA} ${fB}`;
          let b = buckets.get(bk);
          if (!b) {
            b = {
              conflictClass: rule.class, kindA: kA as ClaimKind, kindB: kB as ClaimKind,
              featureA: fA, featureB: fB,
              severity: rule.disposition === 'overlap' ? 'info' : 'error',
              resolvable: rule.disposition === 'needs',
              artifact: rule.artifact, cells: [], resolvedCells: 0,
            };
            buckets.set(bk, b);
          }
          if (resolved) b.resolvedCells++;
          else b.cells.push(cellKey);
        }
      }
    }

    const conflicts: SpatialConflict[] = [];
    for (const b of buckets.values()) {
      if (b.cells.length === 0) continue;   // fully resolved (or nothing un-resolved) ⇒ not reported
      conflicts.push({
        conflictClass: b.conflictClass, kindA: b.kindA, kindB: b.kindB,
        featureA: b.featureA, featureB: b.featureB, severity: b.severity,
        resolvable: b.resolvable, artifact: b.artifact,
        cells: b.cells.sort(cellCmp).map(parse), resolvedCells: b.resolvedCells,
      });
    }
    conflicts.sort((p, q) =>
      p.conflictClass.localeCompare(q.conflictClass)
      || p.featureA.localeCompare(q.featureA)
      || p.featureB.localeCompare(q.featureB));

    const resolved: Record<string, number> = {};
    for (const k of [...resolvedByClass.keys()].sort()) resolved[k] = resolvedByClass.get(k)!;

    return {
      conflicts,
      resolved,
      claimedCells: this.cells.size,
      byKind,
      counts: {
        error: conflicts.filter((c) => c.severity === 'error').length,
        info: conflicts.filter((c) => c.severity === 'info').length,
      },
    };
  }
}

// ── Population ────────────────────────────────────────────────────────────────────────

const ROAD_TILE_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);
const isWaterType = (t: string | undefined): boolean => !!t && WATER_TYPES.has(t);

/** Crossing entity kinds (grey-mass presets from the crossing realizer). */
const isCrossingEntity = (e: Entity): boolean => typeof e.kind === 'string' && e.kind.startsWith('bridge_');

/** Absolute footprint (AABB) cells of a placed entity, from its stored `footprint {w,h}`. */
function entityFootprintCells(e: Entity): [number, number][] {
  const fp = (e.properties as { footprint?: { w: number; h: number } } | undefined)?.footprint;
  const ox = Math.floor(e.x), oy = Math.floor(e.y);
  if (!fp) return [[ox, oy]];
  const out: [number, number][] = [];
  for (let dy = 0; dy < fp.h; dy++) for (let dx = 0; dx < fp.w; dx++) out.push([ox + dx, oy + dy]);
  return out;
}

/**
 * Derive the ledger from ALREADY committed world state — no placement changes. This is the
 * observational entry point: the same (seed, worldSeed) world yields the same ledger.
 *
 * Sources (each documented against the WP-C artifact that will resolve its conflicts):
 *   • water     — tiles whose type OR preserved `baseType` is water (a road/bridge over a
 *                 river keeps the water underneath: the terrain is still wet).
 *   • road      — per road-graph edge (feature==='road'); per-edge so road×road junctions
 *                 surface as `info` overlaps (WP-C: RoadJunction). Falls back to the road
 *                 tile mask as one feature when no graph is present.
 *   • crossing  — `bridge` tiles + `bridge_*` entity footprints; registered as resolutions
 *                 of road×water (WP-C: Bridge / WaterGate).
 *   • building  — solid cells via `buildingStructureCells` (door/lawn cells excluded).
 *   • barrier   — blocking cells per run; gate/gap spans registered as resolutions of
 *                 barrier×water and road×barrier (WP-C: WaterGate / Gatehouse).
 */
export function buildClaimsFromWorld(world: World, map: GameMap): ClaimsLedger {
  const led = new ClaimsLedger();
  const tiles = map.tiles;
  const H = tiles.length;

  // water — a single feature spanning every wet cell (incl. water carrying a road/bridge).
  const waterCells: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    const row = tiles[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const t = row[x];
      if (t && (isWaterType(t.type) || isWaterType(t.baseType))) waterCells.push([x, y]);
    }
  }
  led.claim('water', 'water', waterCells);

  // road — per graph edge, else the derived road tile mask.
  const g = map.roadGraph;
  if (g?.edges?.length) {
    for (const e of g.edges) {
      if (e.feature !== 'road') continue;
      led.claim(e.id, 'road', e.polyline.map((p) => [p.x, p.y] as [number, number]));
    }
  } else {
    const roadCells: [number, number][] = [];
    for (let y = 0; y < H; y++) {
      const row = tiles[y];
      if (!row) continue;
      for (let x = 0; x < row.length; x++) if (ROAD_TILE_TYPES.has(row[x]?.type)) roadCells.push([x, y]);
    }
    led.claim('roads', 'road', roadCells);
  }

  // crossing — bridge tiles + bridge_* entities; all become road×water resolutions.
  const crossingCells: [number, number][] = [];
  const bridgeTiles: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    const row = tiles[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) if (row[x]?.type === 'bridge') bridgeTiles.push([x, y]);
  }
  if (bridgeTiles.length) {
    led.claim('crossing:bridge-tiles', 'crossing', bridgeTiles);
    crossingCells.push(...bridgeTiles);
  }
  for (const e of world.query({}) as Entity[]) {
    if (!isCrossingEntity(e)) continue;
    const cells = entityFootprintCells(e);
    led.claim(String(e.id), 'crossing', cells);
    crossingCells.push(...cells);
  }
  if (crossingCells.length) led.resolve('road-x-water', 'crossing', 'water', 'crossing', crossingCells);

  // building — solid cells per building entity.
  for (const [id, set] of buildingStructureCells(world)) {
    led.claim(id, 'building', [...set].map(parse));
  }

  // barrier — blocking cells per run; gate/gap spans resolve barrier×water and road×barrier.
  for (const pb of map.barrierRuns ?? []) {
    const { blocking, gate } = barrierFootprintTiles(pb.run);
    led.claim(pb.id, 'barrier', blocking, { kind: pb.run.kind });
    if (gate.length) {
      led.resolve('barrier-x-water', pb.id, 'water', `${pb.id}:gate`, gate);
      led.resolve('road-x-barrier', pb.id, 'road', `${pb.id}:gate`, gate);
    }
  }

  // Junction ARTIFACTS the world committed (WP-C `map.junctions`) — the first-class objects that
  // OWN each overlap (Bridge / Gatehouse / WaterGate). Registered as resolutions IN ADDITION to
  // the ad-hoc observational resolves above (matching is by (class, cell), so re-registering the
  // same cell is idempotent — the report is unchanged when the artifacts mirror committed state).
  // Absent (`map.junctions` unset, e.g. a synthetic test map) ⇒ byte-identical to the pure
  // observational ledger. This is the seam by which "builders register their outputs" flows into
  // the ledger without the observational population losing its purity.
  for (const j of map.junctions ?? []) {
    led.resolve(j.conflictClass, j.features[0] ?? j.id, j.features[1] ?? j.id, j.id, j.cells);
  }

  return led;
}
