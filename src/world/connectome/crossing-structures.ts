// src/world/connectome/crossing-structures.ts
//
// REALIZATION → World entities (v0 placeholder massing). Bridges the pure crossing
// connectome (detect → build → realize → Placement[]) to the live world: each ancillary
// STRUCTURE placement becomes a grey-massing building entity via the SAME path every other
// building uses — `synthesizeBlueprint(preset)` → `blueprintEntity()` — so it renders as
// grey massing today and picks up generated art (a bridge/booth blueprint) when the reseed
// freeze lifts. The span deck + piers are NOT spawned here yet (the road ribbon's interim
// deck still draws them until the road-flip step); only the buildings the crossing composes.
//
// Pure (returns `Entity[]`, no World mutation, deterministic via name-seeded synthesis); the
// caller adds them at world-build time, before the static draw cache is built.

import type { Entity } from '@/core/types';
import type { RoadGraph } from '@/world/road-graph';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { blueprintEntity } from '@/blueprint/entity';
import { detectCrossings, type CrossingSiteParams, type DetectOptions } from './detect-crossings';
import { buildCrossing } from './crossing-builder';
import { realizeCrossing } from './realize-crossing';

/** Crossing structure kind → an existing building preset to grey-mass it with (until a
 *  dedicated bridge/booth blueprint family lands). Closest-available shapes for v0. */
const PRESET_FOR: Record<string, string> = {
  'building(shop)': 'market_stall',
  'building(toll_booth)': 'guard_post',
  'building(guard_post)': 'guard_post',
  'building(gatehouse)': 'guard_post',
  'building(shrine)': 'shrine',
  'building(watermill)': 'watermill',
};
const FALLBACK_PRESET = 'cottage';

export interface CrossingStructureOptions extends DetectOptions {
  /** Site params when the detector has no resolver — defaults to a modest late-medieval site. */
  defaults?: CrossingSiteParams;
}

/**
 * Build the grey-massing building entities for every road×water crossing in the graph.
 * Detect → build → realize, then turn each `building(*)` placement into a blueprint entity
 * at its laid-out tile. Span/pier placements are skipped (the road ribbon draws the interim
 * deck). Deterministic + pure.
 */
export function buildCrossingStructureEntities(
  graph: RoadGraph | undefined,
  width: number,
  opts: CrossingStructureOptions = {},
): Entity[] {
  const defaults = opts.defaults ?? { era: 'late-medieval', prosperity: 'modest' };
  const specs = detectCrossings(graph, width, { siteParamsAt: opts.siteParamsAt, defaults });
  const out: Entity[] = [];
  for (const spec of specs) {
    const placements = realizeCrossing(buildCrossing(spec));
    for (const p of placements) {
      if (p.category !== 'building') continue;
      const preset = PRESET_FOR[p.kind] ?? FALLBACK_PRESET;
      const rb = synthesizeBlueprint(preset);
      if (!rb) continue;
      const tx = Math.round(p.at.x), ty = Math.round(p.at.y);
      out.push(blueprintEntity(p.nodeId, rb, tx, ty, { poiId: spec.id }));
    }
  }
  return out;
}
