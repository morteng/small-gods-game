// src/world/connectome/crossing-structures.ts
//
// REALIZATION → World entities (v0 placeholder massing). Bridges the pure crossing
// connectome (detect → build → realize → Placement[]) to the live world: each ancillary
// STRUCTURE placement becomes a grey-massing building entity via the SAME path every other
// building uses — `synthesizeBlueprint(preset)` → `blueprintEntity()` — so it renders as
// grey massing today and picks up generated art (a bridge/booth blueprint) when the reseed
// freeze lifts. The span DECK + PIERS are now spawned too (G5): the deck is an inline `deck`
// blueprint riding its bank elevation via the entity's `liftElev` (G4 above-ground primitive),
// piers are inline `pier` blueprints standing from the riverbed up — so a crossing renders as a
// real bridge (deck over the water, supports below) instead of carved-terrain-through-water.
//
// Pure (returns `Entity[]`, no World mutation, deterministic via name-seeded synthesis); the
// caller adds them at world-build time, before the static draw cache is built.

import type { Entity } from '@/core/types';
import type { RoadGraph } from '@/world/road-graph';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { blueprintEntity } from '@/blueprint/entity';
import { toCollision } from '@/blueprint/compile/to-collision';
import { resolveBlueprint } from '@/blueprint/resolve';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';
import { METRES_PER_TILE } from '@/render/scale-contract';
import { detectCrossings, type CrossingSiteParams, type DetectOptions } from './detect-crossings';
import { buildCrossing } from './crossing-builder';
import { realizeCrossing, type Placement } from './realize-crossing';
import { axisOf } from './road-span';

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

/** Below this bank-to-bank span (tiles), a crossing gets no interior piers — the deck rests
 *  on its two banks (a plank/clapper bridge). Wider spans earn supports. */
const MIN_PIER_SPAN_TILES = 3;

/** Crossing material vocabulary → a blueprint walls material the geometry pipeline knows. */
const DECK_MAT: Record<string, string> = { 'dressed-stone': 'stone', timber: 'timber', 'log-plank': 'timber', masonry: 'stone' };
const matOf = (m: unknown): string => DECK_MAT[String(m)] ?? 'timber';

/** Pier top-vs-base taper (batter) DERIVED from the crossing material, not hand-set. A masonry
 *  river pier is built with a pronounced batter and a cutwater to shed the current; a driven
 *  timber pile stands all but vertical. So stone piers taper hard, timber barely at all — the
 *  silhouette reads its construction without a sprite. */
const PIER_BATTER: Record<string, number> = { 'dressed-stone': 0.22, masonry: 0.22, timber: 0.05, 'log-plank': 0.05 };
const batterOf = (m: unknown): number => PIER_BATTER[String(m)] ?? 0.12;

/** Build a deck-segment entity riding the authored bank elevation (G4 liftElev). The deck is
 *  the running surface a road crosses on; it spans bank-to-bank at `lengthTiles`, oriented
 *  along the span axis, and sits ABOVE the water it crosses rather than carving into it. */
function deckEntity(p: Placement, lengthTiles: number, deckElev: number | undefined): Entity | undefined {
  const widthTiles = Math.max(0.5, Number(p.params.width ?? 1));
  // A crossing's bank0→bank1 is the same kind of run as a stair's foot→head — quantize its
  // orientation through the shared road-span primitive (the deck's start/stop axis).
  const dir = axisOf(p.dir.x, p.dir.y);
  const ns = dir === 'ns';   // span runs north-south?
  const fpW = Math.max(1, Math.ceil(ns ? widthTiles : lengthTiles));
  const fpH = Math.max(1, Math.ceil(ns ? lengthTiles : widthTiles));
  const mat = matOf(p.params.material);
  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'prop', preset: 'bridge_deck', category: 'infrastructure',
    footprint: { w: fpW, h: fpH }, materials: { walls: mat, roof: mat, ground: 'dirt' },
    parts: { deck: { type: 'deck', at: { x: 0, y: 0 }, size: { w: fpW, h: fpH }, params: {
      lengthM: lengthTiles * METRES_PER_TILE, widthM: widthTiles * METRES_PER_TILE,
      thicknessM: 0.6, dir, parapet: widthTiles >= 1 ? 'both' : 'none',
    } } },
  };
  const rb = resolveBlueprint([bp], 0);
  const e = blueprintEntity(p.nodeId, rb, Math.round(p.at.x), Math.round(p.at.y));
  // Round the foot to the deck centre so the long sprite straddles the span symmetrically.
  if (deckElev !== undefined) (e.properties as Record<string, unknown>).liftElev = deckElev;
  return e;
}

