import type { Region } from '@/core/types';

/** Grid-hash spatial index. Default cell size 4 tiles. */
export class SpatialIndex {
  private cells = new Map<number, Set<string>>();
  constructor(public readonly cellSize: number = 4) {}

  private key(cx: number, cy: number): number {
    return ((cx & 0xffff) | ((cy & 0xffff) << 16)) >>> 0;
  }

  private cellOf(x: number, y: number): { cx: number; cy: number } {
    return { cx: Math.floor(x / this.cellSize), cy: Math.floor(y / this.cellSize) };
  }

  add(id: string, x: number, y: number): void {
    const { cx, cy } = this.cellOf(x, y);
    const k = this.key(cx, cy);
    let set = this.cells.get(k);
    if (!set) { set = new Set(); this.cells.set(k, set); }
    set.add(id);
  }

  remove(id: string, x: number, y: number): void {
    const { cx, cy } = this.cellOf(x, y);
    this.cells.get(this.key(cx, cy))?.delete(id);
  }

  /**
   * Returns ids whose containing cell intersects the rect [x, x+w] × [y, y+h].
   * Note: this is a coarse-grained candidate set — the caller filters by exact
   * entity position. The boundary test asserts that an entity at exactly
   * (3, 3) and one at exactly (4, 4) both intersect a 2×2 rect at (3, 3).
   */
  queryRect(r: Region): string[] {
    const result: string[] = [];
    const minCX = Math.floor(r.x / this.cellSize);
    const maxCX = Math.ceil((r.x + r.w) / this.cellSize) - 1;
    const minCY = Math.floor(r.y / this.cellSize);
    const maxCY = Math.ceil((r.y + r.h) / this.cellSize) - 1;
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const set = this.cells.get(this.key(cx, cy));
        if (!set) continue;
        for (const id of set) result.push(id);
      }
    }
    return result;
  }

  clear(): void { this.cells.clear(); }
}

/** kind → set of entity ids */
export class KindIndex {
  private byKindMap = new Map<string, Set<string>>();

  add(id: string, kind: string): void {
    let s = this.byKindMap.get(kind);
    if (!s) { s = new Set(); this.byKindMap.set(kind, s); }
    s.add(id);
  }

  remove(id: string, kind: string): void {
    this.byKindMap.get(kind)?.delete(id);
  }

  byKind(kind: string): string[] {
    const s = this.byKindMap.get(kind);
    return s ? [...s] : [];
  }

  clear(): void { this.byKindMap.clear(); }
}

/** tag → set of entity ids */
export class TagIndex {
  private byTagMap = new Map<string, Set<string>>();

  add(id: string, tags: ReadonlyArray<string> | undefined): void {
    if (!tags) return;
    for (const t of tags) {
      let s = this.byTagMap.get(t);
      if (!s) { s = new Set(); this.byTagMap.set(t, s); }
      s.add(id);
    }
  }

  remove(id: string, tags: ReadonlyArray<string> | undefined): void {
    if (!tags) return;
    for (const t of tags) this.byTagMap.get(t)?.delete(id);
  }

  byTag(tag: string): string[] {
    const s = this.byTagMap.get(tag);
    return s ? [...s] : [];
  }

  clear(): void { this.byTagMap.clear(); }
}
