// src/world/connectome/scaling-contracts.ts
//
// Settlement-scaling contract (interaction-scaling plan, Phase 4 S4.1,
// docs/superpowers/plans/2026-08-01-interaction-scaling-plan.md) — a WORLD-level invariant
// that fits INTRA-SETTLEMENT road surface against a population proxy across every measurable
// settlement in the world, and warns when the fit is NOT sublinear.
//
// Settlement-scaling theory (Bettencourt et al., cited by the plan's brainstorm doc) predicts
// infrastructure scales SUBLINEARLY with population (exponent ~5/6 ≈ 0.83): a bigger town's
// roads-per-capita should FALL as it grows (shared frontage, denser platting). A fitted
// log-log slope ≥ 1 means the opposite — no economy of scale — worth a warning. Never an
// error: this is an EMERGENT measurement of what worldgen produced, not something a recipe
// asked the generator to actively satisfy (that's what `kind: 'requirement'` is for).
//
// ── Attribution (read before touching the numbers) ─────────────────────────────────────
// Phase 0's probe (`scripts/probe-scaling.ts`) attributed a road EDGE to a POI whenever the
// edge's endpoint NODE carried that POI's `poiRef`, and measured a slope of −0.930
// (R²=0.570, n=13) it explicitly flagged as a probe ATTRIBUTION defect, not a finding: the
// two largest settlements in the default world showed ZERO attributed surface in several
// seeds, because a multi-waypoint inter-POI connection's endpoint node only gets `poiRef`
// when a walked point lands EXACTLY on the POI's stored position (`buildRoadGraph`'s
// `nodeFor`, `src/world/road-graph.ts`) — and because crediting a WHOLE trunk edge to an
// endpoint conflates a settlement's own streets with the cross-country highway that happens
// to start there. The plan is explicit that this must not happen: "make sure the measure
// isn't dominated by long inter-settlement trunk roads that belong to no single town."
//
// This contract measures something narrower and defensible instead: INTRA-SETTLEMENT paved
// area — the analytic road pavedness (`getRoadFeatureGeometry` / `roadPavednessAt`, the exact
// geometry the renderer paints and `buildings.off-roads-ribbon` already treats as ground
// truth, below) summed over tiles within the settlement's own BUILT EXTENT: a radius equal to
// the farthest of its OWN buildings from the POI anchor, plus `SETTLEMENT_MARGIN_TILES` — a
// buffer comfortably wider than a highway's worst-case carriageway reach from centerline
// (`maxCarriageHalfWidth('highway')` ≈1.27 tiles + the 0.18-tile shoulder lip + the 0.5-tile
// pavedness fade reach ≈1.95 tiles total, `src/world/road-state.ts` /
// `src/render/gpu/feature-geometry.ts`), so the margin catches the street a building fronts
// onto without reaching into open countryside. A settlement with no buildings can't have its
// extent measured and is EXCLUDED (not zero-filled) — the same "measure honestly, don't
// smooth over a gap" discipline Phase 0's baseline used for `khar_ordu`-only population.
//
// BIAS this leaves in, stated plainly rather than smoothed over:
//   • Radius-based, not path-attributed: a road segment that merely TRANSITS a settlement's
//     extent circle on its way to a neighbour still counts as this settlement's surface.
//     True per-POI street-network topology would need a graph walk from each POI outward,
//     which is better placed in Phase 3's mean-field flux work (it already threads
//     `roadNeighbours` for migration) than bolted onto a structural lint contract.
//   • Overlapping extents: two closely-spaced settlements' circles can overlap and
//     double-count shared frontage — the SAME convention `road-evolution.ts` already uses
//     for endpoint-driven wear terms ("a road between two settlements is frontage for
//     both"), so this is a documented choice, not an oversight.
//
// ── Population proxy ─────────────────────────────────────────────────────────────────
// A world-level structural contract sees only `{ world, map }` (`DiagnosticContext`) and runs
// at `connectome-lint` time, straight off `generateWithNoise`, BEFORE `seedStatisticalCohorts`
// ever executes (that's a sim-layer step the probe/bootstrap run, never worldgen). Named-NPC
// population is a non-starter here too: Phase 0's baseline found only ONE settlement in the
// default world has any named NPCs at all. So "population" is `DWELLING_CAPACITY`-weighted
// housing capacity summed over the settlement's OWN buildings (`map.buildings[].templateId`,
// the blueprint preset id — see `map-generator.ts`'s "Convert Entity buildings →
// BuildingInstance" pass) — the AUTHORED capacity worldgen actually built, the closest thing
// to "how many people this settlement was built to hold" available before the sim populates
// residents. It gives every generated, inhabited settlement a nonzero, deterministic number.

import type { Diagnostic } from '@/world/connectome-diagnostics';
import type { Contract } from '@/world/connectome-contracts';
import { registerContract } from '@/world/connectome-contracts';
import { getRoadFeatureGeometry, roadPavednessAt } from '@/render/gpu/feature-geometry';
import { DWELLING_CAPACITY } from '@/sim/systems/settlement-growth-system';

