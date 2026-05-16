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
 *   - Map<category, Set<id>>      secondary index by category (from properties)
 *   - Map<`${x},${y}`, Set<id>>   secondary index by tile
 */

import type { Entity } from '@/core/types';
import { SpatialHashGrid } from './spatial-hash';

export class EntityRegistry {
  private entities = new Map<string, Entity>();
  private spatial = new SpatialHashGrid(16);
  private byPoi = new Map<string, Set<string>>();
  private byCategory = new Map<string, Set<string>>();
  private byTile = new Map<string, Set<string>>();

  // ─── Core CRUD ──────────────────────────────────────────────────────────────

  add(entity: Entity): void {
    if (this.entities.has(entity.id)) {
      throw new Error(`Entity already exists: ${entity.id}`);
    }
    this.entities.set(entity.id, entity);
    this.spatial.add(entity.id, Math.floor(entity.x), Math.floor(entity.y));
    this.indexEntity(entity);
  }

  addAll(entities: Entity[]): void {
    for (const e of entities) this.add(e);
  }

  remove(id: string): Entity | undefined {
    const entity = this.entities.get(id);
    if (!entity) return undefined;
    this.entities.delete(id);
    this.spatial.remove(id);
    this.deindexEntity(entity);
    return entity;
  }

  get(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  update(id: string, changes: Partial<Entity>): void {
    const entity = this.entities.get(id);
    if (!entity) throw new Error(`Entity not found: ${id}`);

    const oldX = Math.floor(entity.x);
    const oldY = Math.floor(entity.y);

    this.deindexEntity(entity);
    Object.assign(entity, changes);
    this.indexEntity(entity);

    const newX = Math.floor(entity.x);
    const newY = Math.floor(entity.y);
    if (oldX !== newX || oldY !== newY) {
      this.spatial.move(id, newX, newY);
    }
  }

  has(id: string): boolean {
    return this.entities.has(id);
  }

  get size(): number { return this.entities.size; }

  setProperty(id: string, key: string, value: unknown): void {
    const e = this.entities.get(id);
    if (!e) throw new Error(`Entity not found: ${id}`);
    if (!e.properties) (e as Entity).properties = {};
    (e.properties as Record<string, unknown>)[key] = value;
  }

  // ─── Spatial queries ─────────────────────────────────────────────────────────

  getInRadius(cx: number, cy: number, radius: number): Entity[] {
    return this.spatial.getInRadius(cx, cy, radius)
      .map(id => this.entities.get(id)!)
      .filter(Boolean);
  }

  getInRect(x: number, y: number, w: number, h: number): Entity[] {
    return this.spatial.getInRect(x, y, w, h)
      .map(id => this.entities.get(id)!)
      .filter(Boolean);
  }

  getAtTile(x: number, y: number): Entity[] {
    const key = `${x},${y}`;
    const ids = this.byTile.get(key);
    if (!ids) return [];
    return [...ids].map(id => this.entities.get(id)!).filter(Boolean);
  }

  // ─── Index queries ───────────────────────────────────────────────────────────

  getByPoi(poiId: string): Entity[] {
    const ids = this.byPoi.get(poiId);
    if (!ids) return [];
    return [...ids].map(id => this.entities.get(id)!).filter(Boolean);
  }

  getByCategory(category: string): Entity[] {
    const ids = this.byCategory.get(category);
    if (!ids) return [];
    return [...ids].map(id => this.entities.get(id)!).filter(Boolean);
  }

  removeByPoi(poiId: string): Entity[] {
    const ids = this.byPoi.get(poiId);
    if (!ids) return [];
    const removed: Entity[] = [];
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

  all(): Entity[] {
    return [...this.entities.values()];
  }

  // ─── Serialization ───────────────────────────────────────────────────────────

  toJSON(): Entity[] {
    return this.all();
  }

  static fromJSON(data: Entity[]): EntityRegistry {
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

  private indexEntity(entity: Entity): void {
    const props = entity.properties ?? {};
    const poiId = props.poiId as string | undefined;
    const category = props.category as string | undefined;
    const footprint = props.footprint as { w: number; h: number } | undefined;
    const fw = footprint?.w ?? 1;
    const fh = footprint?.h ?? 1;
    const tx = Math.floor(entity.x);
    const ty = Math.floor(entity.y);

    // POI index
    if (poiId) {
      let s = this.byPoi.get(poiId);
      if (!s) { s = new Set(); this.byPoi.set(poiId, s); }
      s.add(entity.id);
    }

    // Category index
    if (category) {
      let cs = this.byCategory.get(category);
      if (!cs) { cs = new Set(); this.byCategory.set(category, cs); }
      cs.add(entity.id);
    }

    // Tile index — register every footprint cell
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        const key = `${tx + dx},${ty + dy}`;
        let ts = this.byTile.get(key);
        if (!ts) { ts = new Set(); this.byTile.set(key, ts); }
        ts.add(entity.id);
      }
    }
  }

  private deindexEntity(entity: Entity): void {
    const props = entity.properties ?? {};
    const poiId = props.poiId as string | undefined;
    const category = props.category as string | undefined;
    const footprint = props.footprint as { w: number; h: number } | undefined;
    const fw = footprint?.w ?? 1;
    const fh = footprint?.h ?? 1;
    const tx = Math.floor(entity.x);
    const ty = Math.floor(entity.y);

    if (poiId) this.byPoi.get(poiId)?.delete(entity.id);
    if (category) this.byCategory.get(category)?.delete(entity.id);
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        this.byTile.get(`${tx + dx},${ty + dy}`)?.delete(entity.id);
      }
    }
  }
}
