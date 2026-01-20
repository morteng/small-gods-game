/**
 * WFC Grid
 *
 * 2D grid of cells for Wave Function Collapse.
 * Manages the overall state and provides iteration methods.
 */

class Grid {
  // Get Cell class (works in both Node.js and browser)
  static get CellClass() {
    if (typeof require !== 'undefined') {
      return require('./Cell').Cell;
    }
    return window.WFC?.Cell;
  }

  /**
   * @param {number} width - Grid width
   * @param {number} height - Grid height
   * @param {TileSet} tileSet - The tile set to use
   */
  constructor(width, height, tileSet) {
    this.width = width;
    this.height = height;
    this.tileSet = tileSet;
    this.cells = [];
    this.history = []; // For backtracking

    this.initialize();
  }

  /**
   * Initialize all cells with all possibilities
   */
  initialize() {
    const allTiles = this.tileSet.getAllTileIds();
    const weights = {};
    for (const id of allTiles) {
      weights[id] = this.tileSet.getWeight(id);
    }

    this.cells = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) {
        row.push(new Grid.CellClass(x, y, allTiles, weights));
      }
      this.cells.push(row);
    }
  }

  /**
   * Get cell at position
   */
  getCell(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    return this.cells[y][x];
  }

  /**
   * Check if position is in bounds
   */
  inBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Get all neighbors of a cell (4-way adjacency)
   */
  getNeighbors(x, y) {
    const neighbors = [];
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

  /**
   * Find cell with lowest entropy that isn't collapsed
   * @returns {Cell|null}
   */
  getLowestEntropyCell() {
    let minEntropy = Infinity;
    let minCell = null;

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

  /**
   * Check if all cells are collapsed
   */
  isFullyCollapsed() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.cells[y][x].isCollapsed()) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Check if any cell has no valid possibilities (contradiction)
   */
  hasContradiction() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.cells[y][x].isValid()) {
          return { x, y };
        }
      }
    }
    return null;
  }

  /**
   * Save current state for backtracking
   */
  saveState() {
    const state = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) {
        row.push(this.cells[y][x].clone());
      }
      state.push(row);
    }
    this.history.push(state);
  }

  /**
   * Restore previous state (backtrack)
   */
  restoreState() {
    if (this.history.length === 0) {
      return false;
    }
    this.cells = this.history.pop();
    return true;
  }

  /**
   * Get count of collapsed cells (for progress)
   */
  getCollapsedCount() {
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

  /**
   * Get total cell count
   */
  getTotalCount() {
    return this.width * this.height;
  }

  /**
   * Get progress as percentage
   */
  getProgress() {
    return (this.getCollapsedCount() / this.getTotalCount()) * 100;
  }

  /**
   * Seed a cell with a specific tile (for POIs)
   * @param {number} x
   * @param {number} y
   * @param {string} tileId
   */
  seedCell(x, y, tileId) {
    const cell = this.getCell(x, y);
    if (cell) {
      cell.forceCollapse(tileId);
    }
  }

  /**
   * Apply weight modifiers to a region
   * @param {Object} region - {x_min, x_max, y_min, y_max}
   * @param {Object} modifiers - {tileId: multiplier}
   */
  applyRegionModifiers(region, modifiers) {
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

  /**
   * Convert grid to tile map (after fully collapsed)
   */
  toTileMap() {
    const tiles = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[y][x];
        const tileId = cell.getTile();
        const tileDef = this.tileSet.getTile(tileId);
        row.push({
          type: tileId,
          x,
          y,
          walkable: tileDef?.walkable ?? true,
          height: tileDef?.height ?? 0
        });
      }
      tiles.push(row);
    }
    return { tiles, width: this.width, height: this.height };
  }

  /**
   * Iterate over all cells
   */
  *[Symbol.iterator]() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        yield this.cells[y][x];
      }
    }
  }

  /**
   * Debug: Print grid state
   */
  debugPrint() {
    const chars = {
      // Water
      deep_water: '~',
      shallow_water: '≈',
      river: '≋',
      // Wetland
      marsh: '∿',
      swamp: '⍦',
      bog: '░',
      // Lowland
      sand: '.',
      grass: ',',
      meadow: '\'',
      glen: '`',
      scrubland: ';',
      // Forest
      forest: '♣',
      dense_forest: '♠',
      pine_forest: '↟',
      dead_forest: '†',
      // Highland
      hills: '^',
      rocky: '#',
      cliffs: '▓',
      mountain: '▲',
      peak: '△',
      // Roads
      dirt_road: '─',
      stone_road: '═',
      bridge: '┼',
      // Buildings
      building_wood: '□',
      building_stone: '■',
      castle_wall: '█',
      castle_tower: '♜',
      ruins: '◊',
      // Special
      farm_field: '▒',
      orchard: '○',
      market: '☆',
      dock: '▬',
      well: '●'
    };

    let output = '';
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[y][x];
        if (cell.isCollapsed()) {
          output += chars[cell.getTile()] || '?';
        } else {
          output += String(cell.getPossibilityCount() % 10);
        }
      }
      output += '\n';
    }
    return output;
  }
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Grid };
} else {
  window.WFC = window.WFC || {};
  window.WFC.Grid = Grid;
}
