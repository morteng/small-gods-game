/**
 * Settlement growth system (growth slice S3).
 *
 * Settlements grow DURING play by consuming free burgage lots from their
 * worldgen plan: when a settlement's living population exceeds its housing
 * capacity, a new dwelling is placed on a free lot with the same
 * flush-to-road alignment the worldgen executor used — a town grown live
 * looks like a town generated old. When the original frontage saturates, the
 * main street RIBBON-EXTENDS (extendThroughStreet) and re-subdivides; once
 * that hits the node cap or the map edge, growth stops (perpendicular
 * back-lane growth is S4).
 *
 * All randomness flows through ctx.rng (seeded). POIs iterate in sorted
 * order so rng draws are replay-stable (births pattern).
 */

import type { System, SystemContext } from '@/core/scheduler';
import type { Entity, Tile, GameMap } from '@/core/types';
import { GAME_HOUR_HZ, perCheckFromPerDay } from '@/core/calendar';
import { WATER_TYPES } from '@/core/constants';
import { bumpTilesRev } from '@/core/tile-rev';
import { worldStyleOf } from '@/core/world-style';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { curveRenderElev } from '@/render/gpu/terrain-field';
import { buildCrossingSpanEntities } from '@/world/connectome/crossing-structures';
import type { CrossingSpec } from '@/world/connectome/crossing-builder';
import type { World } from '@/world/world';
import type { Rng } from '@/core/rng';
import type { EventLog } from '@/core/events';
import { queryNpcs, npcProps, settlementUnderstanding } from '@/world/npc-helpers';
import { getZoneRule, presetsForEra } from '@/map/poi-zones';
import { resolveSettlementEra, liftEraByUnderstanding } from '@/core/era';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { blueprintEntity, blueprintOf } from '@/blueprint/entity';
import { toAnchors } from '@/blueprint/compile/to-anchors';
import { BUILDABLE_TERRAIN, extendThroughStreet, extendBackLane, annexAcrossBridge, frontageValue, type Lot, type SettlementPlan } from '@/world/settlement-plan';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { TRAMPLE, type TrampleGrid } from '@/sim/trample';

/** One fire per GAME HOUR, matching births/mortality cadence (day-keyed
 *  lifecycle systems check hourly under 1:1 realtime — see MortalitySystem). */
export const GROWTH_TICK_HZ = GAME_HOUR_HZ;
/** Per-DAY chance an over-capacity settlement actually builds (≈ days–weeks).
 *  Tuned per-day under the old compressed clock (one fire = one day); the
 *  per-day meaning is preserved via the hourly per-check derivation below. */
export const GROWTH_CHANCE = 0.15;
/** Per-hour chance preserving the per-day GROWTH_CHANCE (24 checks per day). */
const GROWTH_CHANCE_PER_CHECK = perCheckFromPerDay(GROWTH_CHANCE, 24);

/**
 * Residents a dwelling preset houses. Open registry — the same agent seam
 * pattern as SITE_RULES: Fate / era content packs extend it via
 * `registerDwellingCapacity` without touching this table. Presets absent
 * from the table are not dwellings and contribute no capacity.
 */
export const DWELLING_CAPACITY: Record<string, number> = {
  yurt: 4,
  cottage: 5,
  longhouse: 8,
  townhouse: 8,
};

export function registerDwellingCapacity(preset: string, capacity: number): void {
  DWELLING_CAPACITY[preset] = capacity;
}

/**
 * Upgrade-in-place chain (S4): a saturated settlement densifies by replacing a
 * dwelling with a higher-capacity one ON THE SAME LOT, rather than sprawling.
 * Open registry — the agent seam (Fate / era packs) extends it via
 * `registerUpgrade`. An upgrade only fires when the target's capacity exceeds
 * the source's AND its footprint still fits the lot.
 */
export const UPGRADE_CHAINS: Record<string, string> = {
  yurt: 'cottage',
  cottage: 'townhouse',
};

export function registerUpgrade(from: string, to: string): void {
  UPGRADE_CHAINS[from] = to;
}

/**
 * The minimal slice of a tick context the growth functions need. The live
 * SystemContext is a superset, and so are the command-channel ApplyCtx and the
 * hand-built skip context — so all three drive the SAME growth code (S5).
 */
