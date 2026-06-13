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
import type { Entity, Tile } from '@/core/types';
import type { World } from '@/world/world';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { getZoneRule, presetsForEra } from '@/map/poi-zones';
import { resolveSettlementEra } from '@/core/era';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { blueprintEntity, blueprintOf } from '@/blueprint/entity';
import { toAnchors } from '@/blueprint/compile/to-anchors';
import { BUILDABLE_TERRAIN, extendThroughStreet, type Lot, type SettlementPlan } from '@/world/settlement-plan';
import { tryGetEntityKindDef } from '@/world/entity-kinds';

/** One fire per in-game day, matching births/mortality cadence. */
export const GROWTH_TICK_HZ = 0.25;
/** Per-fire chance an over-capacity settlement actually builds (≈ days–weeks). */
export const GROWTH_CHANCE = 0.15;

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
};

export function registerDwellingCapacity(preset: string, capacity: number): void {
  DWELLING_CAPACITY[preset] = capacity;
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
      }
    }
  }
}

export class SettlementGrowthSystem implements System {
  readonly name = 'settlement-growth';
  readonly tickHz = GROWTH_TICK_HZ;

  tick(ctx: SystemContext): void {
    const map = ctx.world.tiles;
    const plans = map.settlementPlans;
    if (!plans?.length) return;

    // Residents per POI (living NPCs with a home).
    const residents = new Map<string, number>();
    for (const e of queryNpcs(ctx.world)) {
      const poi = npcProps(e).homePoiId;
      if (poi) residents.set(poi, (residents.get(poi) ?? 0) + 1);
    }

    // Housing capacity per POI from standing buildings.
    const capacity = new Map<string, number>();
    for (const e of ctx.world.query({})) {
      const preset = blueprintOf(e)?.rb.preset;
      const poi = e.properties?.poiId as string | undefined;
      if (!preset || !poi) continue;
      capacity.set(poi, (capacity.get(poi) ?? 0) + (DWELLING_CAPACITY[preset] ?? 0));
    }

    const sorted = [...plans]
      .filter(p => p.poiId && p.lots.length > 0)
      .sort((a, b) => (a.poiId! < b.poiId! ? -1 : a.poiId! > b.poiId! ? 1 : 0));

    for (const plan of sorted) {
      const pop = residents.get(plan.poiId!) ?? 0;
      if (pop === 0 || pop <= (capacity.get(plan.poiId!) ?? 0)) continue;
      if (ctx.rng.next() >= GROWTH_CHANCE) continue;
      this.growOne(ctx, plan);
    }
  }

  /**
   * Place one dwelling: try the existing free lots first (infill → ribbon
   * order); if none fit, extend the through street once (ribbon growth) and
   * retry on the newly-subdivided lots. Silently skips if nothing fits even
   * after extending (frontage + extension both saturated — S4 grows lanes).
   */
  private growOne(ctx: SystemContext, plan: SettlementPlan): void {
    const map = ctx.world.tiles;
    const poi = map.worldSeed?.pois?.find(p => p.id === plan.poiId);
    if (!poi) return;
    const era = resolveSettlementEra(poi, map.worldSeed);
    const roster = presetsForEra(getZoneRule(poi.type), era)
      .filter(p => (DWELLING_CAPACITY[p] ?? 0) > 0);
    if (roster.length === 0) return;
    const presetName = roster[Math.floor(ctx.rng.next() * roster.length)];
    const rb = synthesizeBlueprint(presetName);
    if (!rb) return;

    const anchors = toAnchors(rb, 0, 0);
    const door = anchors.find(a => a.main) ?? anchors[0];
    const facing: [number, number] = door?.facing ?? [0, 1];
    const want: [number, number] = [-facing[0], -facing[1]];

    if (this.tryPlace(ctx, plan, rb, presetName, facing, want)) return;

    // Frontage saturated → grow one ribbon extension of the main street and
    // retry. extendThroughStreet re-subdivides (coordinate-keyed, so existing
    // lots reproduce exactly and keep their claims); carve the new tiles into
    // the live grid so the road is walkable + buildings keep off it.
    const roadType = getZoneRule(poi.type).internalRoadType ?? 'dirt_road';
    const seed = map.seed ?? 0;
    const newTiles = extendThroughStreet(plan, map.tiles, seed);
    if (!newTiles) return;
    for (const t of newTiles) {
      const tile = map.tiles[t.y]?.[t.x];
      if (tile) { tile.type = roadType; tile.walkable = true; }
    }
    this.tryPlace(ctx, plan, rb, presetName, facing, want);
  }

  /** Place the dwelling on the best fitting free lot. Returns true on success. */
  private tryPlace(
    ctx: SystemContext, plan: SettlementPlan, rb: ReturnType<typeof synthesizeBlueprint> & {},
    presetName: string, facing: [number, number], want: [number, number],
  ): boolean {
    // Free lots on the door-opposing side, infill-first (claimed neighbour
    // within 2 tiles of the frontage), then centre-out.
    const claimed = plan.lots.filter(l => l.buildingId);
    const nearClaimed = (l: Lot): boolean =>
      claimed.some(c => c.frontage.some(cf => l.frontage.some(lf =>
        Math.max(Math.abs(cf.x - lf.x), Math.abs(cf.y - lf.y)) <= 2)));
    const free = plan.lots
      .filter(l => !l.buildingId && l.side[0] === want[0] && l.side[1] === want[1])
      .map(l => ({
        l,
        k: (nearClaimed(l) ? 0 : 100)
          + Math.abs(l.frontage[0].x - plan.center.x) + Math.abs(l.frontage[0].y - plan.center.y),
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

        const id = `${plan.poiId}_bld_g${ctx.now}`;
        if (ctx.world.registry.get(id)) return true;   // already grew this tick
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
}
