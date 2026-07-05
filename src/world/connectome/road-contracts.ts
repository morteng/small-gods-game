// src/world/connectome/road-contracts.ts
//
// Road RIBBON contracts — the smoothing re-validation Galin 2010 names as the pitfall of every
// pipeline that smooths after routing ("the curve may lie slightly inside or above the terrain"
// → re-segment and re-validate). Our Catmull-Rom + gate/anchor fillets reshape the RENDER
// centerline, and `reconcileFilletRaster` re-derives walkable tiles under it — but a span whose
// candidate cells violate a hard constraint FALLS BACK (nothing written), leaving the visible
// ribbon crossing ground the router never approved. Nothing asserted that. This contract does:
//
//   • roads.ribbon-legal  (invariant, error) — every divergent span of every road edge's
//     FILLETED centerline must reconcile onto legal cells: never open water without a bridge
//     deck, never a curtain blocking cell (gate openings are excluded from the blocking set by
//     construction, so "except at a gate" holds), never a registry building, never a protected
//     green.
//
// Registered as a built-in WORLD-level invariant at import — `evaluateContracts` runs every
// world-level invariant globally (no per-recipe declaration needed; declaring it as well would
// double-report). The eval entry points (map-generator, game-query) import this module so the
// registry always has it. Pure + deterministic: `planFilletReconcile` is the READ half of the
// reconciliation — no tile writes.

import type { Diagnostic } from '@/world/connectome-diagnostics';
import type { Contract } from '@/world/connectome-contracts';
import { registerContract } from '@/world/connectome-contracts';
import { planFilletReconcile } from '@/world/road-deformation';

export const roadsRibbonLegal: Contract = {
  id: 'roads.ribbon-legal',
  level: 'world',
  kind: 'invariant',
  severity: 'error',
  description: 'Every reconciled road-ribbon cell is legal: no water without a bridge, no curtain '
    + 'crossing outside a gate, no building underfoot — the smoothed ribbon NPCs walk is the one the router approved.',
  evaluate(ctx) {
    if (!ctx.map?.roadGraph) return [];
    const out: Diagnostic[] = [];
    for (const span of planFilletReconcile(ctx.map, ctx.world)) {
      if (span.cells.length > 0 && span.badCells.length === 0) continue;   // reconciled — legal
      out.push({
        rule: 'roads.ribbon-legal', severity: 'error',
        message: `road ${span.edgeId}'s smoothed ribbon (arc ${span.arcRange[0].toFixed(1)}–`
          + `${span.arcRange[1].toFixed(1)}) needs ${span.cells.length} cell(s) but ${span.badCells.length} `
          + 'violate hard constraints (water-sans-bridge / curtain / building / green) — the span '
          + 'fell back and the visible ribbon departs the walkable carve',
        locus: { entities: [span.edgeId], tiles: span.badCells.slice(0, 24) },
        metrics: { cells: span.cells.length, bad: span.badCells.length },
      });
    }
    return out;
  },
};

registerContract(roadsRibbonLegal);
