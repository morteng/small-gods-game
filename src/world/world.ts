import type { Entity, EntityId, Region, GameMap, Tile, WorldReadOnly, BrushContext } from '@/core/types';
import { EntityRegistry } from './entity-registry';
import { SpatialIndex, KindIndex, TagIndex } from './indexes';
import { getBrush } from './brushes';

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

  /** Brush dispatcher. Calls registered brush, validates returned entities,
   *  drops out-of-bounds + duplicates with a single warn each. */
  applyBrush(brushName: string, region: Region, seed: number): EntityId[] {
    const fn = getBrush(brushName);
    const ctx: BrushContext = { world: this.asReadOnly(), tiles: this.tiles };
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
    if (droppedOOB > 0) console.warn(`[brush:${brushName}] dropped ${droppedOOB} out-of-bounds entities`);
    if (droppedDupe > 0) console.warn(`[brush:${brushName}] dropped ${droppedDupe} duplicate ids`);
    return ids;
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
