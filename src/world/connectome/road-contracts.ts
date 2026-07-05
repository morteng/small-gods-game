// src/world/connectome/road-contracts.ts
//
// Road RIBBON contracts — the smoothing re-validation Galin 2010 names as the pitfall of every
// pipeline that smooths after routing ("the curve may lie slightly inside or above the terrain"
// → re-segment and re-validate). Our Catmull-Rom + gate/anchor fillets reshape the RENDER
// centerline, and `reconcileFilletRaster` re-derives walkable tiles under it — but a span whose
// candidate cells violate a hard constraint FALLS BACK (nothing written), leaving the visible
// ribbon crossing ground the router never approved. Nothing asserted that. This contract does:
//
//   • roads.ribbon-legal  (invariant) — every divergent span of every road edge's smoothed
//     centerline must reconcile onto legal cells: never open water without a bridge deck,
//     never a curtain blocking cell (gate openings are excluded from the blocking set by
//     construction, so "except at a gate" holds), never a registry building, never a
//     protected green.
//
// Severity is split by what the violation MEANS:
//   ✘ error — a bad cell that is a live ROAD-class tile: something (a building, a curtain)
//     now sits on ground the reconciliation wrote for NPCs to walk. Never legitimate.
//   ▲ warn  — a fallback span whose bad cells were never written: gen already REJECTED any
//     fillet on that edge (`edge.filletRejected`, see reconcileFilletRaster), so what remains
//     is sub-tile Catmull-Rom corner-cutting (e.g. a staircase notch over a river bend) — the
//     ribbon grazes illegal ground for a cell while NPCs walk the legal raw carve. Cosmetic,
//     tracked, not a lint failure.
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
import { ROAD_TILE_TYPES } from '@/world/road-graph';

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
      // A bad cell that is a LIVE road tile means the walkable ribbon itself is violated
      // (something was later stamped onto reconciled ground) — an error. Bad cells on
      // never-written ground are a fallback span the gen pass already answered by rejecting
      // the edge's fillet; the residue is sub-tile smoothing corner-cutting — a warn.
      const written = span.badCells.filter((c) => ROAD_TILE_TYPES.has(ctx.map.tiles[c.y]?.[c.x]?.type ?? ''));
      const severity = written.length > 0 ? 'error' as const : 'warn' as const;
      out.push({
        rule: 'roads.ribbon-legal', severity,
        message: `road ${span.edgeId}'s smoothed ribbon (arc ${span.arcRange[0].toFixed(1)}–`
          + `${span.arcRange[1].toFixed(1)}) needs ${span.cells.length} cell(s) but ${span.badCells.length} `
          + 'violate hard constraints (water-sans-bridge / curtain / building / green)'
          + (written.length > 0
            ? ` — ${written.length} of them are LIVE road tiles NPCs walk`
            : ' — the span fell back (fillet rejected); the ribbon grazes illegal ground the carve avoids'),
        locus: { entities: [span.edgeId], tiles: span.badCells.slice(0, 24) },
        metrics: { cells: span.cells.length, bad: span.badCells.length, writtenBad: written.length },
      });
    }
    return out;
  },
};

registerContract(roadsRibbonLegal);