export interface GrowthCtx {
  world: World;
  rng: Rng;
  now: number;
  log: EventLog;
  /** Desire-line trample grid (SOCIAL GRAVITY, synthesis 2.3): when present, free lots beside a
   *  promoted trail / high-wear cell get a scoring bonus, so the town grows along the desire
   *  lines its believers carved (Foundation's worn-path siting). Optional — absent (skip /
   *  command callers not yet wired) growth scores exactly as before. */
  trample?: TrampleGrid | null;
}

/** Living residents per POI (NPCs that claim a `homePoiId`). */
export function residentsByPoi(world: World): Map<string, number> {
  const residents = new Map<string, number>();
  for (const e of queryNpcs(world)) {
    const poi = npcProps(e).homePoiId;
    if (poi) residents.set(poi, (residents.get(poi) ?? 0) + 1);
  }
  return residents;
}

/** Housing capacity per POI summed over standing dwelling entities. */
export function housingCapacityByPoi(world: World): Map<string, number> {
  const capacity = new Map<string, number>();
  for (const e of world.query({})) {
    const preset = blueprintOf(e)?.rb.preset;
    const poi = e.properties?.poiId as string | undefined;
    if (!preset || !poi) continue;
    capacity.set(poi, (capacity.get(poi) ?? 0) + (DWELLING_CAPACITY[preset] ?? 0));
  }
  return capacity;
}

const NATURE_CATEGORIES = new Set(['vegetation', 'terrain-feature']);

/** Roads carved after planning (inter-POI connectors, door paths) cross lots —
 *  growth must never build over them. */
const ROAD_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);

/** Terrain growth may CLEAR inside its own lot (medieval assarting): worldgen
 *  won't seed buildings here, but a growing settlement fells its forest edge. */
const CLEARABLE_TERRAIN = new Set(['forest', 'dense_forest', 'pine_forest', 'dead_forest', 'meadow']);

/** Footprint cells are buildable (or clearable), inside the lot, off-road,
 *  and free of blocking entities. */
function fitsInLot(
  world: World, lotSet: Set<string>, x: number, y: number, w: number, h: number,
): boolean {
  const tiles = world.tiles.tiles;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tx = x + dx, ty = y + dy;
      if (!lotSet.has(`${tx},${ty}`)) return false;
      const t: Tile | undefined = tiles[ty]?.[tx];
      if (!t || ROAD_TYPES.has(t.type)) return false;
      if (!BUILDABLE_TERRAIN.has(t.type) && !CLEARABLE_TERRAIN.has(t.type)) return false;
      if (t.walkable === false && !CLEARABLE_TERRAIN.has(t.type)) return false;
      const blocking = world.registry.getAtTile(tx, ty).some(e => {
        const def = tryGetEntityKindDef(e.kind);
        return !def || !NATURE_CATEGORIES.has(def.category);
      });
      if (blocking) return false;
    }
  }
  return true;
}

/** Stamp a placed building: clear vegetation, set walkability, ground → grass. */
function stampFootprint(world: World, e: Entity): void {
  const bp = blueprintOf(e)!;
  const doorCells = new Set(bp.collision.doorCells);
  for (let dy = 0; dy < bp.collision.footprint.h; dy++) {
    for (let dx = 0; dx < bp.collision.footprint.w; dx++) {
      const tx = e.x + dx, ty = e.y + dy;
      for (const veg of world.registry.getAtTile(tx, ty)) {
        const def = tryGetEntityKindDef(veg.kind);
        if (def && NATURE_CATEGORIES.has(def.category)) {
          world.registry.remove(veg.id);
          world.removeEntity(veg.id);
        }
      }
      const t = world.tiles.tiles[ty]?.[tx];
      if (t) {
        t.type = 'grass';
        t.walkable = doorCells.has(`${dx},${dy}`);
        bumpTilesRev(world.tiles);
      }
    }
  }
}

export class SettlementGrowthSystem implements System {
  readonly name = 'settlement-growth';
  readonly tickHz = GROWTH_TICK_HZ;

