// src/world/junction-artifacts.ts
//
// JUNCTION ARTIFACTS + the RECONCILER (world-compiler WP-C).
//
// The claims ledger (`claims.ts`) detects, structurally, every cell where two incompatible
// features overlap. A junction artifact is the typed OBJECT that OWNS such an overlap: a road
// crossing water is a `Bridge`, a wall meeting a channel a `WaterGate`, a road piercing a wall
// a `Gatehouse`, two roads meeting a `RoadJunction`. Each artifact owns the cells of its overlap
// and knows which conflict class it resolves — so a feature×feature intersection stops being a
// silent tile collision and becomes a first-class, representable thing (the "combinations become
// unrepresentable as silent overlaps" goal of the refactor).
//
// Two entry points, both PURE + DETERMINISTIC (sorted iteration, no `Math.random`/`Date.now`):
//
//   • `deriveBuiltJunctions(world, map)` (WP-C part C-2) — read what the EXISTING builders
//     already committed (crossing decks + bridge tiles; barrier gate/gap spans) into typed
//     artifacts, so the world carries its junctions as data (`map.junctions`). These are the
//     RESOLUTIONS the ledger already honoured observationally, now first-class.
//
//   • `reconcile(ledger, world?, map?)` (WP-C part C-1) — for each STILL-unresolved conflict,
//     PROPOSE the mapped artifact where one can be derived from the overlap itself, register its
//     cells as a resolution, and return it. Re-running `ledger.conflicts()` then converges the
//     `needs`-class errors (road×water, barrier×water, road×barrier) toward zero. Classes with no
//     artifact type yet (building×building/×water, road×building) are returned UNRESOLVED — the
//     reconciler never invents a resolution the world model can't represent.

import type { GameMap, Entity } from '@/core/types';
import type { World } from '@/world/world';
import { ClaimsLedger, buildClaimsFromWorld, type SpatialConflict } from '@/world/claims';
import { WATER_TYPES } from '@/core/constants';
import { barrierFootprintTiles, gateFootprintTiles } from '@/world/barrier';

// ── The artifact taxonomy ─────────────────────────────────────────────────────────────

export type JunctionKind = 'Bridge' | 'WaterGate' | 'Gatehouse' | 'RoadJunction' | 'Stair' | 'Ramp';

/** Common shape: every artifact owns cells and names the conflict class + features it reconciles. */
export interface JunctionBase {
  /** Stable, deterministic id (`<Kind>#<n>` for proposals; a builder id for built artifacts). */
  id: string;
  /** The cells this artifact OWNS — registered as a resolution of `conflictClass`. Sorted. */
  cells: [number, number][];
  /** The claims conflict class this artifact resolves (e.g. `road-x-water`). */
  conflictClass: string;
  /** The features whose overlap it owns (documentation; matching is by class+cell). */
  features: string[];
  /** `built` = derived from a committed builder output; `proposed` = a reconciler proposal. */
  origin: 'built' | 'proposed';
}

/** road × water — a deck bank→bank + piers; owns the `bridge` tiles + deck/pier cells. */
export interface BridgeJunction extends JunctionBase { type: 'Bridge' }
/** barrier × water — a gap / water-gate span where a wall meets a channel; owns the opening cells. */
export interface WaterGateJunction extends JunctionBase { type: 'WaterGate' }
/** road × barrier (and barrier × building) — a gate opening the wall admits a road/building through. */
export interface GatehouseJunction extends JunctionBase { type: 'Gatehouse' }
/** road × road — a typed node where edges meet; owns the shared cells. */
export interface RoadJunctionJunction extends JunctionBase { type: 'RoadJunction'; degree: number }
/** grade × path — RESERVED (no producer yet): a stair/ramp across a terrace edge. */
export interface StairJunction extends JunctionBase { type: 'Stair' }
export interface RampJunction extends JunctionBase { type: 'Ramp' }

export type JunctionArtifact =
  | BridgeJunction | WaterGateJunction | GatehouseJunction
  | RoadJunctionJunction | StairJunction | RampJunction;

/** Conflict class → the artifact KIND that reconciles it. Classes absent here have no artifact
 *  type (building displacement / road reroute) — the reconciler leaves them unresolved. */
