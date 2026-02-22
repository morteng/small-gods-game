/**
 * SpatialHashGrid
 *
 * Grid-based spatial index for fast radius and rectangle queries.
 * Used by EntityRegistry to answer "what's near tile (x, y)?" in O(1) average.
 *
 * Cell size of 16 tiles means:
 *   - 256×256 map → 16×16 = 256 hash cells
 *   - Radius query of r=15 checks ≤9 cells
 */

export class SpatialHashGrid {
  private readonly cellSize: number;
  /** cell hash → set of entity IDs */
  private cells: Map<number, Set<string>>;
  /** entity ID → tile position */
  private positions: Map<string, { x: number; y: number }>;

  constructor(cellSize = 16) {
    this.cellSize = cellSize;
    this.cells    = new Map();
    this.positions = new Map();
  }

  private hashKey(cx: number, cy: number): number {
    // Pack two 16-bit cell coords into a 32-bit integer
    return ((cx & 0xffff) | ((cy & 0xffff) << 16)) >>> 0;
  }

  private cellOf(x: number, y: number): { cx: number; cy: number } {
    return {
      cx: Math.floor(x / this.cellSize),
      cy: Math.floor(y / this.cellSize),
    };
  }

  add(id: string, x: number, y: number): void {
    const { cx, cy } = this.cellOf(x, y);
    const key = this.hashKey(cx, cy);
    let cell = this.cells.get(key);
    if (!cell) { cell = new Set(); this.cells.set(key, cell); }
    cell.add(id);
    this.positions.set(id, { x, y });
  }

  remove(id: string): boolean {
    const pos = this.positions.get(id);
    if (!pos) return false;
    const { cx, cy } = this.cellOf(pos.x, pos.y);
    this.cells.get(this.hashKey(cx, cy))?.delete(id);
    this.positions.delete(id);
    return true;
  }

  move(id: string, newX: number, newY: number): void {
    this.remove(id);
    this.add(id, newX, newY);
  }

  /** IDs within Euclidean radius (inclusive) */
  getInRadius(cx: number, cy: number, radius: number): string[] {
    const r2  = radius * radius;
    const result: string[] = [];
    const minCX = Math.floor((cx - radius) / this.cellSize);
    const maxCX = Math.floor((cx + radius) / this.cellSize);
    const minCY = Math.floor((cy - radius) / this.cellSize);
    const maxCY = Math.floor((cy + radius) / this.cellSize);

    for (let gy = minCY; gy <= maxCY; gy++) {
      for (let gx = minCX; gx <= maxCX; gx++) {
        const cell = this.cells.get(this.hashKey(gx, gy));
        if (!cell) continue;
        for (const id of cell) {
          const p  = this.positions.get(id)!;
          const dx = p.x - cx, dy = p.y - cy;
          if (dx * dx + dy * dy <= r2) result.push(id);
        }
      }
    }
    return result;
  }

  /** IDs within an axis-aligned rectangle [x, x+w) × [y, y+h) */
  getInRect(x: number, y: number, w: number, h: number): string[] {
    const result: string[] = [];
    const minCX = Math.floor(x / this.cellSize);
    const maxCX = Math.floor((x + w - 1) / this.cellSize);
    const minCY = Math.floor(y / this.cellSize);
    const maxCY = Math.floor((y + h - 1) / this.cellSize);

    for (let gy = minCY; gy <= maxCY; gy++) {
      for (let gx = minCX; gx <= maxCX; gx++) {
        const cell = this.cells.get(this.hashKey(gx, gy));
        if (!cell) continue;
        for (const id of cell) {
          const p = this.positions.get(id)!;
          if (p.x >= x && p.x < x + w && p.y >= y && p.y < y + h) result.push(id);
        }
      }
    }
    return result;
  }

  get size(): number { return this.positions.size; }

  clear(): void {
    this.cells.clear();
    this.positions.clear();
  }
}