  /** `getTrample` feeds SOCIAL GRAVITY (synthesis 2.3): live growth prefers lots beside the
   *  desire lines NPC traffic carved. Optional so existing constructions stay valid. */
  constructor(private readonly getTrample?: () => TrampleGrid | null) {}

  tick(ctx: SystemContext): void {
    const plans = ctx.world.tiles.settlementPlans;
    if (!plans?.length) return;

    const residents = residentsByPoi(ctx.world);
    const capacity = housingCapacityByPoi(ctx.world);

    const sorted = [...plans]
      .filter(p => p.poiId && p.lots.length > 0)
      .sort((a, b) => (a.poiId! < b.poiId! ? -1 : a.poiId! > b.poiId! ? 1 : 0));

    const gctx: GrowthCtx = {
      world: ctx.world, rng: ctx.rng, now: ctx.now, log: ctx.log,
      trample: this.getTrample?.() ?? null,
    };
    for (const plan of sorted) {
      const pop = residents.get(plan.poiId!) ?? 0;
      if (pop === 0 || pop <= (capacity.get(plan.poiId!) ?? 0)) continue;
      if (ctx.rng.next() >= GROWTH_CHANCE_PER_CHECK) continue;
      growSettlement(gctx, plan);
    }
  }
}

/** Backstop on total grow steps in a single skip (across all settlements). */
const SKIP_GROWTH_CAP = 4000;

/**
 * Catch settlement housing up to population after a closed-form time-skip (S5).
 * The live 0.25 Hz system can't tick during a jump, so for each settlement we
 * grow until housing capacity meets the (already-materialized) resident count
 * or growth saturates — the deterministic end-state the live sim would have
 * converged to. Fully deterministic given `rng`. Returns the total grow steps.
 */
export function growSettlementsOnSkip(
  world: World, rng: Rng, now: number, log: EventLog, trample?: TrampleGrid | null,
): number {
  const plans = world.tiles.settlementPlans;
  if (!plans?.length) return 0;

  const residents = residentsByPoi(world);
  const sorted = [...plans]
    .filter(p => p.poiId && p.lots.length > 0)
    .sort((a, b) => (a.poiId! < b.poiId! ? -1 : a.poiId! > b.poiId! ? 1 : 0));

  const ctx: GrowthCtx = { world, rng, now, log, trample };
  let steps = 0;
  for (const plan of sorted) {
    const pop = residents.get(plan.poiId!) ?? 0;
    if (pop === 0) continue;
    // growSettlement returns false at saturation, so the loop self-terminates;
    // SKIP_GROWTH_CAP is only a runaway backstop. The tag is keyed on the
    // global step so ids never collide across settlements within one skip.
    while ((housingCapacityByPoi(world).get(plan.poiId!) ?? 0) < pop) {
      if (!growSettlement(ctx, plan, `skip${now}_${steps}`)) break;
      if (++steps >= SKIP_GROWTH_CAP) return steps;
    }
  }
  return steps;
}

/**
 * Grow one step, in the medieval growth sequence:
 *   1. INFILL  — place a dwelling on an existing free lot.
 *   2. RIBBON  — frontage saturated → extend the through street, retry.
 *   3. UPGRADE — ribbon capped → densify in place (cottage → townhouse).
 *   4. BACK-LANE — still pressed → branch a perpendicular lane, retry.
 * Returns true if anything structural changed (a build, an upgrade, or a road
 * carve), false once every avenue is exhausted (lots full, graph at the node
 * cap, nothing left to upgrade) — callers loop on the return value.
 *
 * Free function (not a method) so the live tick, the time-skip catch-up, and
 * the `grow_settlement` command all drive identical logic (S5). `tag` keys the
 * new entity ids; it defaults to the tick so live ids are byte-unchanged, but
 * skip/command callers pass a per-step tag so several grows land within one
 * logical tick without id collisions.
 */
