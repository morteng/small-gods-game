/**
 * ChunkManager - Manages infinite map chunks for procedural generation
 *
 * Design:
 * - World is divided into fixed-size chunks (default 16x16 tiles)
 * - Chunks are generated on-demand using WFC
 * - Edge constraints from adjacent chunks ensure seamless boundaries
 * - LRU cache manages memory with configurable limit
 * - Supports deterministic generation via seeded RNG
 */

import { WFCEngine, TILES } from '@/wfc';
import type { Tile, TerrainOptions } from '@/core/types';

/** Data for a single chunk */
export interface ChunkData {
  cx: number;
  cy: number;
  key: string;
  tiles: Tile[][];
  width: number;
  height: number;
  seed: number;
  generated: number;
}

/** Edge constraints from neighboring chunks */
interface EdgeConstraints {
  north?: string[];
  south?: string[];
  west?: string[];
  east?: string[];
}

/** Region result from getRegion() */
export interface RegionData {
  tiles: Tile[][];
  width: number;
  height: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Cache statistics */
export interface ChunkStats {
  cachedChunks: number;
  maxChunks: number;
  chunkSize: number;
  worldSeed: number;
}

/** Options for ChunkManager constructor */
export interface ChunkManagerOptions {
  chunkSize?: number;
  worldSeed?: number;
  maxCachedChunks?: number;
  terrainOptions?: TerrainOptions;
  onChunkGenerated?: ((chunk: ChunkData) => void) | null;
  onChunkUnloaded?: ((chunk: ChunkData) => void) | null;
}

export class ChunkManager {
  chunkSize: number;
  worldSeed: number;
  maxCachedChunks: number;
  terrainOptions: TerrainOptions;

  /** In-memory cache: Map<"cx,cy", ChunkData> */
  cache: Map<string, ChunkData>;

  /** LRU tracking: most recent at end */
  lruOrder: string[];

  /** Set of chunks currently being generated (to prevent duplicate generation) */
  generating: Set<string>;

  /** Callbacks */
  onChunkGenerated: ((chunk: ChunkData) => void) | null;
  onChunkUnloaded: ((chunk: ChunkData) => void) | null;

  constructor(options: ChunkManagerOptions = {}) {
    this.chunkSize = options.chunkSize || 16;
    this.worldSeed = options.worldSeed || 12345;
    this.maxCachedChunks = options.maxCachedChunks || 64;
    this.terrainOptions = options.terrainOptions || {
      forestDensity: 0.5,
      waterLevel: 0.35,
      villageCount: 3,
    };

    this.cache = new Map();
    this.lruOrder = [];
    this.generating = new Set();

    this.onChunkGenerated = options.onChunkGenerated || null;
    this.onChunkUnloaded = options.onChunkUnloaded || null;
  }

  /** Get chunk key from chunk coordinates */
  getChunkKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  /** Parse chunk key back to coordinates */
  parseChunkKey(key: string): { cx: number; cy: number } {
    const [cx, cy] = key.split(',').map(Number);
    return { cx, cy };
  }

  /** Convert world tile coordinates to chunk coordinates */
  worldToChunk(x: number, y: number): { cx: number; cy: number } {
    return {
      cx: Math.floor(x / this.chunkSize),
      cy: Math.floor(y / this.chunkSize)
    };
  }

  /** Convert chunk coordinates to world tile coordinates (top-left of chunk) */
  chunkToWorld(cx: number, cy: number): { x: number; y: number } {
    return {
      x: cx * this.chunkSize,
      y: cy * this.chunkSize
    };
  }

  /** Get the local position within a chunk */
  worldToLocal(x: number, y: number): { lx: number; ly: number } {
    const cx = Math.floor(x / this.chunkSize);
    const cy = Math.floor(y / this.chunkSize);
    return {
      lx: x - cx * this.chunkSize,
      ly: y - cy * this.chunkSize
    };
  }

  /** Create deterministic seed for a chunk based on world seed and chunk position */
  getChunkSeed(cx: number, cy: number): number {
    // Use hash-like combination to get unique seed per chunk
    const a = this.worldSeed;
    const b = cx * 73856093;  // Large primes
    const c = cy * 19349663;
    return Math.abs((a ^ b ^ c) & 0x7FFFFFFF);
  }

  /** Get a chunk, generating it if needed */
  async getChunk(cx: number, cy: number): Promise<ChunkData | null> {
    const key = this.getChunkKey(cx, cy);

    // Check cache first
    if (this.cache.has(key)) {
      this.touchLRU(key);
      return this.cache.get(key)!;
    }

    // Check if already generating
    if (this.generating.has(key)) {
      return this.waitForChunk(cx, cy);
    }

    // Generate new chunk
    return this.generateChunk(cx, cy);
  }

