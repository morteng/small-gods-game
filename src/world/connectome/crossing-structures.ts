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
import { wheelWaterOrientation } from '@/blueprint/wheel-orientation';
import { toCollision } from '@/blueprint/compile/to-collision';
import { resolveBlueprint } from '@/blueprint/resolve';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';
import { METRES_PER_TILE } from '@/render/scale-contract';
import { detectCrossings, type CrossingSiteParams, type DetectOptions } from './detect-crossings';
import { buildCrossing } from './crossing-builder';
import { realizeCrossing, type Placement } from './realize-crossing';

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
  // The deck spans the crossing as ONE straight slab at the TRUE bank→bank bearing (not snapped
  // to a cardinal): a diagonal ford gets a diagonal deck whose ends seat on its two banks, where
  // the road resumes. The footprint is the rotated slab's axis-aligned bounding box; the slab is
  // centred inside it (see deckPartType), so placing that AABB centred on the crossing midpoint
  // lands the slab ends on the banks.
  const yawDeg = (Math.atan2(p.dir.y, p.dir.x) * 180) / Math.PI;
  const c = Math.abs(Math.cos((yawDeg * Math.PI) / 180));
  const s = Math.abs(Math.sin((yawDeg * Math.PI) / 180));
  const fpW = Math.max(1, Math.ceil(lengthTiles * c + widthTiles * s));
  const fpH = Math.max(1, Math.ceil(lengthTiles * s + widthTiles * c));
  const mat = matOf(p.params.material);
  // The entity origin is tile-integer; the crossing midpoint usually isn't. Round the
  // origin and flow the sub-tile REMAINDER into the part's local offset so the slab still
  // centres exactly on the ford midpoint (was up to half a tile off before).
  const ox = Math.round(p.at.x - fpW / 2), oy = Math.round(p.at.y - fpH / 2);
  const fx = p.at.x - fpW / 2 - ox, fy = p.at.y - fpH / 2 - oy;
  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'prop', preset: 'bridge_deck', category: 'infrastructure',
    footprint: { w: fpW, h: fpH }, materials: { walls: mat, roof: mat, ground: 'dirt' },
    parts: { deck: { type: 'deck', at: { x: fx, y: fy }, size: { w: fpW, h: fpH }, params: {
      lengthM: lengthTiles * METRES_PER_TILE, widthM: widthTiles * METRES_PER_TILE,
      thicknessM: 0.6, yawDeg, parapet: widthTiles >= 1 ? 'both' : 'none',
    } } },
  };
  const rb = resolveBlueprint([bp], 0);
  // Centre the footprint AABB on the crossing midpoint so the slab straddles the span symmetrically
  // and its two ends fall on the banks.
  const e = blueprintEntity(p.nodeId, rb, ox, oy);
  if (deckElev !== undefined) (e.properties as Record<string, unknown>).liftElev = deckElev;
  return e;
}

/** Build a masonry arch-bay entity — one span springing between two piers, under the deck. Like
 *  a pier it stands from the bed (no liftElev); its frame yaws to face across the watercourse via
 *  the shared span axis. Sized to the bay it fills (`spanTiles`) and the traffic width it carries. */
