// src/world/connectome/wall-contracts.ts
//
// The settlement-level CONTRACTS that make "roads lead to gates" both ENFORCED (slice-1 routing)
// and VALIDATED (here). A walled town's recipe DECLARES these when it commits a ring; the report
// catches any residual. Registered as built-in contracts at import — the eval entry points
// (map-generator, game-query) import this module so the registry always has them.
//
//   • wall.crossing-only-at-gate  (invariant)  — no road tile sits on a curtain blocking cell.
//   • gate.road-connected         (requirement)— every real gate is reached by a road.
//
// Pure + deterministic: reads map.barrierRuns + map.tiles only.

import type { Diagnostic } from '@/world/connectome-diagnostics';
import type { Contract, ContractDeclaration } from '@/world/connectome-contracts';
import { registerContract } from '@/world/connectome-contracts';
import { barrierFootprintTiles, gateFootprintTiles, gateOpeningCell, type PlacedBarrier } from '@/world/barrier';

const ROAD_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);

/** The scoped ring for a contract instance: `scope.entities[0]` is the ring (barrier) id. */
function ringOfScope(barrierRuns: PlacedBarrier[] | undefined, entities?: string[]): PlacedBarrier | undefined {
  const id = entities?.[0];
  if (!id || !barrierRuns) return undefined;
  return barrierRuns.find((b) => b.id === id);
}

const isRoadTile = (map: { tiles: { type: string }[][] }, x: number, y: number): boolean =>
  ROAD_TYPES.has(map.tiles[y]?.[x]?.type ?? '');

/** INVARIANT — the curtain is crossed by roads ONLY at openings (the road-through-wall detector,
 *  the analogue of the existing road.through-building rule). */
export const wallCrossingOnlyAtGate: Contract = {
  id: 'wall.crossing-only-at-gate',
  level: 'settlement',
  kind: 'invariant',
  severity: 'error',
  description: 'No road tile sits on a wall blocking cell — crossings happen only at gates.',
  evaluate(ctx, scope) {
    const b = ringOfScope(ctx.map.barrierRuns, scope.entities);
    if (!b) return [];
    const hits: { x: number; y: number }[] = [];
    for (const [x, y] of barrierFootprintTiles(b.run).blocking) {
      if (isRoadTile(ctx.map, x, y)) hits.push({ x, y });
    }
    if (!hits.length) return [];
    return [{
      rule: 'wall.crossing-only-at-gate', severity: 'error',
      message: `a road crosses the ${b.run.kind} of ${scope.poi ?? b.id} at ${hits.length} cell(s) with no gate`,
      locus: { entities: [b.id], pois: scope.poi ? [scope.poi] : [], tiles: hits.slice(0, 24) },
      metrics: { cells: hits.length },
    }];
  },
};

/** REQUIREMENT — every real gate must have a road THROUGH its opening: a rasterized road tile
 *  inside the gate's own opening cell set (`gateFootprintTiles`), not merely nearby. PASSAGE,
 *  not proximity — the old Chebyshev-box test passed a road running 3 tiles BESIDE the wall
 *  while the ribbon never threaded the opening. `params.reach` (tiles, default 0 = exact) is an
 *  escape hatch: reach > 0 additionally accepts a road within that Chebyshev distance of the
 *  opening cell. Unmet → the actionable half, carrying a `wire_gate` suggestedFix. */
export const gateRoadConnected: Contract = {
  id: 'gate.road-connected',
  level: 'settlement',
  kind: 'requirement',
  severity: 'error',
  description: 'Every town gate must have a road tile inside its own opening cells.',
  evaluate(ctx, scope, params) {
    const b = ringOfScope(ctx.map.barrierRuns, scope.entities);
    if (!b) return [];
    const reach = Math.max(0, Math.round(Number(params?.reach ?? 0)));
    const out: Diagnostic[] = [];
    for (const g of b.run.gates) {
      if (g.kind === 'gap') continue;
      const [gx, gy] = gateOpeningCell(b.run, g);
      let connected = gateFootprintTiles(b.run, g).some(([x, y]) => isRoadTile(ctx.map, x, y));
      for (let dx = -reach; dx <= reach && !connected; dx++) {
        for (let dy = -reach; dy <= reach && !connected; dy++) {
          if (isRoadTile(ctx.map, gx + dx, gy + dy)) connected = true;
        }
      }
      if (!connected) {
        out.push({
          rule: 'gate.road-connected', severity: 'error',
          message: `gate of ${scope.poi ?? b.id} at (${gx},${gy}) has no road through its opening`,
          locus: { entities: [b.id], pois: scope.poi ? [scope.poi] : [], tiles: [{ x: gx, y: gy }] },
          metrics: { reach },
          suggestedFix: { verb: 'wire_gate', args: { ring: b.id, gateT: g.t } },
        });
      }
    }
    return out;
  },
};

