/**
 * WorldManager - Handles loading, saving, and managing world seeds
 *
 * Provides:
 * - Load worlds from JSON files
 * - Save worlds to localStorage (browser) or download as JSON
 * - List available preset worlds
 * - Validation of world data
 */

const WorldManager = {
  // Default world file path
  DEFAULT_WORLD: '/data/worlds/default.json',

  // LocalStorage key prefix
  STORAGE_PREFIX: 'smallgods_world_',

  /**
   * Load a world from a JSON file
   * @param {string} path - Path to the world JSON file
   * @returns {Promise<Object>} The loaded world seed
   */
  async loadFromFile(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to load world: ${response.statusText}`);
      }
      const worldSeed = await response.json();

      // Validate the world seed
      const validation = this.validate(worldSeed);
      if (!validation.valid) {
        console.warn('World validation warnings:', validation.warnings);
      }

      return worldSeed;
    } catch (error) {
      console.error('Error loading world:', error);
      throw error;
    }
  },

  /**
   * Load the default world
   * @returns {Promise<Object>} The default world seed
   */
  async loadDefault() {
    return this.loadFromFile(this.DEFAULT_WORLD);
  },

  /**
   * Save world to localStorage
   * @param {string} name - Name for the saved world
   * @param {Object} worldSeed - The world seed to save
   */
  saveToStorage(name, worldSeed) {
    const key = this.STORAGE_PREFIX + this.sanitizeName(name);
    const saveData = {
      name,
      savedAt: new Date().toISOString(),
      worldSeed
    };
    localStorage.setItem(key, JSON.stringify(saveData));
    console.log(`World "${name}" saved to localStorage`);
    return key;
  },

  /**
   * Load world from localStorage
   * @param {string} name - Name of the saved world
   * @returns {Object|null} The loaded world seed or null if not found
   */
  loadFromStorage(name) {
    const key = this.STORAGE_PREFIX + this.sanitizeName(name);
    const data = localStorage.getItem(key);
    if (!data) {
      console.warn(`World "${name}" not found in localStorage`);
      return null;
    }
    try {
      const saveData = JSON.parse(data);
      return saveData.worldSeed;
    } catch (error) {
      console.error('Error parsing saved world:', error);
      return null;
    }
  },

  /**
   * List all saved worlds in localStorage
   * @returns {Array<Object>} List of saved worlds with metadata
   */
  listSavedWorlds() {
    const worlds = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(this.STORAGE_PREFIX)) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          worlds.push({
            key,
            name: data.name,
            savedAt: data.savedAt,
            worldName: data.worldSeed?.name || 'Unnamed'
          });
        } catch (e) {
          console.warn('Corrupted save data:', key);
        }
      }
    }
    return worlds.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  },

  /**
   * Delete a saved world from localStorage
   * @param {string} name - Name of the world to delete
   */
  deleteFromStorage(name) {
    const key = this.STORAGE_PREFIX + this.sanitizeName(name);
    localStorage.removeItem(key);
    console.log(`World "${name}" deleted from localStorage`);
  },

  /**
   * Download world as a JSON file
   * @param {Object} worldSeed - The world seed to download
   * @param {string} filename - Optional filename (defaults to world name)
   */
  downloadAsFile(worldSeed, filename) {
    const name = filename || worldSeed.name || 'world';
    const sanitizedName = this.sanitizeName(name);
    const json = JSON.stringify(worldSeed, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizedName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`World downloaded as ${sanitizedName}.json`);
  },

  /**
   * Load world from a file input
   * @param {File} file - The file to load
   * @returns {Promise<Object>} The loaded world seed
   */
  async loadFromFileInput(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const worldSeed = JSON.parse(e.target.result);
          const validation = this.validate(worldSeed);
          if (!validation.valid) {
            console.warn('World validation warnings:', validation.warnings);
          }
          resolve(worldSeed);
        } catch (error) {
          reject(new Error('Invalid JSON file'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  },

  /**
   * Validate a world seed
   * @param {Object} worldSeed - The world seed to validate
   * @returns {Object} Validation result with valid flag and warnings
   */
  validate(worldSeed) {
    const warnings = [];

    // Check required fields
    if (!worldSeed.name) {
      warnings.push('Missing world name');
    }
    if (!worldSeed.size || !worldSeed.size.width || !worldSeed.size.height) {
      warnings.push('Missing or invalid size');
    }
    if (!worldSeed.pois || !Array.isArray(worldSeed.pois)) {
      warnings.push('Missing or invalid POIs array');
    }

    // Validate POIs
    if (worldSeed.pois) {
      worldSeed.pois.forEach((poi, index) => {
        if (!poi.id) warnings.push(`POI ${index} missing id`);
        if (!poi.type) warnings.push(`POI ${index} missing type`);
        if (!poi.name) warnings.push(`POI ${index} missing name`);
      });
    }

    // Validate connections
    if (worldSeed.connections) {
      const poiIds = new Set((worldSeed.pois || []).map(p => p.id));
      worldSeed.connections.forEach((conn, index) => {
        if (!conn.from) warnings.push(`Connection ${index} missing 'from'`);
        if (!conn.to) warnings.push(`Connection ${index} missing 'to'`);
        if (conn.from && !poiIds.has(conn.from)) {
          warnings.push(`Connection ${index} references unknown POI '${conn.from}'`);
        }
        if (conn.to && !poiIds.has(conn.to)) {
          warnings.push(`Connection ${index} references unknown POI '${conn.to}'`);
        }
      });
    }

    return {
      valid: warnings.length === 0,
      warnings
    };
  },

  /**
   * Sanitize a name for use as filename/key
   * @param {string} name - The name to sanitize
   * @returns {string} Sanitized name
   */
  sanitizeName(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  },

  /**
   * Create a deep copy of a world seed
   * @param {Object} worldSeed - The world seed to copy
   * @returns {Object} A deep copy
   */
  clone(worldSeed) {
    return JSON.parse(JSON.stringify(worldSeed));
  },

  /**
   * Merge changes into an existing world seed
   * @param {Object} base - The base world seed
   * @param {Object} changes - Changes to merge
   * @returns {Object} Merged world seed
   */
  merge(base, changes) {
    const merged = this.clone(base);
    Object.assign(merged, changes);
    return merged;
  }
};

// Make available globally
window.WorldManager = WorldManager;
