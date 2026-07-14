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
import { METRES_PER_TILE, PX_PER_METRE } from '@/render/scale-contract';
import { detectCrossings, type CrossingSiteParams, type DetectOptions } from './detect-crossings';
import { buildCrossing, type CrossingSpec } from './crossing-builder';
import { realizeCrossing } from './realize-crossing';
import { bridgeClassFor, archStylesFor, type BridgeClass } from './buildability-envelope';

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

// ── One-object bridge (the coherent parametric span) ────────────────────────────────────
// Instead of scattering a lifted deck + independently-lifted piers + arches (whose heights
// never reconciled — the deck floated at bank height while true-metric supports rendered ~1.6×
// too tall for the vertically-COMPRESSED terrain), a crossing composes as ONE blueprint object
// that stacks in its own space: arches spring from the bed, the deck rides their crowns, and
// the whole object is lifted ONCE to the bed elevation. Supports are sized in the terrain's
// compressed vertical (× zPxPerM/PX_PER_METRE) so they span the real bank-to-bed screen gap.

const DECK_WIDTH_T: Record<CrossingSpec['roadClass'], number> = { path: 1.1, track: 1.4, road: 2.0, highway: 2.6 };
const ERA_RANK_B: Record<string, number> = { 'stone-age': 0, neolithic: 0, iron: 1, 'early-medieval': 2, medieval: 2, 'late-medieval': 3, renaissance: 3 };
const PROS_RANK_B: Record<string, number> = { destitute: 0, poor: 0, modest: 1, comfortable: 1, rich: 2, opulent: 3 };
const ROAD_RANK_B: Record<CrossingSpec['roadClass'], number> = { path: 0, track: 1, road: 2, highway: 3 };
/** Masonry ring-depth above the intrados crown (m) — a proud archivolt (up from the arch prim's
 *  0.7 m default) so the voussoir ring reads as substantial masonry, matching the TTI reference.
 *  Passed to each arch AND used to seat the deck (`riseM + this` = crown), so the two stay in sync. */
const ARCH_RING_M = 0.9;
/** One masonry arch per this many tiles of clear span (a packhorse over a brook = 1). */
const TILES_PER_ARCH = 3.5;

/** The compressed metric height (object-space metres, rendered at PX_PER_METRE) that visually
 *  spans a normalised bank→bed elevation drop on the terrain (lifted at reliefM·zPxPerM). */
function clearanceMetresForScreen(dropNorm: number, reliefM: number, zPxPerM: number): number {
  return Math.max(0, dropNorm) * reliefM * zPxPerM / PX_PER_METRE;
}

/**
 * Compose ONE crossing spec as a single coherent bridge entity: filled-spandrel stone arches
 * (or a timber trestle) with the parapeted, optionally hump-backed deck riding the crowns,
 * lifted once to the bed. Returns undefined when the spec lacks bank anchors. Pure + deterministic.
 */
