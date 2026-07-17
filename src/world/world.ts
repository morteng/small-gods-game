import type { Entity, EntityId, Region, GameMap, Tile, WorldReadOnly, BrushContext, ActiveEvent } from '@/core/types';
import { EntityRegistry } from './entity-registry';
import { SpatialIndex, KindIndex, TagIndex } from './indexes';
import { getBrush } from './brushes';
import { worldStyleOf } from '@/core/world-style';

export interface QueryOpts {
  region?: Region;
  kind?: string;
  tag?: string;
  limit?: number;
}

export class World {
  readonly registry = new EntityRegistry();
  private spatial = new SpatialIndex(4);
  private kindIdx = new KindIndex();
  private tagIdx = new TagIndex();

  /** Active settlement events keyed by POI id. */
  readonly activeEvents = new Map<string, ActiveEvent[]>();

  /** Fate's one-shot forced next-event per POI (authoring verb bias_event). */
  readonly forcedEvents = new Map<string, import('@/core/types').SettlementEventType>();

  /** M3 (mortal power): the lord's seat per settlement, keyed by POI id. Sim
   *  truth — captured/restored by the snapshot exactly like activeEvents, so a
   *  scrub un-seats a lord who rose after the restore point. Maintained by
   *  LordSystem; coached by the set_lord_stance authoring verb. */
  readonly lords = new Map<string, import('@/sim/lord').LordState>();

  /** M5 (mortal power): dominion links, gripped settlement → the runtime-castle
   *  poiId whose knights carry the extraction there. DERIVED truth (rebuilt from
   *  `state.runtimePois` provenance by LordSystem hourly, by `foundCastle` on
   *  commit, and by `restoreSnapshot`) — never snapshotted itself. Whether a
   *  link is ACTIVE (castle seat exists AND garrison > 0) is checked at read
   *  time (`grippingSeatOf`), so a garrison wiped mid-hour stops extracting on
   *  the next read. */
  readonly dominions = new Map<string, string>();

  constructor(public readonly tiles: GameMap) {}

  addEntity(e: Entity): void {
    this.registry.add(e);
    this.spatial.add(e.id, e.x, e.y);
    this.kindIdx.add(e.id, e.kind);
    this.tagIdx.add(e.id, e.tags);
  }

  removeEntity(id: EntityId): void {
    const e = this.registry.get(id);
    if (!e) return;
    this.spatial.remove(id, e.x, e.y);
    this.kindIdx.remove(id, e.kind);
    this.tagIdx.remove(id, e.tags);
    this.registry.remove(id);
  }

  setProperty(id: EntityId, key: string, value: unknown): void {
    this.registry.setProperty(id, key, value);
  }

  /**
   * Apply field changes to an entity, keeping both the registry and World's
   * own spatial/kind/tag indexes in sync. Use this (not direct mutation) when
   * editing x/y/kind/tags so queries stay correct. Returns the updated entity.
   */
  updateEntity(id: EntityId, changes: Partial<Entity>): Entity | undefined {
    const e = this.registry.get(id);
    if (!e) return undefined;

    // De-index from World's indexes using current values.
    this.spatial.remove(id, e.x, e.y);
    this.kindIdx.remove(id, e.kind);
    this.tagIdx.remove(id, e.tags);

    // registry.update applies the change and syncs the registry's own indexes.
    this.registry.update(id, changes);

    // Re-index in World's indexes using the new values.
    const updated = this.registry.get(id)!;
    this.spatial.add(id, updated.x, updated.y);
    this.kindIdx.add(id, updated.kind);
    this.tagIdx.add(id, updated.tags);
    return updated;
  }

