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
import { toCollision } from '@/blueprint/compile/to-collision';
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
  /** A cell where a building's SOLID footprint may NOT go — already taken by an existing
   *  building's structure, a carved road, or water. When supplied, an ancillary placement
   *  whose solid cells overlap is nudged to nearby clear ground (deterministic ring search),
   *  or DROPPED if none is found within {@link NUDGE_RADIUS}. So a crossing sited beside a
   *  settlement never overlaps it (closes spatial-invariants INV1/INV3 at the crossing). When
   *  omitted, placements land at their laid-out tile unchanged (byte-identical legacy path). */
  cellBlocked?: (x: number, y: number) => boolean;
}

/** Search radius (tiles, Chebyshev) for nudging an overlapping ancillary structure to clear
 *  ground before giving up and dropping it. A crossing's aprons are only ~1–2 tiles inland, so
 *  a few tiles is plenty to clear a settlement edge without wandering into an unrelated place. */
const NUDGE_RADIUS = 4;

/** Integer offsets ordered by increasing Chebyshev ring (0,0 first), deterministic. A solid
 *  footprint is tried at each in turn; the first fully-clear position wins. */
const NUDGE_OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
  const offs: Array<[number, number]> = [];
  for (let r = 0; r <= NUDGE_RADIUS; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r) offs.push([dx, dy]);
  return offs;
})();

/** Absolute SOLID (wall) cells of a blueprint placed at (ox,oy): `blocked` minus door cells —
 *  the lawn/door interface is passable and may legitimately abut a road, so only solid cells
 *  must avoid collisions (mirrors `buildingStructureCells` in the connectome linter). */
function solidCells(
  collision: { blocked: string[]; doorCells: string[] },
  ox: number,
  oy: number,
): Array<[number, number]> {
  const doors = new Set(collision.doorCells);
  const out: Array<[number, number]> = [];
  for (const local of collision.blocked) {
    if (doors.has(local)) continue;
    const ci = local.indexOf(',');
    out.push([ox + Number(local.slice(0, ci)), oy + Number(local.slice(ci + 1))]);
  }
  return out;
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
  // Cells claimed by crossing buildings placed earlier in THIS batch — they aren't in the
  // world yet, so the caller's `cellBlocked` can't see them; this stops two crossing
  // structures (or two crossings near each other) from stacking on the same tile.
  const claimed = new Set<string>();
  for (const spec of specs) {
    const placements = realizeCrossing(buildCrossing(spec));
    for (const p of placements) {
      if (p.category !== 'building') continue;
      const preset = PRESET_FOR[p.kind] ?? FALLBACK_PRESET;
      const rb = synthesizeBlueprint(preset);
      if (!rb) continue;
      const collision = toCollision(rb);
      const base = { x: Math.round(p.at.x), y: Math.round(p.at.y) };
      // Find the nearest position (laid-out tile first) whose solid footprint clears existing
      // buildings/roads/water and the cells already claimed this batch. Drop if none is near.
      let chosen: { x: number; y: number } | null = null;
      for (const [dx, dy] of NUDGE_OFFSETS) {
        const cells = solidCells(collision, base.x + dx, base.y + dy);
        if (cells.length === 0) { chosen = { x: base.x + dx, y: base.y + dy }; break; } // degenerate footprint
        const clear = cells.every(([cx, cy]) => !opts.cellBlocked?.(cx, cy) && !claimed.has(`${cx},${cy}`));
        if (clear) { chosen = { x: base.x + dx, y: base.y + dy }; break; }
      }
      if (!chosen) continue; // un-placeable beside the settlement — drop rather than overlap
      for (const [cx, cy] of solidCells(collision, chosen.x, chosen.y)) claimed.add(`${cx},${cy}`);
      out.push(blueprintEntity(p.nodeId, rb, chosen.x, chosen.y, { poiId: spec.id }));
    }
  }
  return out;
}