export function growSettlement(
  ctx: GrowthCtx, plan: SettlementPlan, tag: string = String(ctx.now),
): boolean {
  const map = ctx.world.tiles;
  const poi = map.worldSeed?.pois?.find(p => p.id === plan.poiId);
  if (!poi) return false;
  // Tech = era LIFTED by the settlement's aggregate believer understanding (the buildability
  // envelope's tech axis, applied live): a devout, deeply-understanding people grow grander
  // dwellings than their era alone would allow — the player's cultivation of understanding
  // made physical. Understanding 0 (early game / no residents) ⇒ era unchanged ⇒ growth byte-
  // identical, so this only ever ADDS reach as belief deepens.
  const baseEra = resolveSettlementEra(poi, map.worldSeed);
  const era = liftEraByUnderstanding(baseEra, settlementUnderstanding(ctx.world, poi.id));
  const roster = presetsForEra(getZoneRule(poi.type), era)
    .filter(p => (DWELLING_CAPACITY[p] ?? 0) > 0);
  if (roster.length === 0) return false;
  const presetName = roster[Math.floor(ctx.rng.next() * roster.length)];
  const rb = synthesizeBlueprint(presetName);
  if (!rb) return false;

  const anchors = toAnchors(rb, 0, 0);
  const door = anchors.find(a => a.main) ?? anchors[0];
  const facing: [number, number] = door?.facing ?? [0, 1];
  const want: [number, number] = [-facing[0], -facing[1]];

  // 1. Infill existing free lots.
  if (tryPlace(ctx, plan, rb, presetName, facing, want, tag)) return true;

  const roadType = getZoneRule(poi.type).internalRoadType ?? 'dirt_road';
  const seed = map.seed ?? 0;
  const carve = (tiles: { x: number; y: number }[] | null): boolean => {
    if (!tiles) return false;
    for (const t of tiles) {
      const tile = map.tiles[t.y]?.[t.x];
      if (tile) { tile.type = roadType; tile.walkable = true; }
    }
    bumpTilesRev(map);
    return true;
  };

  let changed = false;

  // 2. Ribbon-extend the through street, retry.
  if (carve(extendThroughStreet(plan, map.tiles, seed))) {
    changed = true;
    if (tryPlace(ctx, plan, rb, presetName, facing, want, tag)) return true;
  }

  // 3. Densify in place — upgrade a standing dwelling to a bigger one.
  if (tryUpgrade(ctx, plan, tag)) return true;

  // 4. Branch a back lane, retry on its fresh lots.
  if (carve(extendBackLane(plan, map.tiles, seed))) {
    changed = true;
    if (tryPlace(ctx, plan, rb, presetName, facing, want, tag)) return true;
  }

  // 5. Home bank saturated — bridge to an adjacent bank and annex a suburb
  //    (town → bridge → suburb). Only fires when a parcel graph offers an
  //    un-annexed crossing; the bridge deck is laid distinctly from the roads.
  const annex = annexAcrossBridge(plan, map.tiles, seed);
  if (annex) {
    carve(annex.road);
    for (const t of annex.bridge) {
      const tile = map.tiles[t.y]?.[t.x];
      if (tile) {
        // Preserve the water under the deck (baseType) so the bridge renders as a
        // span over visible water, not a dirt causeway. Set once, at carve time.
        tile.baseType = tile.baseType ?? tile.type;
        tile.type = 'bridge'; tile.walkable = true;
      }
    }
    bumpTilesRev(map);
    // The SAME parametric structure worldgen crossings get — a deck riding its banks,
    // piers/arches beneath — so an annexed town bridge is a real bridge, not bare tiles
    // (this was the second, visually disjoint bridge system).
    spawnAnnexBridgeStructure(ctx, plan, map, annex.bridge, era);
    changed = true;
    if (tryPlace(ctx, plan, rb, presetName, facing, want, tag)) return true;
  }

  return changed;
}

/**
 * Realize an annexed town bridge as PARAMETRIC STRUCTURE — deck riding its banks,
 * piers/arches beneath — via the same span seam worldgen crossings use
 * (`buildCrossingSpanEntities`), so both bridge producers make the same bridge.
 * Deterministic (heightfield + span geometry only); entities join the world like
 * any other growth-placed building.
 */