  query(opts: QueryOpts = {}): Entity[] {
    let candidateIds: Iterable<string>;

    if (opts.region) {
      candidateIds = this.spatial.queryRect(opts.region);
    } else if (opts.kind) {
      candidateIds = this.kindIdx.byKind(opts.kind);
    } else if (opts.tag) {
      candidateIds = this.tagIdx.byTag(opts.tag);
    } else {
      candidateIds = this.registry.all().map(e => e.id);
    }

    const seen = new Set<string>();
    const out: Entity[] = [];
    for (const id of candidateIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const e = this.registry.get(id);
      if (!e) continue;
      if (opts.region) {
        if (e.x < opts.region.x || e.x >= opts.region.x + opts.region.w) continue;
        if (e.y < opts.region.y || e.y >= opts.region.y + opts.region.h) continue;
      }
      if (opts.kind && e.kind !== opts.kind) continue;
      if (opts.tag && !(e.tags?.includes(opts.tag))) continue;
      out.push(e);
      if (opts.limit !== undefined && out.length >= opts.limit) break;
    }
    return out;
  }

  /** Per-generation aggregate of drops from applyBrush calls. Flushed by
   *  flushBrushDiagnostics(), which emits a single summary warn and resets. */
  private brushDrops = new Map<string, { oob: number; dupe: number }>();

  /** Brush dispatcher. Calls registered brush, validates returned entities,
   *  accumulates out-of-bounds + duplicate drops for the caller to flush. */
  applyBrush(brushName: string, region: Region, seed: number): EntityId[] {
    const fn = getBrush(brushName);
    const ctx: BrushContext = {
      world: this.asReadOnly(),
      tiles: this.tiles,
      style: worldStyleOf(this.tiles.worldSeed),
    };
    const produced = fn(region, seed, ctx);
    const ids: EntityId[] = [];
    const mapW = this.tiles.width;
    const mapH = this.tiles.height;
    let droppedOOB = 0;
    let droppedDupe = 0;
    for (const e of produced) {
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y) ||
          e.x < 0 || e.y < 0 || e.x >= mapW || e.y >= mapH) {
        droppedOOB++;
        continue;
      }
      if (this.registry.has(e.id)) { droppedDupe++; continue; }
      this.addEntity(e);
      ids.push(e.id);
    }
    if (droppedOOB > 0 || droppedDupe > 0) {
      const cur = this.brushDrops.get(brushName) ?? { oob: 0, dupe: 0 };
      cur.oob += droppedOOB;
      cur.dupe += droppedDupe;
      this.brushDrops.set(brushName, cur);
    }
    return ids;
  }

  /** Emit one aggregated warn for all brush drops since the last flush, then
   *  reset. Intended to be called once after a full generation pass. No-op if
   *  nothing was dropped. */
  flushBrushDiagnostics(): void {
    if (this.brushDrops.size === 0) return;
    let totalOob = 0, totalDupe = 0;
    const parts: string[] = [];
    for (const [name, { oob, dupe }] of this.brushDrops) {
      totalOob += oob;
      totalDupe += dupe;
      parts.push(`${name}(${dupe}d/${oob}o)`);
    }
    if (totalOob > 0 || totalDupe > 0) {
      console.warn(
        `[brush] dropped ${totalDupe} duplicate ids, ${totalOob} out-of-bounds ` +
        `across ${this.brushDrops.size} brush(es): ${parts.join(', ')}`,
      );
    }
    this.brushDrops.clear();
  }

  /** Read-only view exposed to brushes via BrushContext. */
  asReadOnly(): WorldReadOnly {
    return {
      query: (opts) => this.query(opts),
      tileAt: (x, y) => this.tileAt(x, y),
    };
  }

  tileAt(x: number, y: number): Tile | undefined {
    return this.tiles.tiles[y]?.[x];
  }

  /** Index an entity already present in the underlying registry — used when
   *  legacy code (e.g. building-placer) adds entities directly via
   *  `world.registry.add()`. Bootstrap will call this to keep World indexes
   *  in sync. */
  indexExisting(e: Entity): void {
    this.spatial.add(e.id, e.x, e.y);
    this.kindIdx.add(e.id, e.kind);
    this.tagIdx.add(e.id, e.tags);
  }
}