/** Build a pier entity — a vertical support standing from the riverbed up to the deck. It
 *  billboards from its foot (the bed), so it keeps normal terrain foot-z (no liftElev). */
function pierEntity(p: Placement, heightM: number): Entity {
  const mat = matOf(p.params.material);
  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'prop', preset: 'bridge_pier', category: 'infrastructure',
    footprint: { w: 1, h: 1 }, materials: { walls: mat, roof: mat, ground: 'dirt' },
    parts: { pier: { type: 'pier', at: { x: 0, y: 0 }, size: { w: 1, h: 1 }, params: { heightM, widthM: 1, batter: batterOf(p.params.material) } } },
  };
  const rb = resolveBlueprint([bp], 0);
  return blueprintEntity(p.nodeId, rb, Math.round(p.at.x), Math.round(p.at.y));
}

export interface CrossingStructureOptions extends DetectOptions {
  /** Site params when the detector has no resolver — defaults to a modest late-medieval site. */
  defaults?: CrossingSiteParams;
  /** Normalised terrain elevation (renderer lift space) at a tile — used to ride a bridge
   *  deck on its bank height over the water. Omitted ⇒ decks foot-sample (sink) — callers
   *  that want correct deck height must supply a sampler matching the terrain `heights` buffer. */
  deckElevAt?: (x: number, y: number) => number;
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
 * Build the grey-massing structure entities for every road×water crossing in the graph.
 * Detect → build → realize, then turn each placement into a blueprint entity: `building(*)`
 * → ancillary structures (toll/guard/shrine/mill/shops/gatehouse) nudged clear of obstacles;
 * `span` → a deck riding its bank elevation; `pier` → a support from the bed up. Pure +
 * deterministic (inline deck/pier blueprints seed identically).
 */
export function buildCrossingStructureEntities(
  graph: RoadGraph | undefined,
  width: number,
  opts: CrossingStructureOptions = {},
): Entity[] {
  ensureBuildingTypesRegistered();   // inline deck/pier blueprints resolve directly (a bare
                                     // footbridge never calls synthesizeBlueprint to trigger it)
  const defaults = opts.defaults ?? { era: 'late-medieval', prosperity: 'modest' };
  const specs = detectCrossings(graph, width, { siteParamsAt: opts.siteParamsAt, defaults });
  const out: Entity[] = [];
  // Cells claimed by crossing buildings placed earlier in THIS batch — they aren't in the
  // world yet, so the caller's `cellBlocked` can't see them; this stops two crossing
  // structures (or two crossings near each other) from stacking on the same tile.
  const claimed = new Set<string>();
  for (const spec of specs) {
    const placements = realizeCrossing(buildCrossing(spec));
    // Bank-to-bank span + deck elevation: the deck rides the higher of the two banks so it
    // clears the water; piers stand that height down to the bed (no liftElev, foot-sampled).
    const banks = spec.banks;
    const spanLen = banks ? Math.hypot(banks[1].x - banks[0].x, banks[1].y - banks[0].y) : Math.max(1, spec.spanTiles);
    const deckElev = banks && opts.deckElevAt
      ? Math.max(opts.deckElevAt(Math.round(banks[0].x), Math.round(banks[0].y)), opts.deckElevAt(Math.round(banks[1].x), Math.round(banks[1].y)))
      : undefined;
    const pierHeightM = Math.max(1.5, Math.min(8, spanLen * 0.6));
    // Interior piers only earn their keep on a genuinely wide span — a plank over a 1–2 tile
    // brook rests on its banks (piers crammed under a 2 m deck just read as stacked clutter).
    const wantsPiers = spanLen >= MIN_PIER_SPAN_TILES;
    const deckTile = placements.find((q) => q.category === 'span');
    const pierTilesUsed = new Set<string>();
    if (deckTile) pierTilesUsed.add(`${Math.round(deckTile.at.x)},${Math.round(deckTile.at.y)}`);
    for (const p of placements) {
      if (p.category === 'span') {
        // +1 tile so the deck seats onto both banks (abutments) rather than floating in the gap.
        const e = deckEntity(p, spanLen + 1, deckElev);
        if (e) out.push(e);
        continue;
      }
      if (p.category === 'pier') {
        if (!wantsPiers) continue;
        // Dedupe coincident piers (short spans collapse several onto one tile).
        const key = `${Math.round(p.at.x)},${Math.round(p.at.y)}`;
        if (pierTilesUsed.has(key)) continue;
        pierTilesUsed.add(key);
        out.push(pierEntity(p, pierHeightM));
        continue;
      }
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