/** Buffer (tiles) around a settlement's own farthest building, beyond which pavedness no
 *  longer counts as "this settlement's street" — see the module header for the arithmetic
 *  behind the number (a highway's worst-case pavedness reach is ~1.95 tiles from centerline). */
const SETTLEMENT_MARGIN_TILES = 4;

/** Fitted slope at/above this is "not sublinear" — the plan's ~5/6 prediction fails to hold. */
const SUBLINEAR_SLOPE_THRESHOLD = 1.0;

/** Minimum settlements with a measurable extent + positive population needed to trust a fit —
 *  below this a line has no meaningful residual (2 points always fit exactly). */
const MIN_SETTLEMENTS = 3;

interface FitResult { slope: number; r2: number; n: number }

/** Least-squares log-log slope + R². Small and self-contained rather than imported from
 *  `scripts/probe-scaling.ts`: that script is a standalone probe harness, not a module other
 *  code should depend on, and this contract must stay import-cycle-safe off the gen path. */
function fitLogLog(points: { x: number; y: number }[]): FitResult | null {
  const valid = points.filter((p) => p.x > 0 && p.y > 0);
  if (valid.length < MIN_SETTLEMENTS) return null;
  const xs = valid.map((p) => Math.log(p.x));
  const ys = valid.map((p) => Math.log(p.y));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0) return null;                              // zero population variance — can't fit a slope
  const slope = sxy / sxx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, r2, n };
}

export const infrastructureSublinear: Contract = {
  id: 'scaling.infrastructure-sublinear',
  level: 'world',
  kind: 'invariant',
  severity: 'warn',
  description: 'Settlement-scaling theory predicts infrastructure scales SUBLINEARLY with '
    + 'population (~5/6): per-capita road surface should FALL as a settlement grows. Fits '
    + 'intra-settlement paved area vs housing capacity across the world\'s settlements and '
    + 'warns when the log-log slope is materially ≥ 1 (no economy of scale).',
  evaluate(ctx): Diagnostic[] {
    if (!ctx.map?.roadGraph || ctx.map.roadGraph.edges.length === 0) return [];
    const pois = (ctx.map.worldSeed?.pois ?? []).filter((p) => p.position);
    if (pois.length < MIN_SETTLEMENTS) return [];

    // One sweep of the map's buildings: capacity (dwelling presets only) + extent (every
    // building — a shop or temple fronts onto the street just as much as a house does).
    const capacityByPoi = new Map<string, number>();
    const buildingsByPoi = new Map<string, { x: number; y: number }[]>();
    for (const b of ctx.map.buildings ?? []) {
      if (!b.poiId) continue;
      const cap = DWELLING_CAPACITY[b.templateId];
      if (cap) capacityByPoi.set(b.poiId, (capacityByPoi.get(b.poiId) ?? 0) + cap);
      const arr = buildingsByPoi.get(b.poiId);
      if (arr) arr.push({ x: b.tileX, y: b.tileY });
      else buildingsByPoi.set(b.poiId, [{ x: b.tileX, y: b.tileY }]);
    }

    const geo = getRoadFeatureGeometry(ctx.map);
    const points: { poiId: string; pop: number; surface: number }[] = [];
    // Sorted iteration — deterministic order for reproducible `locus`/metrics regardless of
    // worldSeed.pois array order (unrelated gen changes must not reorder this contract's report).
    for (const poi of [...pois].sort((a, b) => a.id.localeCompare(b.id))) {
      const pop = capacityByPoi.get(poi.id) ?? 0;
      if (pop <= 0) continue;                                // no dwellings — no measurable population
      const buildings = buildingsByPoi.get(poi.id);
      if (!buildings || buildings.length === 0) continue;     // no footprint — extent unmeasurable

      const cx = poi.position!.x, cy = poi.position!.y;
      let radius = 0;
      for (const b of buildings) radius = Math.max(radius, Math.hypot(b.x - cx, b.y - cy));
      radius += SETTLEMENT_MARGIN_TILES;

      let surface = 0;
      const r = Math.ceil(radius);
      const rSq = radius * radius;
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= ctx.map.height || dy * dy > rSq) continue;
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > rSq) continue;
          const x = cx + dx;
          if (x < 0 || x >= ctx.map.width) continue;
          surface += roadPavednessAt(geo, x, y);
        }
      }
      points.push({ poiId: poi.id, pop, surface });
    }

    const fit = fitLogLog(points.map((p) => ({ x: p.pop, y: p.surface })));
    if (!fit) return [];
    if (fit.slope < SUBLINEAR_SLOPE_THRESHOLD) return [];      // sublinear (or fit undefined) — clean

    return [{
      rule: 'scaling.infrastructure-sublinear',
      severity: 'warn',
      message: 'intra-settlement road surface vs housing capacity fits a log-log slope of '
        + `${fit.slope.toFixed(3)} (R²=${fit.r2.toFixed(3)}, n=${fit.n}) across ${points.length} `
        + 'settlements — settlement-scaling theory predicts SUBLINEAR growth (~0.83); this '
        + 'world shows no per-capita economy of scale in its road network.',
      locus: { pois: points.map((p) => p.poiId) },
      metrics: { slope: fit.slope, r2: fit.r2, n: fit.n },
    }];
  },
};

registerContract(infrastructureSublinear);