export function buildBridgeObject(spec: CrossingSpec, opts: SpanEntityOptions = {}): Entity | undefined {
  ensureBuildingTypesRegistered();
  const banks = spec.banks;
  if (!banks) return undefined;
  const [b0, b1] = banks;
  const mid = { x: (b0.x + b1.x) / 2, y: (b0.y + b1.y) / 2 };
  const spanLen = Math.hypot(b1.x - b0.x, b1.y - b0.y);   // clear span, tiles
  if (spanLen < 0.5) return undefined;
  // The deck lies along the THREADED ROAD, not along the chord of two raster-snapped points. The
  // banks used to be snapped outward independently (each up to 4 tiles, along its own away-from-
  // midpoint direction), so their chord could sit tens of degrees off the road that crosses there
  // — the deck read as a diagonal slab under a perpendicular road. `spec.axis` is the smoothed
  // centreline's own secant across the channel; falls back to the bank chord for legacy callers.
  const yawDeg = spec.axis
    ? (Math.atan2(spec.axis[1], spec.axis[0]) * 180) / Math.PI
    : (Math.atan2(b1.y - b0.y, b1.x - b0.x) * 180) / Math.PI;
  const a = (yawDeg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);

  // Material class (same envelope the connectome builder gates on) → walls + arch style.
  const env = { era: ERA_RANK_B[spec.era] ?? 1, economy: PROS_RANK_B[spec.prosperity] ?? 1, understanding: spec.understanding };
  const cls: BridgeClass = bridgeClassFor(env, ROAD_RANK_B[spec.roadClass]);
  const stone = cls === 'dressed-stone';
  const walls = stone ? 'stone' : 'timber';
  const widthT = DECK_WIDTH_T[spec.roadClass];
  const archStyle = stone ? (archStylesFor(env).has('segmental') ? 'segmental' : 'round') : 'round';

  // Vertical: the deck rides at the COMPRESSED bank→bed clearance above the bed, so it seats on
  // the banks while its supports span the true screen gap. Falls back to a span proxy without a sampler.
  const de = opts.deckElevAt, reliefM = opts.reliefM ?? 48, zPxPerM = opts.zPxPerM ?? 20;
  let clearZM: number, liftElev: number | undefined;
  if (de) {
    const bankRE = Math.max(de(Math.round(b0.x), Math.round(b0.y)), de(Math.round(b1.x), Math.round(b1.y)));
    const bedRE = de(Math.round(mid.x), Math.round(mid.y));
    clearZM = Math.min(12, Math.max(1.2, clearanceMetresForScreen(bankRE - bedRE, reliefM, zPxPerM) + 0.6));
    liftElev = bedRE;
  } else {
    clearZM = Math.min(8, Math.max(1.2, spanLen * 0.5 * (zPxPerM / PX_PER_METRE)));
    liftElev = undefined;
  }
  const camberM = stone ? Math.min(1.2, spanLen * METRES_PER_TILE * 0.045) : 0;   // hump for masonry

  // Footprint = the yawed span's AABB (+1 tile so the deck seats onto both banks as abutments),
  // origin rounded with the sub-tile remainder flowed into the part offsets (as deckEntity does).
  const lengthT = spanLen + 1;
  const ac = Math.abs(cs), as = Math.abs(sn);
  const fpW = Math.max(1, Math.ceil(lengthT * ac + widthT * as));
  const fpH = Math.max(1, Math.ceil(lengthT * as + widthT * ac));
  const ox = Math.round(mid.x - fpW / 2), oy = Math.round(mid.y - fpH / 2);
  const cxL = mid.x - ox, cyL = mid.y - oy;   // crossing midpoint in footprint-local tiles

  const parts: Record<string, NonNullable<Blueprint['parts']>[string]> = {
    deck: {
      type: 'deck', at: { x: cxL - fpW / 2, y: cyL - fpH / 2 }, size: { w: fpW, h: fpH },
      params: {
        lengthM: lengthT * METRES_PER_TILE, widthM: widthT * METRES_PER_TILE, thicknessM: 0.6,
        yawDeg, parapet: widthT >= 1 ? 'both' : 'none', baseZM: clearZM, camberM,
      },
    },
  };

  // Abutments — a battered masonry end-block at each bank grounds the span (P1 TTI finding: without
  // them the deck ends flush at the footprint edge and reads as a floating slab). They sit at the
  // clear-span ends, in the +1-tile footprint margin, from the bed up to the deck underside.
  const abutWidthM = widthT * METRES_PER_TILE + 1.0;   // wider than the deck, as masonry abutments are
  const abutDepthT = 0.75, abutWidthT = abutWidthM / METRES_PER_TILE;
  for (const e of [-1, 1] as const) {
    const ex = cxL + e * (spanLen / 2) * cs, ey = cyL + e * (spanLen / 2) * sn;
    const boxW = Math.max(1, Math.ceil(abutDepthT * ac + abutWidthT * as));
    const boxH = Math.max(1, Math.ceil(abutDepthT * as + abutWidthT * ac));
    parts[`abut${e < 0 ? 0 : 1}`] = {
      type: 'abutment', at: { x: ex - boxW / 2, y: ey - boxH / 2 }, size: { w: boxW, h: boxH },
      params: { heightM: clearZM, widthM: abutWidthM, depthM: abutDepthT * METRES_PER_TILE, batter: 0.2, yawDeg },
    };
  }

  if (stone) {
    // Filled-spandrel arcade: N abutting arch bays springing from the bed to the deck crown.
    const bays = Math.max(1, Math.min(8, Math.round(spanLen / TILES_PER_ARCH)));
    const bayT = spanLen / bays;
    const riseM = Math.max(0.8, clearZM - ARCH_RING_M);   // crown meets the deck underside
    for (let i = 0; i < bays; i++) {
      const t = (i + 0.5) - bays / 2;                     // bay centre offset from mid, in bays
      const px = cxL + t * bayT * cs, py = cyL + t * bayT * sn;   // bay centre (footprint-local)
      // Arch springing origin: back off the bay centre by half the span (along dir) and half the
      // depth (along perp), so the yawed arch centres on the bay (mirrors archEntity).
      const axx = px - (bayT / 2) * cs + (widthT / 2) * sn;
      const ayy = py - (bayT / 2) * sn - (widthT / 2) * cs;
      parts[`arch${i + 1}`] = {
        type: 'arch_span', at: { x: axx, y: ayy }, size: { w: Math.max(1, Math.ceil(bayT)), h: Math.max(1, Math.ceil(widthT)) },
        params: { spanM: bayT * METRES_PER_TILE, riseM, thicknessM: widthT * METRES_PER_TILE, yawDeg, style: archStyle, ringDepthM: ARCH_RING_M },
      };
    }
  } else {
    // Timber trestle: driven piles every ~2 tiles from the bed up to the deck underside.
    const piles = Math.max(2, Math.round(spanLen / 2));
    for (let i = 0; i <= piles; i++) {
      const t = i / piles - 0.5;                          // −0.5 … +0.5 along the span
      const px = cxL + t * spanLen * cs, py = cyL + t * spanLen * sn;
      parts[`pile${i}`] = {
        type: 'pier', at: { x: px - 0.5, y: py - 0.5 }, size: { w: 1, h: 1 },
        params: { heightM: clearZM, widthM: 0.6, batter: 0.05 },
      };
    }
  }

  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'prop', preset: 'bridge', category: 'infrastructure',
    footprint: { w: fpW, h: fpH }, materials: { walls, roof: walls, ground: 'dirt' }, parts,
  };
  const rb = resolveBlueprint([bp], 0);
  const e = blueprintEntity(spec.id + '-bridge', rb, ox, oy, { poiId: spec.id });
  if (liftElev !== undefined) (e.properties as Record<string, unknown>).liftElev = liftElev;
  // Carry the SHARED OPENING onto the deck entity: the two bank cells this span seats its
  // abutments on. `bridge.seating` reads these directly rather than re-deriving a proxy from the
  // footprint AABB — the AABB's end ROW of a diagonal deck reaches well past the real abutment
  // (into the channel), which is precisely the kind of second derivation this WP exists to kill.
  if (spec.bankCells) (e.properties as Record<string, unknown>).bankCells = spec.bankCells;
  return e;
}