const KIND_FOR_CLASS: Readonly<Record<string, JunctionKind>> = {
  'road-x-water': 'Bridge',
  'barrier-x-water': 'WaterGate',
  'road-x-barrier': 'Gatehouse',
  'barrier-x-building': 'Gatehouse',
  'road-x-road': 'RoadJunction',
};

// ── Reconciler (C-1) ──────────────────────────────────────────────────────────────────

export interface ReconcileResult {
  /** The proposed artifacts, one per reconcilable conflict, deterministically ordered. */
  artifacts: JunctionArtifact[];
  /** Conflicts with no artifact type to resolve them (building/road displacement classes). */
  unresolved: SpatialConflict[];
}

/**
 * Propose a junction artifact for every unresolved conflict the ledger reports, register each
 * proposal's cells as a resolution, and return the artifacts + the residue that no artifact type
 * can own. Idempotent-ish: calling it, then re-reporting, drops the `needs`-class errors it
 * resolved (an `overlap`/`conflict` class stays reported — the ledger only clears `needs`, so a
 * RoadJunction documents the seam without silencing the info, and a barrier×building conflict is
 * surfaced until its artifact type actually ships).
 *
 * `world`/`map` are accepted for richer geometry derivation (a compiler-grade Bridge would sample
 * the channel to place piers); the observational reconciler owns the overlap CELLS directly from
 * the conflict, so they are currently only advisory — hence optional, so the ledger can be
 * reconciled in isolation (unit tests, a future planner) without a full world.
 */
export function reconcile(ledger: ClaimsLedger, _world?: World, _map?: GameMap): ReconcileResult {
  const artifacts: JunctionArtifact[] = [];
  const unresolved: SpatialConflict[] = [];
  const seq: Record<string, number> = {};
  // conflicts() is already deterministically ordered (class, featureA, featureB).
  for (const c of ledger.conflicts()) {
    const kind = KIND_FOR_CLASS[c.conflictClass];
    if (!kind) { unresolved.push(c); continue; }
    const n = (seq[kind] = (seq[kind] ?? 0) + 1) - 1;
    const art = makeArtifact(kind, `${kind}#${n}`, c.conflictClass, [c.featureA, c.featureB], c.cells, 'proposed');
    // Register the proposal so `ledger.conflicts()` re-reports without these cells. The ledger
    // only honours resolutions for `needs` classes, so this converges road×water / barrier×water
    // / road×barrier errors; a road×road overlap stays info (RoadJunction owns it in the compile
    // phase, not by silencing the report today).
    ledger.resolve(c.conflictClass, c.featureA, c.featureB, art.id, c.cells);
    artifacts.push(art);
  }
  return { artifacts, unresolved };
}

/** Construct the typed artifact for a kind. `RoadJunction` records its degree (features met). */
function makeArtifact(
  kind: JunctionKind, id: string, conflictClass: string, features: string[],
  cells: [number, number][], origin: 'built' | 'proposed',
): JunctionArtifact {
  const base = { id, cells: sortCells(cells), conflictClass, features, origin };
  switch (kind) {
    case 'Bridge': return { type: 'Bridge', ...base };
    case 'WaterGate': return { type: 'WaterGate', ...base };
    case 'Gatehouse': return { type: 'Gatehouse', ...base };
    case 'RoadJunction': return { type: 'RoadJunction', degree: new Set(features).size, ...base };
    case 'Stair': return { type: 'Stair', ...base };
    case 'Ramp': return { type: 'Ramp', ...base };
  }
}

const sortCells = (cells: [number, number][]): [number, number][] =>
  [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

// ── Built-junction derivation (C-2) ─────────────────────────────────────────────────────

const isWaterType = (t: string | undefined): boolean => !!t && WATER_TYPES.has(t);
const isCrossingEntity = (e: Entity): boolean => typeof e.kind === 'string' && e.kind.startsWith('bridge_');

/** Contiguous 4-connected runs of `bridge`-typed tiles — each is one crossing. */
function bridgeTileRuns(map: GameMap): [number, number][][] {
  const { tiles, width, height } = map;
  const seen = new Set<string>();
  const runs: [number, number][][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y]?.[x]?.type !== 'bridge' || seen.has(`${x},${y}`)) continue;
      const run: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];
      seen.add(`${x},${y}`);
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        run.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          const nx = cx + dx, ny = cy + dy, nk = `${nx},${ny}`;
          if (!seen.has(nk) && tiles[ny]?.[nx]?.type === 'bridge') { seen.add(nk); stack.push([nx, ny]); }
        }
      }
      runs.push(run);
    }
  }
  return runs;
}

