/**
 * DecorationPlacer - Handles decoration placement on maps
 *
 * Supports auto-population, manual placement, and removal of decorations
 * with proper rule enforcement (allowed tiles, probability, minimum distance)
 */

(function(global) {
  'use strict';

  // Use SeededRandom from DecorationRenderer
  const getSeededRandom = (seed) => {
    return new (global.DecorationRenderer?.SeededRandom || class {
      constructor(s) { this.seed = s; this.state = s; }
      next() {
        let t = this.state += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      }
      range(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; }
      rangeFloat(min, max) { return this.next() * (max - min) + min; }
    })(seed);
  };

  /**
   * DecorationPlacer - Main placer module
   */
  const DecorationPlacer = {
    /**
     * Auto-populate a map with decorations based on tile types
     * @param {Object} map - Map object with tiles array and dimensions
     * @param {string} [biome] - Optional biome for filtering decorations
     * @param {number} [seed] - Random seed for consistent generation
     * @returns {Object} Statistics about placements
     */
    autoPlaceDecorations(map, biome = null, seed = Date.now()) {
      if (!map || !map.tiles) {
        console.error('DecorationPlacer: Invalid map');
        return { total: 0, byType: {} };
      }

      const Registry = global.DecorationRegistry;
      if (!Registry) {
        console.error('DecorationPlacer: DecorationRegistry not found');
        return { total: 0, byType: {} };
      }

      const stats = { total: 0, byType: {} };
      const rng = getSeededRandom(seed);
      const width = map.width || map.tiles[0]?.length || 0;
      const height = map.height || map.tiles.length;

      // Track placements for minimum distance checking
      const placements = new Map(); // decorationId -> [{x, y}]

      // Process each tile
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = map.tiles[y]?.[x];
          if (!tile) continue;

          // Initialize decorations array if not present
          if (!tile.decorations) {
            tile.decorations = [];
          }

          // Get tile type
          const tileType = this._getTileType(tile);
          if (!tileType) continue;

          // Get valid decorations for this tile
          const validDecorations = Registry.getForTile(tileType, biome);

          // Try to place each valid decoration
          for (const def of validDecorations) {
            // Check probability
            const prob = def.placement?.probability ?? 0.1;
            if (rng.next() > prob) continue;

            // Check minimum distance
            const minDist = def.placement?.minDistance ?? 0;
            if (minDist > 0 && !this._checkMinDistance(x, y, def.id, minDist, placements)) {
              continue;
            }

            // Check max per tile
            const maxPerTile = def.placement?.maxPerTile ?? 1;
            const currentCount = tile.decorations.filter(d => d.id === def.id).length;
            if (currentCount >= maxPerTile) continue;

            // Place the decoration
            const instance = {
              id: def.id,
              seed: rng.range(0, 1000000),
              offsetX: def.placement?.randomOffset ? rng.rangeFloat(-2, 2) : 0,
              offsetY: def.placement?.randomOffset ? rng.rangeFloat(-1, 1) : 0
            };

            tile.decorations.push(instance);

            // Track placement
            if (!placements.has(def.id)) {
              placements.set(def.id, []);
            }
            placements.get(def.id).push({ x, y });

            // Update stats
            stats.total++;
            stats.byType[def.id] = (stats.byType[def.id] || 0) + 1;
          }
        }
      }

      console.log(`DecorationPlacer: Placed ${stats.total} decorations`, stats.byType);
      return stats;
    },

    /**
     * Place a specific decoration at a location
     * @param {Object} map - Map object
     * @param {number} x - Tile X coordinate
     * @param {number} y - Tile Y coordinate
     * @param {string} decorationId - Decoration type ID
     * @param {Object} [options] - Additional options
     * @returns {boolean} Success status
     */
    placeDecoration(map, x, y, decorationId, options = {}) {
      const Registry = global.DecorationRegistry;
      if (!Registry) {
        console.error('DecorationPlacer: DecorationRegistry not found');
        return false;
      }

      const def = Registry.get(decorationId);
      if (!def) {
        console.error(`DecorationPlacer: Unknown decoration "${decorationId}"`);
        return false;
      }

      // Get the tile
      const tile = map.tiles?.[y]?.[x];
      if (!tile) {
        console.error(`DecorationPlacer: Invalid tile at (${x}, ${y})`);
        return false;
      }

      // Check if placement is allowed (unless forced)
      if (!options.force) {
        const tileType = this._getTileType(tile);
        const allowed = def.placement?.allowedTiles;
        if (allowed && allowed.length > 0 && !allowed.includes(tileType) && !allowed.includes('*')) {
          console.warn(`DecorationPlacer: "${decorationId}" not allowed on "${tileType}"`);
          return false;
        }
      }

      // Initialize decorations array
      if (!tile.decorations) {
        tile.decorations = [];
      }

      // Check max per tile (unless forced)
      if (!options.force) {
        const maxPerTile = def.placement?.maxPerTile ?? 1;
        const currentCount = tile.decorations.filter(d => d.id === decorationId).length;
        if (currentCount >= maxPerTile) {
          console.warn(`DecorationPlacer: Max "${decorationId}" reached on tile (${x}, ${y})`);
          return false;
        }
      }

      // Create instance
      const instance = {
        id: decorationId,
        seed: options.seed ?? Math.floor(Math.random() * 1000000),
        offsetX: options.offsetX ?? 0,
        offsetY: options.offsetY ?? 0
      };

      // Add custom properties
      if (options.properties) {
        Object.assign(instance, options.properties);
      }

      tile.decorations.push(instance);
      return true;
    },

    /**
     * Remove a decoration from a tile
     * @param {Object} map - Map object
     * @param {number} x - Tile X coordinate
     * @param {number} y - Tile Y coordinate
     * @param {string} [decorationId] - Optional specific decoration to remove (removes all if not specified)
     * @param {number} [instanceIndex] - Optional specific instance index to remove
     * @returns {number} Number of decorations removed
     */
    removeDecoration(map, x, y, decorationId = null, instanceIndex = null) {
      const tile = map.tiles?.[y]?.[x];
      if (!tile || !tile.decorations) return 0;

      let removed = 0;

      if (instanceIndex !== null) {
        // Remove specific instance
        if (tile.decorations[instanceIndex]) {
          tile.decorations.splice(instanceIndex, 1);
          removed = 1;
        }
      } else if (decorationId) {
        // Remove all of specific type
        const before = tile.decorations.length;
        tile.decorations = tile.decorations.filter(d => d.id !== decorationId);
        removed = before - tile.decorations.length;
      } else {
        // Remove all
        removed = tile.decorations.length;
        tile.decorations = [];
      }

      return removed;
    },

    /**
     * Clear all decorations from the map
     * @param {Object} map - Map object
     * @returns {number} Total decorations removed
     */
    clearAll(map) {
      if (!map || !map.tiles) return 0;

      let total = 0;
      const height = map.tiles.length;

      for (let y = 0; y < height; y++) {
        const row = map.tiles[y];
        if (!row) continue;
        for (let x = 0; x < row.length; x++) {
          const tile = row[x];
          if (tile && tile.decorations) {
            total += tile.decorations.length;
            tile.decorations = [];
          }
        }
      }

      return total;
    },

    /**
     * Get all decorations at a specific tile
     * @param {Object} map - Map object
     * @param {number} x - Tile X coordinate
     * @param {number} y - Tile Y coordinate
     * @returns {Array} Array of decoration instances
     */
    getDecorations(map, x, y) {
      const tile = map.tiles?.[y]?.[x];
      return tile?.decorations || [];
    },

    /**
     * Check if a tile has a specific decoration
     * @param {Object} map - Map object
     * @param {number} x - Tile X coordinate
     * @param {number} y - Tile Y coordinate
     * @param {string} decorationId - Decoration type ID
     * @returns {boolean}
     */
    hasDecoration(map, x, y, decorationId) {
      const decorations = this.getDecorations(map, x, y);
      return decorations.some(d => d.id === decorationId);
    },

    /**
     * Get statistics about decorations on the map
     * @param {Object} map - Map object
     * @returns {Object} Statistics
     */
    getStats(map) {
      if (!map || !map.tiles) return { total: 0, byType: {}, tilesWithDecorations: 0 };

      const stats = { total: 0, byType: {}, tilesWithDecorations: 0 };
      const height = map.tiles.length;

      for (let y = 0; y < height; y++) {
        const row = map.tiles[y];
        if (!row) continue;
        for (let x = 0; x < row.length; x++) {
          const tile = row[x];
          if (tile && tile.decorations && tile.decorations.length > 0) {
            stats.tilesWithDecorations++;
            for (const dec of tile.decorations) {
              stats.total++;
              stats.byType[dec.id] = (stats.byType[dec.id] || 0) + 1;
            }
          }
        }
      }

      return stats;
    },

    /**
     * Check if decoration blocks movement on a tile
     * @param {Object} map - Map object
     * @param {number} x - Tile X coordinate
     * @param {number} y - Tile Y coordinate
     * @returns {boolean} True if any decoration blocks movement
     */
    isBlocking(map, x, y) {
      const Registry = global.DecorationRegistry;
      if (!Registry) return false;

      const decorations = this.getDecorations(map, x, y);
      for (const dec of decorations) {
        const def = Registry.get(dec.id);
        if (def && def.blocksMovement) {
          return true;
        }
      }
      return false;
    },

    // ============ Private Helpers ============

    /**
     * Get tile type ID from tile object
     */
    _getTileType(tile) {
      if (!tile) return null;
      // Handle different tile data structures
      if (typeof tile === 'string') return tile;
      if (tile.id) return tile.id;
      if (tile.type) return tile.type;
      if (tile.tileType) return tile.tileType;
      return null;
    },

    /**
     * Check minimum distance constraint
     */
    _checkMinDistance(x, y, decorationId, minDistance, placements) {
      const existing = placements.get(decorationId);
      if (!existing) return true;

      for (const pos of existing) {
        const dist = Math.abs(pos.x - x) + Math.abs(pos.y - y); // Manhattan distance
        if (dist < minDistance) {
          return false;
        }
      }
      return true;
    }
  };

  // Expose globally
  global.DecorationPlacer = DecorationPlacer;

})(typeof window !== 'undefined' ? window : global);