  /** Wait for a chunk that's currently being generated */
  async waitForChunk(cx: number, cy: number): Promise<ChunkData | null> {
    const key = this.getChunkKey(cx, cy);

    return new Promise((resolve) => {
      const check = (): void => {
        if (this.cache.has(key)) {
          resolve(this.cache.get(key)!);
        } else if (!this.generating.has(key)) {
          // Generation failed, return null
          resolve(null);
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  /** Generate a new chunk using WFC */
  async generateChunk(cx: number, cy: number): Promise<ChunkData | null> {
    const key = this.getChunkKey(cx, cy);
    this.generating.add(key);

    try {
      // Get edge constraints from neighboring chunks
      const edgeConstraints = this.getEdgeConstraints(cx, cy);

      // Create chunk seed
      const chunkSeed = this.getChunkSeed(cx, cy);

      const engine = new WFCEngine(this.chunkSize, this.chunkSize, {
        seed: chunkSeed,
        maxBacktracks: 200,
        terrainOptions: this.terrainOptions,
        onProgress: () => {
          // Minimal progress callback
        }
      });

      // Apply edge constraints before generation
      if (edgeConstraints) {
        this.applyEdgeConstraints(engine, edgeConstraints);
      }

      // Generate terrain (no world seed for chunks - POIs are handled separately)
      const result = await engine.generate(null);

      // Create chunk data
      const chunk: ChunkData = {
        cx,
        cy,
        key,
        tiles: result.tiles,
        width: this.chunkSize,
        height: this.chunkSize,
        seed: chunkSeed,
        generated: Date.now()
      };

      // Cache the chunk
      this.cacheChunk(key, chunk);

      // Notify listener
      if (this.onChunkGenerated) {
        this.onChunkGenerated(chunk);
      }

      return chunk;
    } catch (error) {
      console.error(`Failed to generate chunk ${key}:`, error);
      return null;
    } finally {
      this.generating.delete(key);
    }
  }

  /**
   * Get edge constraints from neighboring chunks
   * Returns object with n/e/s/w arrays of tile types on edges
   */
  getEdgeConstraints(cx: number, cy: number): EdgeConstraints | null {
    const constraints: EdgeConstraints = {};
    const size = this.chunkSize;
    let hasConstraints = false;

    // North neighbor (cy - 1) -> get their south edge
    const northKey = this.getChunkKey(cx, cy - 1);
    if (this.cache.has(northKey)) {
      const north = this.cache.get(northKey)!;
      constraints.north = [];
      for (let x = 0; x < size; x++) {
        constraints.north.push(north.tiles[size - 1]?.[x]?.type || 'grass');
      }
      hasConstraints = true;
    }

    // South neighbor (cy + 1) -> get their north edge
    const southKey = this.getChunkKey(cx, cy + 1);
    if (this.cache.has(southKey)) {
      const south = this.cache.get(southKey)!;
      constraints.south = [];
      for (let x = 0; x < size; x++) {
        constraints.south.push(south.tiles[0]?.[x]?.type || 'grass');
      }
      hasConstraints = true;
    }

    // West neighbor (cx - 1) -> get their east edge
    const westKey = this.getChunkKey(cx - 1, cy);
    if (this.cache.has(westKey)) {
      const west = this.cache.get(westKey)!;
      constraints.west = [];
      for (let y = 0; y < size; y++) {
        constraints.west.push(west.tiles[y]?.[size - 1]?.type || 'grass');
      }
      hasConstraints = true;
    }

    // East neighbor (cx + 1) -> get their west edge
    const eastKey = this.getChunkKey(cx + 1, cy);
    if (this.cache.has(eastKey)) {
      const east = this.cache.get(eastKey)!;
      constraints.east = [];
      for (let y = 0; y < size; y++) {
        constraints.east.push(east.tiles[y]?.[0]?.type || 'grass');
      }
      hasConstraints = true;
    }

    return hasConstraints ? constraints : null;
  }

  /**
   * Apply edge constraints to WFC engine before generation
   * Seeds edge cells to match neighboring chunks
   */
  applyEdgeConstraints(engine: WFCEngine, constraints: EdgeConstraints): void {
    const size = this.chunkSize;

    // Seed north edge (y = 0)
    if (constraints.north) {
      for (let x = 0; x < size; x++) {
        const baseType = this.getBaseType(constraints.north[x]);
        if (baseType) {
          engine.seedCell(x, 0, baseType);
        }
      }
    }

    // Seed south edge (y = size - 1)
    if (constraints.south) {
      for (let x = 0; x < size; x++) {
        const baseType = this.getBaseType(constraints.south[x]);
        if (baseType) {
          engine.seedCell(x, size - 1, baseType);
        }
      }
    }

    // Seed west edge (x = 0)
    if (constraints.west) {
      for (let y = 0; y < size; y++) {
        const baseType = this.getBaseType(constraints.west[y]);
        if (baseType) {
          engine.seedCell(0, y, baseType);
        }
      }
    }

    // Seed east edge (x = size - 1)
    if (constraints.east) {
      for (let y = 0; y < size; y++) {
        const baseType = this.getBaseType(constraints.east[y]);
        if (baseType) {
          engine.seedCell(size - 1, y, baseType);
        }
      }
    }
  }

  /**
   * Get base terrain type from a visual variant
   * e.g., "shore_n" -> "grass", "road_ns" -> "road"
   */
  getBaseType(tileType: string | undefined): string | null {
    if (!tileType) return null;

    // Check if it's a base type
    const baseTiles = ['grass', 'water', 'road', 'river', 'dirt', 'forest', 'hill', 'beach', 'lot'];
    if (baseTiles.includes(tileType)) {
      return tileType;
    }

    // Get base type from WFC tiles
    const tileDef = TILES[tileType];
    if (tileDef?.baseType) {
      return tileDef.baseType;
    }

    // Extract from variant name (e.g., "shore_n" -> shore -> grass)
    const prefix = tileType.split('_')[0];
    const prefixMap: Record<string, string> = {
      shore: 'grass',
      bridge: 'road',
      exit: 'road'
    };

    return prefixMap[prefix] || prefix || 'grass';
  }

  /** Cache a chunk and manage LRU */
  cacheChunk(key: string, chunk: ChunkData): void {
    this.cache.set(key, chunk);
    this.touchLRU(key);
    this.evictIfNeeded();
  }

  /** Update LRU order - move key to end (most recent) */
  touchLRU(key: string): void {
    const index = this.lruOrder.indexOf(key);
    if (index !== -1) {
      this.lruOrder.splice(index, 1);
    }
    this.lruOrder.push(key);
  }

  /** Evict oldest chunks if over limit */
  evictIfNeeded(): void {
    while (this.cache.size > this.maxCachedChunks && this.lruOrder.length > 0) {
      const oldestKey = this.lruOrder.shift()!;
      const chunk = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);

      if (this.onChunkUnloaded && chunk) {
        this.onChunkUnloaded(chunk);
      }
    }
  }

  /** Get a tile at world coordinates */
  async getTile(x: number, y: number): Promise<Tile | null> {
    const { cx, cy } = this.worldToChunk(x, y);
    const chunk = await this.getChunk(cx, cy);
    if (!chunk) return null;

    const { lx, ly } = this.worldToLocal(x, y);
    return chunk.tiles[ly]?.[lx] || null;
  }

  /**
   * Get tiles for a viewport region
   * Returns a map-like object with tiles array
   */
  async getRegion(x1: number, y1: number, x2: number, y2: number): Promise<RegionData> {
    // Determine which chunks we need
    const chunk1 = this.worldToChunk(x1, y1);
    const chunk2 = this.worldToChunk(x2, y2);

    // Load all needed chunks in parallel
    const chunkPromises: Promise<ChunkData | null>[] = [];
    for (let cy = chunk1.cy; cy <= chunk2.cy; cy++) {
      for (let cx = chunk1.cx; cx <= chunk2.cx; cx++) {
        chunkPromises.push(this.getChunk(cx, cy));
      }
    }

    await Promise.all(chunkPromises);

    // Build result tiles array
    const width = x2 - x1 + 1;
    const height = y2 - y1 + 1;
    const tiles: Tile[][] = [];

    for (let y = y1; y <= y2; y++) {
      const row: Tile[] = [];
      for (let x = x1; x <= x2; x++) {
        const { cx, cy } = this.worldToChunk(x, y);
        const chunk = this.cache.get(this.getChunkKey(cx, cy));

        if (chunk) {
          const { lx, ly } = this.worldToLocal(x, y);
          row.push(chunk.tiles[ly]?.[lx] || { type: 'grass', x, y, walkable: true });
        } else {
          row.push({ type: 'grass', x, y, walkable: true });
        }
      }
      tiles.push(row);
    }

    return {
      tiles,
      width,
      height,
      x1, y1, x2, y2
    };
  }

  /** Preload chunks around a center point */
  async preloadArea(centerX: number, centerY: number, radius = 2): Promise<void> {
    const { cx, cy } = this.worldToChunk(centerX, centerY);
    const promises: Promise<ChunkData | null>[] = [];

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        promises.push(this.getChunk(cx + dx, cy + dy));
      }
    }

    await Promise.all(promises);
  }

  /** Clear the cache */
  clearCache(): void {
    this.cache.clear();
    this.lruOrder = [];
  }

  /** Get cache statistics */
  getStats(): ChunkStats {
    return {
      cachedChunks: this.cache.size,
      maxChunks: this.maxCachedChunks,
      chunkSize: this.chunkSize,
      worldSeed: this.worldSeed
    };
  }

  /** Check if a chunk is loaded */
  isChunkLoaded(cx: number, cy: number): boolean {
    return this.cache.has(this.getChunkKey(cx, cy));
  }

  /** Get all loaded chunk keys */
  getLoadedChunks(): string[] {
    return Array.from(this.cache.keys());
  }
}
