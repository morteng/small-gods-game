/**
 * WFC Propagator
 *
 * Implements constraint propagation using AC-3/AC-4 algorithm.
 * When a cell collapses, propagate constraints to neighbors.
 */

class Propagator {
  /**
   * @param {Grid} grid - The WFC grid
   * @param {TileSet} tileSet - The tile set with adjacency rules
   */
  constructor(grid, tileSet) {
    this.grid = grid;
    this.tileSet = tileSet;
  }

  /**
   * Propagate constraints starting from a cell
   * Uses a worklist/queue approach for efficiency
   *
   * @param {number} startX - Starting X position
   * @param {number} startY - Starting Y position
   * @returns {boolean} True if propagation succeeded, false if contradiction
   */
  propagate(startX, startY) {
    // Queue of cells to process: {x, y}
    const queue = [{ x: startX, y: startY }];
    const inQueue = new Set([`${startX},${startY}`]);

    while (queue.length > 0) {
      const { x, y } = queue.shift();
      inQueue.delete(`${x},${y}`);

      const cell = this.grid.getCell(x, y);
      if (!cell) continue;

      // Get all valid tiles for this cell
      const validTiles = Array.from(cell.possibilities);

      // For each neighbor, constrain based on adjacency rules
      const neighbors = this.grid.getNeighbors(x, y);

      for (const { cell: neighbor, direction } of neighbors) {
        if (neighbor.isCollapsed()) continue;

        // Calculate which tiles the neighbor can have
        // based on what tiles are still possible in this cell
        const allowedNeighborTiles = new Set();

        for (const tileId of validTiles) {
          const adjacentTiles = this.tileSet.getNeighbors(tileId);
          for (const adjTile of adjacentTiles) {
            allowedNeighborTiles.add(adjTile);
          }
        }

        // Constrain neighbor's possibilities
        const changed = neighbor.constrain(allowedNeighborTiles);

        if (changed) {
          // Check for contradiction
          if (!neighbor.isValid()) {
            return false; // Contradiction found
          }

          // Add neighbor to queue if not already there
          const key = `${neighbor.x},${neighbor.y}`;
          if (!inQueue.has(key)) {
            queue.push({ x: neighbor.x, y: neighbor.y });
            inQueue.add(key);
          }
        }
      }
    }

    return true; // No contradictions
  }

  /**
   * Propagate from all collapsed cells (initial seeding)
   * @returns {boolean} True if propagation succeeded
   */
  propagateAll() {
    // Find all collapsed cells and propagate from them
    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        const cell = this.grid.getCell(x, y);
        if (cell.isCollapsed()) {
          if (!this.propagate(x, y)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  /**
   * Check if placing a tile at a position would cause immediate contradiction
   * @param {number} x
   * @param {number} y
   * @param {string} tileId
   * @returns {boolean} True if valid placement
   */
  isValidPlacement(x, y, tileId) {
    const neighbors = this.grid.getNeighbors(x, y);
    const allowedNeighbors = this.tileSet.getNeighbors(tileId);

    for (const { cell: neighbor } of neighbors) {
      if (neighbor.isCollapsed()) {
        const neighborTile = neighbor.getTile();
        // Check both directions of adjacency
        if (!allowedNeighbors.includes(neighborTile)) {
          return false;
        }
        const neighborAllowed = this.tileSet.getNeighbors(neighborTile);
        if (!neighborAllowed.includes(tileId)) {
          return false;
        }
      } else {
        // Check if at least one possibility is compatible
        let hasCompatible = false;
        for (const possibility of neighbor.possibilities) {
          if (allowedNeighbors.includes(possibility)) {
            hasCompatible = true;
            break;
          }
        }
        if (!hasCompatible) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get valid tiles for a cell based on its neighbors
   * @param {number} x
   * @param {number} y
   * @returns {Set<string>} Valid tile IDs
   */
  getValidTilesForCell(x, y) {
    const cell = this.grid.getCell(x, y);
    if (!cell) return new Set();

    const validTiles = new Set(cell.possibilities);
    const neighbors = this.grid.getNeighbors(x, y);

    for (const tileId of Array.from(validTiles)) {
      if (!this.isValidPlacement(x, y, tileId)) {
        validTiles.delete(tileId);
      }
    }

    return validTiles;
  }
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Propagator };
} else {
  window.WFC = window.WFC || {};
  window.WFC.Propagator = Propagator;
}