function spawnAnnexBridgeStructure(
  ctx: GrowthCtx, plan: SettlementPlan, map: GameMap,
  bridge: { x: number; y: number }[], era: string,
): void {
  if (bridge.length === 0 || !plan.poiId) return;
  const first = bridge[0], last = bridge[bridge.length - 1];
  let ux = last.x - first.x, uy = last.y - first.y;
  const m = Math.hypot(ux, uy);
  if (m > 1e-6) { ux /= m; uy /= m; }
  else {
    // Single-cell span: take the axis whose BOTH neighbours are dry as the crossing direction.
    const dry = (x: number, y: number): boolean => !WATER_TYPES.has(map.tiles[y]?.[x]?.type ?? '');
    if (dry(first.x + 1, first.y) && dry(first.x - 1, first.y)) { ux = 1; uy = 0; }
    else if (dry(first.x, first.y + 1) && dry(first.x, first.y - 1)) { ux = 0; uy = 1; }
    else return;
  }
  const banks: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: Math.round(first.x - ux), y: Math.round(first.y - uy) },
    { x: Math.round(last.x + ux), y: Math.round(last.y + uy) },
  ];
  const spec: CrossingSpec = {
    id: `${plan.poiId}_annexbridge_${first.x}_${first.y}`,
    waterRef: 'parcel_crossing', spanTiles: Math.max(1, m + 1),
    roadClass: 'road', era, prosperity: 'modest', banks,
  };
  const { width, height } = map;
  const hf = getHeightfield(map.seed, width, height,
    styledIslandSpec(map.worldSeed) ?? null, map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed));
  const style = worldStyleOf(map.worldSeed ?? undefined);
  for (const e of buildCrossingSpanEntities(spec, {
    deckElevAt: (x, y) => curveRenderElev(hf[y * width + x] ?? ELEVATION_SEA_LEVEL, ELEVATION_SEA_LEVEL, style.terrainHeightGamma),
    reliefM: style.mountainRelief,
    zPxPerM: style.terrainVerticalExaggeration,
  })) {
    if (ctx.world.registry.get(e.id)) continue;          // idempotent across re-grows
    ctx.world.addEntity(e);
  }
}

/**
 * Upgrade-in-place (S4): replace a standing dwelling with its UPGRADE_CHAINS
 * target on the SAME lot, raising capacity without consuming new ground.
 * Prime-frontage lots densify first (frontageValue order). Returns true when
 * an upgrade fired.
 */
function tryUpgrade(ctx: GrowthCtx, plan: SettlementPlan, tag: string): boolean {
  const candidates = plan.lots
    .filter(l => l.buildingId)
    .map(l => {
      const e = ctx.world.registry.get(l.buildingId!);
      const from = e ? blueprintOf(e)?.rb.preset : undefined;
      const to = from ? UPGRADE_CHAINS[from] : undefined;
      return { l, e, from, to };
    })
    .filter(c => c.e && c.from && c.to
      && (DWELLING_CAPACITY[c.to!] ?? 0) > (DWELLING_CAPACITY[c.from!] ?? 0))
    .sort((a, b) => frontageValue(plan, b.l) - frontageValue(plan, a.l)
      || (a.l.id < b.l.id ? -1 : 1));

  for (const { l, e, from, to } of candidates) {
    const rb = synthesizeBlueprint(to!);
    if (!rb) continue;
    const { w, h } = rb.footprint;
    const lotSet = new Set(l.tiles.map(t => `${t.x},${t.y}`));
    // Reuse the standing building's origin — the upgrade keeps the same
    // frontage. Verify the (possibly larger) footprint stays within the lot.
    const ox = e!.x, oy = e!.y;
    let inLot = true;
    for (let dy = 0; dy < h && inLot; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (!lotSet.has(`${ox + dx},${oy + dy}`)) { inLot = false; break; }
      }
    }
    if (!inLot) continue;

    const id = `${plan.poiId}_bld_u${tag}`;
    if (ctx.world.registry.get(id)) return true;     // already acted this tag
    ctx.world.removeEntity(e!.id);
    const entity = blueprintEntity(id, rb, ox, oy, { poiId: plan.poiId });
    ctx.world.addEntity(entity);
    stampFootprint(ctx.world, entity);
    l.buildingId = id;
    ctx.log.append({
      type: 'settlement_upgraded',
      poiId: plan.poiId!, entityId: id, from: from!, to: to!, lotId: l.id,
    });
    return true;
  }
  return false;
}

