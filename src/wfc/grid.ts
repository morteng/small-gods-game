/**
 * WFC Grid
 *
 * 2D grid of cells for Wave Function Collapse.
 * Manages the overall state and provides iteration methods.
 */

import { Cell } from './cell';
import { TileSet } from './tile';

export class Grid {
  width: number;
  height: number;
  tileSet: TileSet;
  cells: Cell[][];
  history: Cell[][][];

  constructor(width: number, height: number, tileSet: TileSet) {
    this.width = width;
    this.height = height;
    this.tileSet = tileSet;
    this.cells = [];
    this.history = []; // For backtracking

    this.initialize();
  }

  /** Initialize all cells with all possibilities */
  initialize(): void {
    const allTiles = this.tileSet.getAllTileIds();
    const weights: Record<string, number> = {};
    for (const id of allTiles) {
      weights[id] = this.tileSet.getWeight(id);
    }

    this.cells = [];
    for (let y = 0; y < this.height; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < this.width; x++) {
        row.push(new Cell(x, y, allTiles, weights));
      }
      this.cells.push(row);
    }
  }

  /** Get cell at position */
  getCell(x: number, y: number): Cell | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    return this.cells[y][x];
  }

  /** Check if position is in bounds */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /** Get all neighbors of a cell (4-way adjacency) */
  getNeighbors(x: number, y: number): { cell: Cell; direction: string }[] {
    const neighbors: { cell: Cell; direction: string }[] = [];
    const directions = [
      { dx: 0, dy: -1, dir: 'north' },
      { dx: 1, dy: 0, dir: 'east' },
      { dx: 0, dy: 1, dir: 'south' },
      { dx: -1, dy: 0, dir: 'west' }
    ];

    for (const { dx, dy, dir } of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.inBounds(nx, ny)) {
        neighbors.push({ cell: this.cells[ny][nx], direction: dir });
      }
    }

    return neighbors;
  }

  /** Find cell with lowest entropy that isn't collapsed */
  getLowestEntropyCell(): Cell | null {
    let minEntropy = Infinity;
    let minCell: Cell | null = null;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[y][x];
        if (!cell.isCollapsed()) {
          const entropy = cell.getEntropy();
          if (entropy < minEntropy) {
            minEntropy = entropy;
            minCell = cell;
          }
        }
      }
    }

    return minCell;
  }

  /** Check if all cells are collapsed */
  isFullyCollapsed(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.cells[y][x].isCollapsed()) {
          return false;
        }
      }
    }
    return true;
  }

  /** Check if any cell has no valid possibilities (contradiction) */
  hasContradiction(): { x: number; y: number } | null {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.cells[y][x].isValid()) {
          return { x, y };
        }
      }
    }
    return null;
  }

  /** Save current state for backtracking */
  saveState(): void {
    const state: Cell[][] = [];
    for (let y = 0; y < this.height; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < this.width; x++) {
        row.push(this.cells[y][x].clone());
      }
      state.push(row);
    }
    this.history.push(state);
  }

  /** Restore previous state (backtrack) */
  restoreState(): boolean {
    if (this.history.length === 0) {
      return false;
    }
    this.cells = this.history.pop()!;
    return true;
  }

  /** Get count of collapsed cells (for progress) */
  getCollapsedCount(): number {
    let count = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells[y][x].isCollapsed()) {
          count++;
        }
      }
    }
    return count;
  }

  /** Get total cell count */
  getTotalCount(): number {
    return this.width * this.height;
  }

  /** Get progress as percentage */
  getProgress(): number {
    return (this.getCollapsedCount() / this.getTotalCount()) * 100;
  }

  /** Seed a cell with a specific tile (for POIs) */
  seedCell(x: number, y: number, tileId: string): void {
    const cell = this.getCell(x, y);
    if (cell) {
      cell.forceCollapse(tileId);
    }
  }

  /** Apply weight modifiers to a region */
  applyRegionModifiers(
    region: { x_min?: number; x_max?: number; y_min?: number; y_max?: number },
    modifiers: Record<string, number>
  ): void {
    const xMin = region.x_min || 0;
    const xMax = region.x_max || this.width - 1;
    const yMin = region.y_min || 0;
    const yMax = region.y_max || this.height - 1;

    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const cell = this.getCell(x, y);
        if (cell && !cell.isCollapsed()) {
          for (const [tileId, multiplier] of Object.entries(modifiers)) {
            if (cell.weights[tileId] !== undefined) {
              cell.weights[tileId] *= multiplier;
            }
          }
        }
      }
    }
  }

  /** Convert grid to tile map (after fully collapsed) */
  toTileMap(): { tiles: { type: string; x: number; y: number; walkable: boolean; height: number }[][]; width: number; height: number } {
    const tiles: { type: string; x: number; y: number; walkable: boolean; height: number }[][] = [];
    for (let y = 0; y < this.height; y++) {
      const row: { type: string; x: number; y: number; walkable: boolean; height: number }[] = [];
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[y][x];
        const tileId = cell.getTile();
        const tileDef = tileId ? this.tileSet.getTile(tileId) : undefined;
        row.push({
          type: tileId || 'grass',
          x,
          y,
          walkable: tileDef?.walkable ?? true,
          height: 0
        });
      }
      tiles.push(row);
    }
    return { tiles, width: this.width, height: this.height };
  }

  /** Iterate over all cells */
  *[Symbol.iterator](): Generator<Cell> {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        yield this.cells[y][x];
      }
    }
  }

  /** Debug: Print grid state */
  debugPrint(): string {
    const chars: Record<string, string> = {
      // Water
      deep_water: '~',
      shallow_water: '\u2248',
      river: '\u224B',
      // Wetland
      marsh: '\u223F',
      swamp: '\u2366',
      bog: '\u2591',
      // Lowland
      sand: '.',
      grass: ',',
      meadow: "'",
      glen: '`',
      scrubland: ';',
      // Forest
      forest: '\u2663',
      dense_forest: '\u2660',
      pine_forest: '\u219F',
      dead_forest: '\u2020',
      // Highland
      hills: '^',
      rocky: '#',
      cliffs: '\u2593',
      mountain: '\u25B2',
      peak: '\u25B3',
      // Roads
      dirt_road: '\u2500',
      stone_road: '\u2550',
      bridge: '\u253C',
      // Buildings
      building_wood: '\u25A1',
      building_stone: '\u25A0',
      castle_wall: '\u2588',
      castle_tower: '\u265C',
      ruins: '\u25CA',
      // Special
      farm_field: '\u2592',
      orchard: '\u25CB',
      market: '\u2606',
      dock: '\u25AC',
      well: '\u25CF'
    };

    let output = '';
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[y][x];
        if (cell.isCollapsed()) {
          output += chars[cell.getTile()!] || '?';
        } else {
          output += String(cell.getPossibilityCount() % 10);
        }
      }
      output += '\n';
    }
    return output;
  }
}
