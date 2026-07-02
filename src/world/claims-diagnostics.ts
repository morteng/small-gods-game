// src/world/claims-diagnostics.ts
//
// The claims-ledger LINT rule. It builds the spatial claims ledger from committed world
// state (`buildClaimsFromWorld`) and reports its conflicts as `Diagnostic`s, in the exact
// shape the connectome linter already speaks — so it can be registered into `DEFAULT_RULES`
// by the integrator (WP-A owns `connectome-diagnostics.ts`; this file must NOT edit it).
//
// One rule, `claims.unresolved`, emits:
//   • ERROR  — every un-resolved conflict (a `needs` pair with no crossing/gate covering the
//              cell, or an always-`conflict` pair). These are the O(N²) guard failures the
//              ledger detects structurally instead of visually.
//   • INFO   — `road-x-road` overlaps (junctions). Allowed today; WP-C's RoadJunction artifact
//              will own the seam. Surfaced so the studio overlay can paint pressure points.
//
// Conflict class → WP-C junction artifact that will resolve it (the reconciler seam):
//   road-x-water     → Bridge / WaterGate   (a crossing covering the wet road cells)
//   barrier-x-water  → WaterGate            (a gap / water-gate span where the wall meets water)
//   road-x-barrier   → Gatehouse            (a gate opening where the road pierces the wall)
//   barrier-x-building → Gatehouse          (wall re-route or a gatehouse embedding the building)
//   road-x-building  → (reroute)            (no artifact — the road plans around the footprint)
//   building-x-water → (displace)           (no artifact — the placer never sites on water)
//   building-x-building → (displace)        (no artifact — spatial-invariants INV1)
//   road-x-road      → RoadJunction         (a typed junction node instead of a silent overlap)

import type { Diagnostic, DiagnosticRule } from '@/world/connectome-diagnostics';
import { buildClaimsFromWorld, type SpatialConflict } from '@/world/claims';

/** Trim a conflict's cell list to a bounded, deterministic sample for the locus. */
function locusTiles(c: SpatialConflict): { x: number; y: number }[] {
  return c.cells.slice(0, 32).map(([x, y]) => ({ x, y }));
}

/** ERROR/INFO — cells claimed by two features whose kinds are not freely compatible, and
 *  which no junction artifact resolves. Built from the claims ledger; deterministic. */
export const claimsUnresolvedRule: DiagnosticRule = {
  id: 'claims.unresolved',
  severity: 'error',
  description: 'Two features claim the same cell with no junction artifact resolving the overlap.',
  evaluate(ctx) {
    const ledger = buildClaimsFromWorld(ctx.world, ctx.map);
    const out: Diagnostic[] = [];
    for (const c of ledger.conflicts()) {
      const resolvedNote = c.resolvedCells > 0 ? ` (${c.resolvedCells} other cell(s) resolved by an artifact)` : '';
      const kindNote = c.severity === 'info'
        ? `overlap — a ${c.artifact} should own this junction`
        : c.resolvable
          ? `un-resolved — needs a ${c.artifact}`
          : `conflict — ${c.artifact}`;
      out.push({
        rule: this.id,
        severity: c.severity,
        message: `${c.conflictClass}: ${c.featureA} (${c.kindA}) × ${c.featureB} (${c.kindB}) `
          + `on ${c.cells.length} cell(s) — ${kindNote}${resolvedNote}`,
        locus: { entities: [c.featureA, c.featureB], tiles: locusTiles(c) },
        metrics: { cells: c.cells.length, resolvedCells: c.resolvedCells },
      });
    }
    // conflicts() is already deterministically ordered (class, featureA, featureB); errors
    // and infos interleave by class, which is fine for a report — keep that stable order.
    return out;
  },
};

export default claimsUnresolvedRule;
