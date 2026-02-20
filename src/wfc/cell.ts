/**
 * WFC Cell
 *
 * Represents a single cell in the WFC grid.
 * Each cell tracks which tile types are still possible (superposition).
 */

export class Cell {
  x: number;
  y: number;
  possibilities: Set<string>;
  weights: Record<string, number>;
  collapsed: boolean;
  tile: string | null;

  constructor(x: number, y: number, possibleTiles: string[], tileWeights: Record<string, number> = {}) {
    this.x = x;
    this.y = y;
    this.possibilities = new Set(possibleTiles);
    this.weights = tileWeights;
    this.collapsed = false;
    this.tile = null;
  }

  /** Check if cell is collapsed (has single possibility) */
  isCollapsed(): boolean {
    return this.collapsed || this.possibilities.size === 1;
  }

  /** Get the collapsed tile ID (null if not collapsed) */
  getTile(): string | null {
    if (this.collapsed) return this.tile;
    if (this.possibilities.size === 1) {
      return Array.from(this.possibilities)[0];
    }
    return null;
  }

  /**
   * Calculate Shannon entropy with noise.
   * Lower entropy = fewer possibilities = should collapse first.
   */
  getEntropy(): number {
    if (this.isCollapsed()) return 0;

    const n = this.possibilities.size;
    if (n <= 1) return 0;

    // Calculate weighted entropy
    let sumWeights = 0;
    let sumWeightLogWeight = 0;

    for (const tileId of this.possibilities) {
      const w = this.weights[tileId] || 1;
      sumWeights += w;
      sumWeightLogWeight += w * Math.log(w);
    }

    // Shannon entropy formula
    const entropy = Math.log(sumWeights) - sumWeightLogWeight / sumWeights;

    // Add small noise to break ties randomly
    return entropy + Math.random() * 0.001;
  }

  /**
   * Collapse cell to a single tile, weighted by probability.
   * @param rng - Optional random function (0-1)
   * @returns The chosen tile ID
   */
  collapse(rng: () => number = Math.random): string {
    if (this.possibilities.size === 0) {
      throw new Error(`Cannot collapse cell at (${this.x}, ${this.y}): no possibilities`);
    }

    if (this.possibilities.size === 1) {
      this.tile = Array.from(this.possibilities)[0];
      this.collapsed = true;
      return this.tile;
    }

    // Weighted random selection
    const tiles = Array.from(this.possibilities);
    const weights = tiles.map(id => this.weights[id] || 1);
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    let r = rng() * totalWeight;
    for (let i = 0; i < tiles.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        this.tile = tiles[i];
        this.collapsed = true;
        this.possibilities.clear();
        this.possibilities.add(this.tile);
        return this.tile;
      }
    }

    // Fallback to last tile
    this.tile = tiles[tiles.length - 1];
    this.collapsed = true;
    this.possibilities.clear();
    this.possibilities.add(this.tile);
    return this.tile;
  }

  /** Force cell to a specific tile (used for seeding) */
  forceCollapse(tileId: string): void {
    this.tile = tileId;
    this.collapsed = true;
    this.possibilities.clear();
    this.possibilities.add(tileId);
  }

  /**
   * Remove a possibility from this cell.
   * @returns True if the tile was removed
   */
  removePossibility(tileId: string): boolean {
    if (this.collapsed) return false;
    if (!this.possibilities.has(tileId)) return false;

    this.possibilities.delete(tileId);

    // Auto-collapse if only one possibility remains
    if (this.possibilities.size === 1) {
      this.tile = Array.from(this.possibilities)[0];
      this.collapsed = true;
    }

    return true;
  }

  /**
   * Constrain possibilities to only those in the given set.
   * @returns True if any tiles were removed
   */
  constrain(allowed: Set<string> | string[]): boolean {
    if (this.collapsed) return false;

    const allowedSet = allowed instanceof Set ? allowed : new Set(allowed);
    let changed = false;

    for (const tileId of Array.from(this.possibilities)) {
      if (!allowedSet.has(tileId)) {
        this.possibilities.delete(tileId);
        changed = true;
      }
    }

    // Auto-collapse if only one possibility remains
    if (this.possibilities.size === 1 && !this.collapsed) {
      this.tile = Array.from(this.possibilities)[0];
      this.collapsed = true;
    }

    return changed;
  }

  /** Check if cell has any valid possibilities */
  isValid(): boolean {
    return this.possibilities.size > 0;
  }

  /** Get count of remaining possibilities */
  getPossibilityCount(): number {
    return this.possibilities.size;
  }

  /** Clone this cell */
  clone(): Cell {
    const cell = new Cell(this.x, this.y, [], { ...this.weights });
    cell.possibilities = new Set(this.possibilities);
    cell.collapsed = this.collapsed;
    cell.tile = this.tile;
    return cell;
  }

  /** Serialize for debugging */
  toJSON(): { x: number; y: number; collapsed: boolean; tile: string | null; possibilities: string[] } {
    return {
      x: this.x,
      y: this.y,
      collapsed: this.collapsed,
      tile: this.tile,
      possibilities: Array.from(this.possibilities)
    };
  }
}
