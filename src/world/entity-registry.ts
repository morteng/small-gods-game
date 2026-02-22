/**
 * EntityRegistry
 *
 * Unified store for all world objects: buildings, trees, rocks, flora,
 * landmarks, NPCs, items. Replaces GameMap.buildings, GameMap.villages,
 * GameState.decorations — all in one queryable, serializable registry.
 *
 * Backed by:
 *   - Map<id, entity>             primary store
 *   - SpatialHashGrid             fast radius/rect queries
 *   - Map<poiId, Set<id>>         secondary index by owning POI
 *   - Map<category, Set<id>>      secondary index by category
 *   - Map<`${x},${y}`, Set<id>>   secondary index by tile
 */

import type { WorldEntity, EntityCategory } from '@/core/types';
import { SpatialHashGrid } from './spatial-hash';

export class EntityRegistry {
  private entities:    Map<string, WorldEntity>         = new Map();
  private spatial:     SpatialHashGrid                  = new SpatialHashGrid(16);
  private byPoi:       Map<string, Set<string>>         = new Map();
  private byCategory:  Map<EntityCategory, Set<string>> = new Map();
  private byTile:      Map<string, Set<string>>         = new Map();

  // ─── Core CRUD ──────────────────────────────────────────────────────────────

  add(entity: WorldEntity): void {
    if (this.entities.has(entity.id)) {
      throw new Error(`Entity already exists: ${entity.id}`);
    }
    this.entities.set(entity.id, entity);
    this.spatial.add(entity.id, entity.tileX, entity.tileY);
    this.indexEntity(entity);
  }

  remove(id: string): WorldEntity | undefined {
    const entity = this.entities.get(id);
    if (!entity) return undefined;
    this.entities.delete(id);
    this.spatial.remove(id);
    this.deindexEntity(entity);
    return entity;
  }

  get(id: string): WorldEntity | undefined {
    return this.entities.get(id);
  }

  update(id: string, changes: Partial<WorldEntity>): void {
    const entity = this.entities.get(id);
    if (!entity) throw new Error(`Entity not found: ${id}`);

    const moved = (changes.tileX !== undefined && changes.tileX !== entity.tileX)
               || (changes.tileY !== undefined && changes.tileY !== entity.tileY);

    // Rebuild secondary indexes for changed fields
    this.deindexEntity(entity);
    Object.assign(entity, changes);
    this.indexEntity(entity);

    if (moved) this.spatial.move(id, entity.tileX, entity.tileY);
  }

  has(id: string): boolean {
    return this.entities.has(id);
  }

  get size(): number { return this.entities.size; }

  // ─── Spatial queries ─────────────────────────────────────────────────────────

  getInRadius(cx: number, cy: number, radius: number): WorldEntity[] {
    return this.spatial.getInRadius(cx, cy, radius)
      .map(id => this.entities.get(id)!)
      .filter(Boolean);
  }

  getInRect(x: number, y: number, w: number, h: number): WorldEntity[] {
    return this.spatial.getInRect(x, y, w, h)
      .map(id => this.entities.get(id)!)
      .filter(Boolean);
  }

  getAtTile(x: number, y: number): WorldEntity[] {
    const key = `${x},${y}`;
    const ids = this.byTile.get(key);
    if (!ids) return [];
    return [...ids].map(id => this.entities.get(id)!).filter(Boolean);
  }

  // ─── Index queries ───────────────────────────────────────────────────────────

  getByPoi(poiId: string): WorldEntity[] {
    const ids = this.byPoi.get(poiId);
    if (!ids) return [];
    return [...ids].map(id => this.entities.get(id)!).filter(Boolean);
  }

  getByCategory(category: EntityCategory): WorldEntity[] {
    const ids = this.byCategory.get(category);
    if (!ids) return [];
    return [...ids].map(id => this.entities.get(id)!).filter(Boolean);
  }

  removeByPoi(poiId: string): WorldEntity[] {
    const ids = this.byPoi.get(poiId);
    if (!ids) return [];
    const removed: WorldEntity[] = [];
    for (const id of [...ids]) {
      const e = this.remove(id);
      if (e) removed.push(e);
    }
    return removed;
  }

  // ─── Occupancy ───────────────────────────────────────────────────────────────

  isOccupied(x: number, y: number): boolean {
    return this.getAtTile(x, y).length > 0;
  }

  /**
   * Returns true if the rectangle [x, x+w) × [y, y+h) is free of entities,
   * with an additional clearance margin on all sides.
   * Uses tile-by-tile `isOccupied` so entity footprints are respected.
   */
  canPlace(x: number, y: number, w: number, h: number, margin: number): boolean {
    const x0 = x - margin, y0 = y - margin;
    const x1 = x + w - 1 + margin, y1 = y + h - 1 + margin;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.isOccupied(tx, ty)) return false;
      }
    }
    return true;
  }

  // ─── All entities ────────────────────────────────────────────────────────────

  all(): WorldEntity[] {
    return [...this.entities.values()];
  }

  // ─── Serialization ───────────────────────────────────────────────────────────

  toJSON(): WorldEntity[] {
    return this.all();
  }

  static fromJSON(data: WorldEntity[]): EntityRegistry {
    const registry = new EntityRegistry();
    for (const entity of data) registry.add(entity);
    return registry;
  }

  clear(): void {
    this.entities.clear();
    this.spatial.clear();
    this.byPoi.clear();
    this.byCategory.clear();
    this.byTile.clear();
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private indexEntity(entity: WorldEntity): void {
    // POI index
    if (entity.poiId) {
      let s = this.byPoi.get(entity.poiId);
      if (!s) { s = new Set(); this.byPoi.set(entity.poiId, s); }
      s.add(entity.id);
    }

    // Category index
    let cs = this.byCategory.get(entity.category);
    if (!cs) { cs = new Set(); this.byCategory.set(entity.category, cs); }
    cs.add(entity.id);

    // Tile index — register every footprint cell
    const fw = entity.footprint?.w ?? 1;
    const fh = entity.footprint?.h ?? 1;
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        const key = `${entity.tileX + dx},${entity.tileY + dy}`;
        let ts = this.byTile.get(key);
        if (!ts) { ts = new Set(); this.byTile.set(key, ts); }
        ts.add(entity.id);
      }
    }
  }

  private deindexEntity(entity: WorldEntity): void {
    if (entity.poiId) this.byPoi.get(entity.poiId)?.delete(entity.id);

    this.byCategory.get(entity.category)?.delete(entity.id);

    const fw = entity.footprint?.w ?? 1;
    const fh = entity.footprint?.h ?? 1;
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        this.byTile.get(`${entity.tileX + dx},${entity.tileY + dy}`)?.delete(entity.id);
      }
    }
  }
}