/**
 * Read the junctions the world's EXISTING builders already committed into typed artifacts:
 *   • Bridge — each contiguous `bridge`-tile run + any `bridge_*` entity footprints over it,
 *     resolving road×water (the crossing IS the resolution).
 *   • Gatehouse / WaterGate — each barrier gate span: a `gate` (a road crossing) → Gatehouse
 *     resolving road×barrier; a `gap` (a wall meeting water / a soft opening) → WaterGate
 *     resolving barrier×water.
 * Pure + deterministic (sorted). This is the observational half of "builders register their
 * outputs": the same resolutions `buildClaimsFromWorld` derives ad-hoc, made first-class.
 */
export function deriveBuiltJunctions(world: World, map: GameMap): JunctionArtifact[] {
  const out: JunctionArtifact[] = [];

  // Crossings → Bridge artifacts. One per contiguous bridge-tile run (its deck/pier entity
  // cells folded in), plus any bridge_* entity whose footprint sits off the tile runs.
  const runs = bridgeTileRuns(map);
  const entityCells: [number, number][] = [];
  for (const e of world.query({}) as Entity[]) {
    if (!isCrossingEntity(e)) continue;
    const fp = (e.properties as { footprint?: { w: number; h: number } } | undefined)?.footprint;
    const ox = Math.floor(e.x), oy = Math.floor(e.y);
    if (fp) for (let dy = 0; dy < fp.h; dy++) for (let dx = 0; dx < fp.w; dx++) entityCells.push([ox + dx, oy + dy]);
    else entityCells.push([ox, oy]);
  }
  runs.forEach((run, i) => {
    const cells = [...run];
    // Fold in deck/pier entity cells that touch this run (share a bridge tile).
    const runSet = new Set(run.map(([x, y]) => `${x},${y}`));
    for (const c of entityCells) if (runSet.has(`${c[0]},${c[1]}`)) cells.push(c);
    out.push(makeArtifact('Bridge', `bridge:run#${i}`, 'road-x-water', ['crossing', 'water'], cells, 'built') as BridgeJunction);
  });

  // Barrier openings → Gatehouse (gate) / WaterGate (gap) artifacts, one per declared span.
  for (const pb of map.barrierRuns ?? []) {
    pb.run.gates.forEach((g, gi) => {
      const cells = gateFootprintTiles(pb.run, g);
      if (cells.length === 0) return;
      // Absent kind defaults to 'gate' (a road opening) — matches BarrierGate's documented default.
      if ((g.kind ?? 'gate') === 'gate') {
        out.push(makeArtifact('Gatehouse', `${pb.id}:gate#${gi}`, 'road-x-barrier', [pb.id, 'road'], cells, 'built') as GatehouseJunction);
      } else {
        out.push(makeArtifact('WaterGate', `${pb.id}:gap#${gi}`, 'barrier-x-water', [pb.id, 'water'], cells, 'built') as WaterGateJunction);
      }
    });
  }

  // Deterministic order: kind, then id.
  return out.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
}

/** Register a set of junction artifacts as resolutions on a ledger (the `map.junctions` seam:
 *  what a builder committed becomes what the ledger treats as owned). Idempotent per (class,cell). */
export function applyJunctions(ledger: ClaimsLedger, junctions: readonly JunctionArtifact[]): void {
  for (const j of junctions) {
    ledger.resolve(j.conflictClass, j.features[0] ?? j.id, j.features[1] ?? j.id, j.id, j.cells);
  }
}

/** Convenience: build the observational ledger, apply the map's committed junctions (if any),
 *  and reconcile the residue — the full plan→reconcile pass over a committed world, for tooling. */
export function reconcileWorld(world: World, map: GameMap): { ledger: ClaimsLedger } & ReconcileResult {
  const ledger = buildClaimsFromWorld(world, map);
  if (map.junctions?.length) applyJunctions(ledger, map.junctions);
  const res = reconcile(ledger, world, map);
  return { ledger, ...res };
}