/** Scoring bonus a free lot earns when it sits within `TRAIL_GRAVITY_RADIUS` of a promoted
 *  desire-line cell or a high-wear (≥ REVERT_LO) cell — Foundation's "social gravity": housing
 *  sites along the worn paths that shaped the town. Kept below the infill-first class gap (100)
 *  so gravity re-orders lots WITHIN a class, never across it. */
export const TRAIL_GRAVITY_BONUS = 0.5;
export const TRAIL_GRAVITY_RADIUS = 2;

/** The trail-adjacency bonus for one lot (0 when no grid / no nearby trail). Pure. */
export function trailGravityBonus(trample: TrampleGrid | null | undefined, lot: Lot): number {
  if (!trample) return 0;
  const r = TRAIL_GRAVITY_RADIUS;
  for (const t of lot.tiles) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = t.x + dx, y = t.y + dy;
        if (trample.isPromoted(x, y) || trample.wearAt(x, y) >= TRAMPLE.REVERT_LO) return TRAIL_GRAVITY_BONUS;
      }
    }
  }
  return 0;
}

/** Place the dwelling on the best fitting free lot. Returns true on success. */
function tryPlace(
  ctx: GrowthCtx, plan: SettlementPlan, rb: ReturnType<typeof synthesizeBlueprint> & {},
  presetName: string, facing: [number, number], want: [number, number], tag: string,
): boolean {
    // Free lots on the door-opposing side, infill-first (claimed neighbour
    // within 2 tiles of the frontage), then centre-out.
    const claimed = plan.lots.filter(l => l.buildingId);
    const nearClaimed = (l: Lot): boolean =>
      claimed.some(c => c.frontage.some(cf => l.frontage.some(lf =>
        Math.max(Math.abs(cf.x - lf.x), Math.abs(cf.y - lf.y)) <= 2)));
    // Infill-first (claimed neighbour ≤2 tiles), then by frontage value
    // (prime/central lots before the rim — the medieval value gradient), pulled
    // toward promoted desire lines by the social-gravity bonus (within a class).
    const free = plan.lots
      .filter(l => !l.buildingId && l.side[0] === want[0] && l.side[1] === want[1])
      .map(l => ({
        l,
        k: (nearClaimed(l) ? 0 : 100) + (1 - frontageValue(plan, l)) - trailGravityBonus(ctx.trample, l),
      }))
      .sort((a, b) => a.k - b.k)
      .map(({ l }) => l);

    const { w, h } = rb.footprint;
    for (const lot of free) {
      const lotSet = new Set(lot.tiles.map(t => `${t.x},${t.y}`));
      // Align to the LOT, not the door column: flush against the street on
      // the door side, swept along the frontage (centred try first).
      const horizontal = lot.side[1] !== 0;           // street runs in x when side is ±y
      const extent = horizontal ? w : h;              // footprint size along the street
      const span = lot.frontage.length - extent;
      if (span < 0) continue;
      const offsets = [...Array(span + 1).keys()]
        .sort((a, b) => Math.abs(a - span / 2) - Math.abs(b - span / 2));
      for (const k of offsets) {
        const win = lot.frontage.slice(k, k + extent);
        const fx = Math.min(...win.map(t => t.x));
        const fy = Math.min(...win.map(t => t.y));
        const ox = facing[0] > 0 ? fx - w : facing[0] < 0 ? fx + 1 : fx;
        const oy = facing[1] > 0 ? fy - h : facing[1] < 0 ? fy + 1 : fy;
        if (!fitsInLot(ctx.world, lotSet, ox, oy, w, h)) continue;

        const id = `${plan.poiId}_bld_g${tag}`;
        if (ctx.world.registry.get(id)) return true;   // already grew this tag
        const entity = blueprintEntity(id, rb, ox, oy, { poiId: plan.poiId });
        ctx.world.addEntity(entity);
        stampFootprint(ctx.world, entity);
        lot.buildingId = id;
        ctx.log.append({
          type: 'settlement_grown',
          poiId: plan.poiId!, entityId: id, preset: presetName, lotId: lot.id,
        });
        return true;
      }
    }
    return false;
}
