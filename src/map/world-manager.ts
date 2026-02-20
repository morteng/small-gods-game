/**
 * WorldManager - Handles loading, saving, and managing world seeds
 *
 * Provides:
 * - Load worlds from JSON files
 * - Save worlds to localStorage (browser) or download as JSON
 * - List available preset worlds
 * - Validation of world data
 */

import type { WorldSeed } from '@/core/types';

/** Saved world metadata from localStorage */
export interface SavedWorldEntry {
  key: string;
  name: string;
  savedAt: string;
  worldName: string;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

/** Data stored in localStorage */
interface SaveData {
  name: string;
  savedAt: string;
  worldSeed: WorldSeed;
}

export const WorldManager = {
  // Default world file path
  DEFAULT_WORLD: '/data/worlds/default.json' as string,

  // LocalStorage key prefix
  STORAGE_PREFIX: 'smallgods_world_' as string,

  /**
   * Load a world from a JSON file
   */
  async loadFromFile(path: string): Promise<WorldSeed> {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to load world: ${response.statusText}`);
      }
      const worldSeed: WorldSeed = await response.json();

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
   */
  async loadDefault(): Promise<WorldSeed> {
    return this.loadFromFile(this.DEFAULT_WORLD);
  },

  /**
   * Save world to localStorage
   */
  saveToStorage(name: string, worldSeed: WorldSeed): string {
    const key = this.STORAGE_PREFIX + this.sanitizeName(name);
    const saveData: SaveData = {
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
   */
  loadFromStorage(name: string): WorldSeed | null {
    const key = this.STORAGE_PREFIX + this.sanitizeName(name);
    const data = localStorage.getItem(key);
    if (!data) {
      console.warn(`World "${name}" not found in localStorage`);
      return null;
    }
    try {
      const saveData: SaveData = JSON.parse(data);
      return saveData.worldSeed;
    } catch (error) {
      console.error('Error parsing saved world:', error);
      return null;
    }
  },

  /**
   * List all saved worlds in localStorage
   */
  listSavedWorlds(): SavedWorldEntry[] {
    const worlds: SavedWorldEntry[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.STORAGE_PREFIX)) {
        try {
          const data: SaveData = JSON.parse(localStorage.getItem(key)!);
          worlds.push({
            key,
            name: data.name,
            savedAt: data.savedAt,
            worldName: data.worldSeed?.name || 'Unnamed'
          });
        } catch (_e) {
          console.warn('Corrupted save data:', key);
        }
      }
    }
    return worlds.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  },

  /**
   * Delete a saved world from localStorage
   */
  deleteFromStorage(name: string): void {
    const key = this.STORAGE_PREFIX + this.sanitizeName(name);
    localStorage.removeItem(key);
    console.log(`World "${name}" deleted from localStorage`);
  },

  /**
   * Download world as a JSON file (uses DOM - browser context only)
   */
  downloadAsFile(worldSeed: WorldSeed, filename?: string): void {
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
   */
  async loadFromFileInput(file: File): Promise<WorldSeed> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        try {
          const worldSeed: WorldSeed = JSON.parse(e.target!.result as string);
          const validation = this.validate(worldSeed);
          if (!validation.valid) {
            console.warn('World validation warnings:', validation.warnings);
          }
          resolve(worldSeed);
        } catch (_error) {
          reject(new Error('Invalid JSON file'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  },

  /**
   * Validate a world seed
   */
  validate(worldSeed: WorldSeed): ValidationResult {
    const warnings: string[] = [];

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
   */
  sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  },

  /**
   * Create a deep copy of a world seed
   */
  clone(worldSeed: WorldSeed): WorldSeed {
    return JSON.parse(JSON.stringify(worldSeed));
  },

  /**
   * Merge changes into an existing world seed
   */
  merge(base: WorldSeed, changes: Partial<WorldSeed>): WorldSeed {
    const merged = this.clone(base);
    Object.assign(merged, changes);
    return merged;
  }
};
