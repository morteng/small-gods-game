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
import { BUILDABLE_TERRAIN, extendThroughStreet, extendBackLane, frontageValue, type Lot, type SettlementPlan } from '@/world/settlement-plan';
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
   * Grow one step, in the medieval growth sequence:
   *   1. INFILL  — place a dwelling on an existing free lot.
   *   2. RIBBON  — frontage saturated → extend the through street, retry.
   *   3. UPGRADE — ribbon capped → densify in place (cottage → townhouse).
   *   4. BACK-LANE — still pressed → branch a perpendicular lane, retry.
   * Silently stops once every avenue is exhausted (lots full, graph at the
   * node cap, nothing left to upgrade).
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

    // 1. Infill existing free lots.
    if (this.tryPlace(ctx, plan, rb, presetName, facing, want)) return;

    const roadType = getZoneRule(poi.type).internalRoadType ?? 'dirt_road';
    const seed = map.seed ?? 0;
    const carve = (tiles: { x: number; y: number }[] | null): boolean => {
      if (!tiles) return false;
      for (const t of tiles) {
        const tile = map.tiles[t.y]?.[t.x];
        if (tile) { tile.type = roadType; tile.walkable = true; }
      }
      return true;
    };

    // 2. Ribbon-extend the through street, retry.
    if (carve(extendThroughStreet(plan, map.tiles, seed))
      && this.tryPlace(ctx, plan, rb, presetName, facing, want)) return;

    // 3. Densify in place — upgrade a standing dwelling to a bigger one.
    if (this.tryUpgrade(ctx, plan)) return;

    // 4. Branch a back lane, retry on its fresh lots.
    if (carve(extendBackLane(plan, map.tiles, seed))) {
      this.tryPlace(ctx, plan, rb, presetName, facing, want);
    }
  }

  /**
   * Upgrade-in-place (S4): replace a standing dwelling with its UPGRADE_CHAINS
   * target on the SAME lot, raising capacity without consuming new ground.
   * Prime-frontage lots densify first (frontageValue order). Returns true when
   * an upgrade fired.
   */
  private tryUpgrade(ctx: SystemContext, plan: SettlementPlan): boolean {
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

      const id = `${plan.poiId}_bld_u${ctx.now}`;
      if (ctx.world.registry.get(id)) return true;     // already acted this tick
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
    // Infill-first (claimed neighbour ≤2 tiles), then by frontage value
    // (prime/central lots before the rim — the medieval value gradient).
    const free = plan.lots
      .filter(l => !l.buildingId && l.side[0] === want[0] && l.side[1] === want[1])
      .map(l => ({ l, k: (nearClaimed(l) ? 0 : 100) + (1 - frontageValue(plan, l)) }))
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
