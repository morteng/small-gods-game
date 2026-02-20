/**
 * WFC Propagator
 *
 * Implements constraint propagation using AC-3/AC-4 algorithm.
 * When a cell collapses, propagate constraints to neighbors.
 */

import { Grid } from './grid';
import { TileSet } from './tile';

export class Propagator {
  grid: Grid;
  tileSet: TileSet;

  constructor(grid: Grid, tileSet: TileSet) {
    this.grid = grid;
    this.tileSet = tileSet;
  }

  /**
   * Propagate constraints starting from a cell.
   * Uses a worklist/queue approach for efficiency.
   * @returns True if propagation succeeded, false if contradiction
   */
  propagate(startX: number, startY: number): boolean {
    // Queue of cells to process
    const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];
    const inQueue = new Set([`${startX},${startY}`]);

    while (queue.length > 0) {
      const { x, y } = queue.shift()!;
      inQueue.delete(`${x},${y}`);

      const cell = this.grid.getCell(x, y);
      if (!cell) continue;

      // Get all valid tiles for this cell
      const validTiles = Array.from(cell.possibilities);

      // For each neighbor, constrain based on adjacency rules
      const neighbors = this.grid.getNeighbors(x, y);

      for (const { cell: neighbor } of neighbors) {
        if (neighbor.isCollapsed()) continue;

        // Calculate which tiles the neighbor can have
        // based on what tiles are still possible in this cell
        const allowedNeighborTiles = new Set<string>();

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
   * Propagate from all collapsed cells (initial seeding).
   * @returns True if propagation succeeded
   */
  propagateAll(): boolean {
    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        const cell = this.grid.getCell(x, y);
        if (cell && cell.isCollapsed()) {
          if (!this.propagate(x, y)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  /**
   * Check if placing a tile at a position would cause immediate contradiction.
   * @returns True if valid placement
   */
  isValidPlacement(x: number, y: number, tileId: string): boolean {
    const neighbors = this.grid.getNeighbors(x, y);
    const allowedNeighbors = this.tileSet.getNeighbors(tileId);

    for (const { cell: neighbor } of neighbors) {
      if (neighbor.isCollapsed()) {
        const neighborTile = neighbor.getTile()!;
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
   * Get valid tiles for a cell based on its neighbors.
   * @returns Set of valid tile IDs
   */
  getValidTilesForCell(x: number, y: number): Set<string> {
    const cell = this.grid.getCell(x, y);
    if (!cell) return new Set();

    const validTiles = new Set(cell.possibilities);

    for (const tileId of Array.from(validTiles)) {
      if (!this.isValidPlacement(x, y, tileId)) {
        validTiles.delete(tileId);
      }
    }

    return validTiles;
  }
}