// A defensive ring resolves its corners with masonry drum TOWERS (a crenellated stone/brick ring)
// or timber corner POSTS (a palisade). A plain (non-crenellated) masonry ring would get neither.
const isMasonry = (m: string): boolean => m === 'stone' || m === 'brick';
const cornersResolved = (run: PlacedBarrier['run']): boolean =>
  (!!run.crenellated && isMasonry(run.material)) || run.material === 'timber';

/** INVARIANT — every defensive ring must RESOLVE its corners (towers or posts), so a wooden or
 *  plain-stone ring never leaves a raw corner seam. */
export const wallCornersResolved: Contract = {
  id: 'wall.corners-resolved',
  level: 'settlement',
  kind: 'invariant',
  severity: 'warn',
  description: 'A defensive ring resolves every corner with a tower (masonry) or a post (timber).',
  evaluate(ctx, scope) {
    const b = ringOfScope(ctx.map.barrierRuns, scope.entities);
    if (!b || !b.run.centroid || b.run.path.length < 4) return [];
    if (cornersResolved(b.run)) return [];
    return [{
      rule: 'wall.corners-resolved', severity: 'warn',
      message: `the ${b.run.kind} ring of ${scope.poi ?? b.id} (${b.run.material}${b.run.crenellated ? ', crenellated' : ''}) leaves its corners unresolved`,
      locus: { entities: [b.id], pois: scope.poi ? [scope.poi] : [] },
    }];
  },
};

/** INVARIANT — every real gate is FRAMED (masonry gatehouse towers or a timber gate frame), so a
 *  gate never reads as a bare gap between wall-ends. */
export const gateFramed: Contract = {
  id: 'gate.framed',
  level: 'settlement',
  kind: 'invariant',
  severity: 'warn',
  description: 'Every real gate is framed by gatehouse towers (masonry) or gateposts (timber).',
  evaluate(ctx, scope) {
    const b = ringOfScope(ctx.map.barrierRuns, scope.entities);
    if (!b) return [];
    const framed = (!!b.run.crenellated && isMasonry(b.run.material)) || b.run.material === 'timber';
    if (framed) return [];
    const realGates = b.run.gates.filter((g) => g.kind !== 'gap').length;
    if (realGates === 0) return [];
    return [{
      rule: 'gate.framed', severity: 'warn',
      message: `${realGates} gate(s) of ${scope.poi ?? b.id} are unframed (${b.run.material}${b.run.crenellated ? ', crenellated' : ''})`,
      locus: { entities: [b.id], pois: scope.poi ? [scope.poi] : [] },
      metrics: { gates: realGates },
    }];
  },
};

registerContract(wallCrossingOnlyAtGate);
registerContract(gateRoadConnected);
registerContract(wallCornersResolved);
registerContract(gateFramed);

/** Build the contract DECLARATIONS a walled-town recipe commits: for each defensive ring
 *  (centroid-bearing), one crossing invariant + one gate-connectivity requirement, scoped to the
 *  ring and its POI. Called by worldgen after the map is assembled.
 *
 *  RUNTIME COMPLEX RINGS ARE EXEMPT (M4 S5, spike §7 Decision 2): a ring tagged
 *  `ownerPoiId` belongs to a runtime-founded complex (the lord's castle), and NO
 *  runtime road-topology path exists — `roadGraph` is immutable post-gen by
 *  design, so `gate.road-connected` could never be satisfied and would report to
 *  Fate as a world-quality error on every wake, forever. Organic access is the
 *  desire-line trample story (castle traffic wears real trails, no road graph
 *  needed); a runtime road spur is its own epic. The exemption is here at the
 *  DECLARATION builder — worldgen never sees runtime rings today, but any future
 *  re-declaration pass over a live map must keep skipping them. */
export function settlementRingContracts(barrierRuns: PlacedBarrier[]): ContractDeclaration[] {
  const decls: ContractDeclaration[] = [];
  for (const b of barrierRuns) {
    if (b.ownerPoiId) continue;                                  // runtime complex rings exempt (M4)
    if (!b.run.centroid || b.run.path.length < 4) continue;      // defensive rings only
    const poi = b.id.endsWith('_ring') ? b.id.slice(0, -'_ring'.length) : b.id;
    const scope = { poi, entities: [b.id] };
    decls.push({ contract: 'wall.crossing-only-at-gate', scope });
    decls.push({ contract: 'gate.road-connected', scope });
    decls.push({ contract: 'wall.corners-resolved', scope });
    decls.push({ contract: 'gate.framed', scope });
  }
  return decls;
}