/** Elevation context for the bridge object — deck rides the banks, supports reach the bed. */
export interface SpanEntityOptions {
  /** Normalised terrain elevation (renderer lift space) at a tile — bank & bed sampled so the
   *  deck seats on the banks and the supports span the real clearance. Omitted ⇒ span-proxy. */
  deckElevAt?: (x: number, y: number) => number;
  /** Metres per normalised elevation unit (`worldStyle.mountainRelief`). */
  reliefM?: number;
  /** Terrain vertical exaggeration (`worldStyle.terrainVerticalExaggeration`) — reconciles the
   *  sprite's metric vertical (PX_PER_METRE) with the terrain's compressed lift so supports span
   *  the true screen clearance. Omitted ⇒ default (20). */
  zPxPerM?: number;
}

/**
 * The ONE crossing → ONE bridge object seam, shared by BOTH producers: worldgen road×water
 * crossings and runtime settlement bridge annexation (`annexAcrossBridge`). Returns the single
 * coherent bridge entity (or empty if the spec has no bank anchors).
 */
export function buildCrossingSpanEntities(spec: CrossingSpec, opts: SpanEntityOptions = {}): Entity[] {
  const e = buildBridgeObject(spec, opts);
  return e ? [e] : [];
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
   *  normalised bank-to-bed drop into a metric support height. Paired with {@link deckElevAt}. */
  reliefM?: number;
  /** Terrain vertical exaggeration (`worldStyle.terrainVerticalExaggeration`) — reconciles the
   *  sprite metric vertical with the terrain's compressed lift so the bridge's supports span the
   *  true screen clearance. Paired with {@link deckElevAt} + {@link reliefM}. */
  zPxPerM?: number;
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
  const specs = detectCrossings(graph, width, { siteParamsAt: opts.siteParamsAt, defaults, isWater: opts.isWater, bridgeAt: opts.bridgeAt });
  const out: Entity[] = [];
  // Cells claimed by crossing buildings placed earlier in THIS batch — they aren't in the
  // world yet, so the caller's `cellBlocked` can't see them; this stops two crossing
  // structures (or two crossings near each other) from stacking on the same tile.
  const claimed = new Set<string>();
  for (const spec of specs) {
    const placements = realizeCrossing(buildCrossing(spec));
    // The span itself is ONE coherent bridge object (same seam annexed town bridges use);
    // the ancillary buildings (toll/mill/gatehouse) are placed from the realized placements below.
    const bridge = buildBridgeObject(spec, opts);
    if (bridge) out.push(bridge);
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
