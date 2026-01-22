/**
 * DecorationRegistry - Central registry for all decoration types
 *
 * Manages decoration definitions, lookup, and validation for the
 * modular decoration system.
 */

(function(global) {
  'use strict';

  // Private storage
  const decorations = new Map();
  const categories = new Map();

  /**
   * DecorationRegistry - Singleton registry for decoration definitions
   */
  const DecorationRegistry = {
    /**
     * Register a decoration definition
     * @param {Object} definition - Decoration definition object
     * @returns {boolean} Success status
     */
    register(definition) {
      if (!definition || !definition.id) {
        console.error('DecorationRegistry: Invalid definition - missing id');
        return false;
      }

      // Validate required fields
      const required = ['id', 'name', 'category'];
      for (const field of required) {
        if (!definition[field]) {
          console.warn(`DecorationRegistry: Definition "${definition.id}" missing field: ${field}`);
        }
      }

      // Store the decoration
      decorations.set(definition.id, definition);

      // Index by category
      const cat = definition.category || 'misc';
      if (!categories.has(cat)) {
        categories.set(cat, new Set());
      }
      categories.get(cat).add(definition.id);

      return true;
    },

    /**
     * Register multiple decorations at once
     * @param {Object} definitions - Object with id keys and definition values
     * @returns {number} Count of successfully registered decorations
     */
    registerAll(definitions) {
      let count = 0;
      for (const [id, def] of Object.entries(definitions)) {
        // Ensure id is set from key if not in definition
        const fullDef = { id, ...def };
        if (this.register(fullDef)) count++;
      }
      return count;
    },

    /**
     * Get a decoration by ID
     * @param {string} id - Decoration identifier
     * @returns {Object|null} Decoration definition or null
     */
    get(id) {
      return decorations.get(id) || null;
    },

    /**
     * Check if a decoration exists
     * @param {string} id - Decoration identifier
     * @returns {boolean}
     */
    has(id) {
      return decorations.has(id);
    },

    /**
     * Get all decorations in a category
     * @param {string} category - Category name
     * @returns {Array} Array of decoration definitions
     */
    getByCategory(category) {
      const ids = categories.get(category);
      if (!ids) return [];
      return Array.from(ids).map(id => decorations.get(id));
    },

    /**
     * Get valid decorations for a specific tile type and biome
     * @param {string} tileType - Tile type id (e.g., 'grass', 'sand')
     * @param {string} [biome] - Optional biome filter
     * @returns {Array} Array of valid decoration definitions
     */
    getForTile(tileType, biome = null) {
      const valid = [];

      for (const [id, def] of decorations) {
        if (!def.placement) continue;

        const { allowedTiles, allowedBiomes, excludedTiles, excludedBiomes } = def.placement;

        // Check tile type
        if (allowedTiles && allowedTiles.length > 0) {
          if (!allowedTiles.includes(tileType) && !allowedTiles.includes('*')) {
            continue;
          }
        }

        // Check excluded tiles
        if (excludedTiles && excludedTiles.includes(tileType)) {
          continue;
        }

        // Check biome if specified
        if (biome) {
          if (allowedBiomes && allowedBiomes.length > 0) {
            if (!allowedBiomes.includes(biome) && !allowedBiomes.includes('*')) {
              continue;
            }
          }
          if (excludedBiomes && excludedBiomes.includes(biome)) {
            continue;
          }
        }

        valid.push(def);
      }

      return valid;
    },

    /**
     * Get AI prompt fragment for a decoration
     * @param {string} id - Decoration identifier
     * @returns {string} Prompt description or empty string
     */
    getPromptFragment(id) {
      const def = decorations.get(id);
      if (!def || !def.prompt) return '';
      return def.prompt.description || '';
    },

    /**
     * Get all prompt fragments for decorations on a tile
     * @param {Array} decorationInstances - Array of {id, ...} decoration instances
     * @returns {Array} Array of unique prompt descriptions
     */
    getPromptFragments(decorationInstances) {
      const fragments = new Set();

      for (const instance of decorationInstances) {
        const fragment = this.getPromptFragment(instance.id);
        if (fragment) fragments.add(fragment);
      }

      return Array.from(fragments);
    },

    /**
     * Get all registered decoration IDs
     * @returns {Array} Array of decoration IDs
     */
    getAllIds() {
      return Array.from(decorations.keys());
    },

    /**
     * Get all categories
     * @returns {Array} Array of category names
     */
    getAllCategories() {
      return Array.from(categories.keys());
    },

    /**
     * Get registry statistics
     * @returns {Object} Stats object
     */
    getStats() {
      const stats = {
        total: decorations.size,
        categories: {}
      };

      for (const [cat, ids] of categories) {
        stats.categories[cat] = ids.size;
      }

      return stats;
    },

    /**
     * Clear all registered decorations
     */
    clear() {
      decorations.clear();
      categories.clear();
    },

    /**
     * Export all definitions (for debugging/serialization)
     * @returns {Object} All definitions keyed by id
     */
    exportAll() {
      const result = {};
      for (const [id, def] of decorations) {
        result[id] = def;
      }
      return result;
    }
  };

  // Expose globally
  global.DecorationRegistry = DecorationRegistry;

})(typeof window !== 'undefined' ? window : global);