function archEntity(p: Placement, spanTiles: number, widthTiles: number, riseM: number): Entity {
  const mat = matOf(p.params.material);
  // The arch springs along the TRUE bank→bank bearing (like the deck), so a diagonal ford gets a
  // diagonal arch under its diagonal deck rather than a cardinal-snapped frame.
  const yawDeg = (Math.atan2(p.dir.y, p.dir.x) * 180) / Math.PI;
  const a = (yawDeg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const span = Math.max(1, spanTiles);          // tiles along the span
  const depth = Math.max(0.5, widthTiles);      // tiles across (traffic width / arch thickness)
  const fpW = Math.max(1, Math.ceil(Math.abs(span * cs) + Math.abs(depth * sn)));
  const fpH = Math.max(1, Math.ceil(Math.abs(span * sn) + Math.abs(depth * cs)));
  // The arch prim's `at` is its SPRINGING ORIGIN and it rotates about that point; its geometry
  // centre sits at at + (span/2)·dir + (depth/2)·perp (dir=(cs,sn), perp=(−sn,cs)). Back the origin
  // off the footprint centre by both so the rotated arch centres in the AABB at any bearing —
  // plus the sub-tile remainder of the entity-origin rounding, like the deck.
  const ox = Math.round(p.at.x - fpW / 2), oy = Math.round(p.at.y - fpH / 2);
  const fx = p.at.x - fpW / 2 - ox, fy = p.at.y - fpH / 2 - oy;
  const ax = fx + fpW / 2 - (span / 2) * cs + (depth / 2) * sn;
  const ay = fy + fpH / 2 - (span / 2) * sn - (depth / 2) * cs;
  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'prop', preset: 'bridge_arch', category: 'infrastructure',
    footprint: { w: fpW, h: fpH }, materials: { walls: mat, roof: mat, ground: 'dirt' },
    parts: { arch: { type: 'arch_span', at: { x: ax, y: ay }, size: { w: fpW, h: fpH }, params: {
      spanM: span * METRES_PER_TILE, riseM, thicknessM: widthTiles * METRES_PER_TILE, yawDeg,
    } } },
  };
  const rb = resolveBlueprint([bp], 0);
  return blueprintEntity(p.nodeId, rb, ox, oy);
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

/** Elevation context for the span pieces — deck rides its banks, piers reach the bed. */
export interface SpanEntityOptions {
  /** Normalised terrain elevation (renderer lift space) at a tile — the deck rides the
   *  higher bank. Omitted ⇒ decks foot-sample (sink). */
  deckElevAt?: (x: number, y: number) => number;
  /** Raw normalised heightfield elevation (deckHf space) — pier/arch height from real depth. */
  elevAt?: (x: number, y: number) => number;
  /** Metres per normalised elevation unit (`worldStyle.mountainRelief`). */
  reliefM?: number;
}

/**
 * Deck + piers + arches for ONE crossing spec — the SHARED structural realization used by
 * BOTH bridge producers: worldgen road×water crossings and runtime settlement bridge
 * annexation (`annexAcrossBridge`). Before this seam existed the annexed town bridge was
 * flat tiles only — no deck, piers or arches — a second, visually disjoint bridge system.
 */
export function buildCrossingSpanEntities(spec: import('./crossing-builder').CrossingSpec, opts: SpanEntityOptions = {}): Entity[] {
  ensureBuildingTypesRegistered();
  const placements = realizeCrossing(buildCrossing(spec));
  return spanEntitiesFromPlacements(spec, placements, opts);
}

/** The span/pier/arch subset of a crossing's placements → entities (shared inner). */
function spanEntitiesFromPlacements(
  spec: { banks?: [{ x: number; y: number }, { x: number; y: number }]; spanTiles: number },
  placements: Placement[],
  opts: SpanEntityOptions,
): Entity[] {
  const out: Entity[] = [];
  // Bank-to-bank span + deck elevation: the deck rides the higher of the two banks so it
  // clears the water; piers stand that height down to the bed (no liftElev, foot-sampled).
  const banks = spec.banks;
  const spanLen = banks ? Math.hypot(banks[1].x - banks[0].x, banks[1].y - banks[0].y) : Math.max(1, spec.spanTiles);
  const deckElev = banks && opts.deckElevAt
    ? Math.max(opts.deckElevAt(Math.round(banks[0].x), Math.round(banks[0].y)), opts.deckElevAt(Math.round(banks[1].x), Math.round(banks[1].y)))
    : undefined;
  // Pier / arch HEIGHT from the crossing's real depth when a heightfield sampler is supplied:
  // the deck rides the higher bank, the piers reach down to the carved bed, so the metric
  // clearance (bank − bed) · reliefM is how tall they stand. Without a sampler, fall back to the
  // span proxy (wider rivers tend to run deeper) so callers without elevation stay byte-stable.
  let pierHeightM = Math.max(1.5, Math.min(8, spanLen * 0.6));
  if (banks && opts.elevAt && opts.reliefM) {
    const bankNorm = Math.max(opts.elevAt(Math.round(banks[0].x), Math.round(banks[0].y)), opts.elevAt(Math.round(banks[1].x), Math.round(banks[1].y)));
    const bedNorm = opts.elevAt(Math.round((banks[0].x + banks[1].x) / 2), Math.round((banks[0].y + banks[1].y) / 2));
    const clearanceM = Math.max(0, bankNorm - bedNorm) * opts.reliefM;
    pierHeightM = Math.max(1.5, Math.min(14, clearanceM + 0.6));   // +0.6 ≈ deck thickness to its underside
  }
  // Interior piers only earn their keep on a genuinely wide span — a plank over a 1–2 tile
  // brook rests on its banks (piers crammed under a 2 m deck just read as stacked clutter).
  const wantsPiers = spanLen >= MIN_PIER_SPAN_TILES;
  const deckTile = placements.find((q) => q.category === 'span');
  const pierTilesUsed = new Set<string>();
  if (deckTile) pierTilesUsed.add(`${Math.round(deckTile.at.x)},${Math.round(deckTile.at.y)}`);
  // Arch bays: each masonry arch fills one bay of the deck. A single-arch packhorse bridge spans
  // a brook bank-to-bank (no interior piers); a long viaduct marches many. The opening rises to
  // ~⅔ the pier height so it sits under the deck, and is as deep as the traffic width.
  const archCount = placements.reduce((n, q) => n + (q.category === 'arch' ? 1 : 0), 0);
  const deckWidthTiles = Math.max(0.5, Number(deckTile?.params.width ?? 1));
  const archBayTiles = archCount > 0 ? spanLen / archCount : spanLen;
  const archRiseM = Math.max(1, Math.min(6, pierHeightM * 0.7));
  for (const p of placements) {
    if (p.category === 'span') {
      // +1 tile so the deck seats onto both banks (abutments) rather than floating in the gap.
      const e = deckEntity(p, spanLen + 1, deckElev);
      if (e) out.push(e);
    } else if (p.category === 'pier') {
      if (!wantsPiers) continue;
      // Dedupe coincident piers (short spans collapse several onto one tile).
      const key = `${Math.round(p.at.x)},${Math.round(p.at.y)}`;
      if (pierTilesUsed.has(key)) continue;
      pierTilesUsed.add(key);
      out.push(pierEntity(p, pierHeightM));
    } else if (p.category === 'arch') {
      // A single arch spans even a brook bank-to-bank; multi-arch needs its interior piers.
      if (archCount > 1 && !wantsPiers) continue;
      out.push(archEntity(p, archBayTiles, deckWidthTiles, archRiseM));
    }
  }
  return out;
}

export interface CrossingStructureOptions extends DetectOptions {
  /** Site params when the detector has no resolver — defaults to a modest late-medieval site. */
  defaults?: CrossingSiteParams;
  /** Normalised terrain elevation (renderer lift space) at a tile — used to ride a bridge
   *  deck on its bank height over the water. Omitted ⇒ decks foot-sample (sink) — callers
   *  that want correct deck height must supply a sampler matching the terrain `heights` buffer. */
  deckElevAt?: (x: number, y: number) => number;
  /** Raw normalised heightfield elevation at a tile (the deckHf space, NOT the curved render
   *  elev). Supplied alongside {@link reliefM}, it lets pier/arch HEIGHT track the crossing's
   *  actual depth: clearance = (higher bank − carved bed) · reliefM, so a deep ravine earns tall
   *  piers and a shallow brook short ones. Omitted ⇒ height falls back to the span proxy. */
  elevAt?: (x: number, y: number) => number;
  /** Metres of relief per normalised elevation unit (`worldStyle.mountainRelief`) — converts the
   *  normalised bank-to-bed drop into a metric pier/arch height. Paired with {@link elevAt}. */
  reliefM?: number;
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
  const specs = detectCrossings(graph, width, { siteParamsAt: opts.siteParamsAt, defaults, isWater: opts.isWater });
  const out: Entity[] = [];
  // Cells claimed by crossing buildings placed earlier in THIS batch — they aren't in the
  // world yet, so the caller's `cellBlocked` can't see them; this stops two crossing
  // structures (or two crossings near each other) from stacking on the same tile.
  const claimed = new Set<string>();
  for (const spec of specs) {
    const placements = realizeCrossing(buildCrossing(spec));
    // Deck + piers + arches via the shared span realization (same seam annexed town
    // bridges use), then the ancillary buildings below.
    out.push(...spanEntitiesFromPlacements(spec, placements, opts));
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
      // A crossing watermill sits waterward of the near bank — turn it so its wheel faces the
      // stream it serves (square footprint ⇒ the solid cells claimed above are unchanged).
      let placed = rb;
      if (preset === 'watermill' && opts.isWater) {
        const o = wheelWaterOrientation(rb, chosen.x, chosen.y, opts.isWater);
        if (o) placed = { ...rb, orientation: o };
      }
      out.push(blueprintEntity(p.nodeId, placed, chosen.x, chosen.y, { poiId: spec.id }));
    }
  }
  return out;
}
