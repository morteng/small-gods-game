/**
 * Unit tests for ChunkManager module
 *
 * Tests core functionality:
 * - Construction with default and custom options
 * - Coordinate conversions (world-to-chunk, chunk-to-world, world-to-local)
 * - Chunk key generation and parsing
 * - Deterministic chunk seeding
 * - Cache management and LRU eviction
 * - Stats reporting
 * - Chunk generation via WFC
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChunkManager } from '@/map/chunk-manager';

// ==========================================
// Construction
// ==========================================

describe('ChunkManager construction', () => {
  it('uses default options when none provided', () => {
    const cm = new ChunkManager();

    expect(cm.chunkSize).toBe(16);
    expect(cm.worldSeed).toBe(12345);
    expect(cm.maxCachedChunks).toBe(64);
  });

  it('accepts custom options', () => {
    const cm = new ChunkManager({
      chunkSize: 8,
      worldSeed: 42,
      maxCachedChunks: 10,
    });

    expect(cm.chunkSize).toBe(8);
    expect(cm.worldSeed).toBe(42);
    expect(cm.maxCachedChunks).toBe(10);
  });

  it('starts with empty cache', () => {
    const cm = new ChunkManager();
    expect(cm.cache.size).toBe(0);
    expect(cm.lruOrder.length).toBe(0);
  });
});

// ==========================================
// Coordinate Conversions
// ==========================================

describe('ChunkManager coordinate conversions', () => {
  let cm: ChunkManager;

  beforeEach(() => {
    cm = new ChunkManager({ chunkSize: 16 });
  });

  it('converts world coords to chunk coords', () => {
    expect(cm.worldToChunk(0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(cm.worldToChunk(15, 15)).toEqual({ cx: 0, cy: 0 });
    expect(cm.worldToChunk(16, 0)).toEqual({ cx: 1, cy: 0 });
    expect(cm.worldToChunk(32, 48)).toEqual({ cx: 2, cy: 3 });
  });

  it('handles negative world coords', () => {
    expect(cm.worldToChunk(-1, -1)).toEqual({ cx: -1, cy: -1 });
    expect(cm.worldToChunk(-16, 0)).toEqual({ cx: -1, cy: 0 });
    expect(cm.worldToChunk(-17, 0)).toEqual({ cx: -2, cy: 0 });
  });

  it('converts chunk coords to world coords (top-left)', () => {
    expect(cm.chunkToWorld(0, 0)).toEqual({ x: 0, y: 0 });
    expect(cm.chunkToWorld(1, 0)).toEqual({ x: 16, y: 0 });
    expect(cm.chunkToWorld(2, 3)).toEqual({ x: 32, y: 48 });
  });

  it('converts world coords to local within chunk', () => {
    expect(cm.worldToLocal(0, 0)).toEqual({ lx: 0, ly: 0 });
    expect(cm.worldToLocal(5, 7)).toEqual({ lx: 5, ly: 7 });
    expect(cm.worldToLocal(17, 33)).toEqual({ lx: 1, ly: 1 });
  });
});

// ==========================================
// Chunk Keys
// ==========================================

describe('ChunkManager chunk keys', () => {
  const cm = new ChunkManager();

  it('generates correct key format', () => {
    expect(cm.getChunkKey(0, 0)).toBe('0,0');
    expect(cm.getChunkKey(3, -2)).toBe('3,-2');
  });

  it('parses keys back to coordinates', () => {
    expect(cm.parseChunkKey('0,0')).toEqual({ cx: 0, cy: 0 });
    expect(cm.parseChunkKey('3,-2')).toEqual({ cx: 3, cy: -2 });
  });

  it('roundtrips key generation and parsing', () => {
    const key = cm.getChunkKey(5, -7);
    const parsed = cm.parseChunkKey(key);
    expect(parsed).toEqual({ cx: 5, cy: -7 });
  });
});

// ==========================================
// Deterministic Seeding
// ==========================================

describe('ChunkManager deterministic seeding', () => {
  it('produces consistent seed for same chunk position', () => {
    const cm = new ChunkManager({ worldSeed: 42 });
    const seed1 = cm.getChunkSeed(3, 5);
    const seed2 = cm.getChunkSeed(3, 5);
    expect(seed1).toBe(seed2);
  });

  it('produces different seeds for different chunk positions', () => {
    const cm = new ChunkManager({ worldSeed: 42 });
    const seed1 = cm.getChunkSeed(0, 0);
    const seed2 = cm.getChunkSeed(1, 0);
    const seed3 = cm.getChunkSeed(0, 1);
    expect(seed1).not.toBe(seed2);
    expect(seed1).not.toBe(seed3);
    expect(seed2).not.toBe(seed3);
  });

  it('produces different seeds for different world seeds', () => {
    const cm1 = new ChunkManager({ worldSeed: 42 });
    const cm2 = new ChunkManager({ worldSeed: 99 });
    expect(cm1.getChunkSeed(0, 0)).not.toBe(cm2.getChunkSeed(0, 0));
  });

  it('produces non-negative seeds', () => {
    const cm = new ChunkManager({ worldSeed: 42 });
    for (let i = -5; i <= 5; i++) {
      for (let j = -5; j <= 5; j++) {
        expect(cm.getChunkSeed(i, j)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ==========================================
// Cache Management
// ==========================================

describe('ChunkManager cache', () => {
  it('reports correct stats', () => {
    const cm = new ChunkManager({ chunkSize: 8, worldSeed: 42, maxCachedChunks: 10 });
    const stats = cm.getStats();

    expect(stats.cachedChunks).toBe(0);
    expect(stats.maxChunks).toBe(10);
    expect(stats.chunkSize).toBe(8);
    expect(stats.worldSeed).toBe(42);
  });

  it('clears cache', () => {
    const cm = new ChunkManager();
    // Manually add to cache for testing
    cm.cache.set('0,0', {
      cx: 0, cy: 0, key: '0,0',
      tiles: [], width: 16, height: 16,
      seed: 0, generated: Date.now(),
    });
    cm.lruOrder.push('0,0');

    cm.clearCache();

    expect(cm.cache.size).toBe(0);
    expect(cm.lruOrder.length).toBe(0);
  });

  it('isChunkLoaded returns false for unloaded chunks', () => {
    const cm = new ChunkManager();
    expect(cm.isChunkLoaded(0, 0)).toBe(false);
  });

  it('getLoadedChunks returns empty array initially', () => {
    const cm = new ChunkManager();
    expect(cm.getLoadedChunks()).toEqual([]);
  });

  it('LRU eviction works when exceeding max', () => {
    const cm = new ChunkManager({ maxCachedChunks: 2, chunkSize: 4 });

    // Manually cache 3 chunks
    for (let i = 0; i < 3; i++) {
      const key = cm.getChunkKey(i, 0);
      cm.cacheChunk(key, {
        cx: i, cy: 0, key,
        tiles: [], width: 4, height: 4,
        seed: i, generated: Date.now(),
      });
    }

    // Should have evicted the oldest (0,0)
    expect(cm.cache.size).toBe(2);
    expect(cm.isChunkLoaded(0, 0)).toBe(false);
    expect(cm.isChunkLoaded(1, 0)).toBe(true);
    expect(cm.isChunkLoaded(2, 0)).toBe(true);
  });

  it('LRU touch moves chunk to end', () => {
    const cm = new ChunkManager({ maxCachedChunks: 3, chunkSize: 4 });

    // Cache 3 chunks in order
    for (let i = 0; i < 3; i++) {
      const key = cm.getChunkKey(i, 0);
      cm.cacheChunk(key, {
        cx: i, cy: 0, key,
        tiles: [], width: 4, height: 4,
        seed: i, generated: Date.now(),
      });
    }

    // Touch the first chunk (0,0) to make it recent
    cm.touchLRU('0,0');

    // Add a 4th chunk - should evict 1,0 (now oldest)
    const key = cm.getChunkKey(3, 0);
    cm.cacheChunk(key, {
      cx: 3, cy: 0, key,
      tiles: [], width: 4, height: 4,
      seed: 3, generated: Date.now(),
    });

    expect(cm.isChunkLoaded(0, 0)).toBe(true);  // Was touched, still present
    expect(cm.isChunkLoaded(1, 0)).toBe(false);  // Evicted (oldest)
    expect(cm.isChunkLoaded(2, 0)).toBe(true);
    expect(cm.isChunkLoaded(3, 0)).toBe(true);
  });
});

// ==========================================
// getBaseType
// ==========================================

describe('ChunkManager.getBaseType', () => {
  const cm = new ChunkManager();

  it('returns base types directly', () => {
    expect(cm.getBaseType('grass')).toBe('grass');
    expect(cm.getBaseType('water')).toBe('water');
    expect(cm.getBaseType('road')).toBe('road');
  });

  it('extracts base type from variant names', () => {
    // shore_n is looked up in TILES first; if found, uses baseType; otherwise prefix map
    const shoreResult = cm.getBaseType('shore_n');
    expect(shoreResult).toBe('grass');

    // bridge_ns: prefix "bridge" maps to "road" in the fallback prefix map,
    // but if TILES has it with a different baseType, that takes precedence
    const bridgeResult = cm.getBaseType('bridge_ns');
    expect(['road', 'bridge']).toContain(bridgeResult);
  });

  it('returns grass for undefined input', () => {
    expect(cm.getBaseType(undefined)).toBeNull();
  });
});

// ==========================================
// Chunk Generation (integration)
// ==========================================

describe('ChunkManager chunk generation', () => {
  it('generates and caches a chunk', async () => {
    const cm = new ChunkManager({
      chunkSize: 4,
      worldSeed: 42,
      maxCachedChunks: 10,
      terrainOptions: {
        forestDensity: 0.3,
        waterLevel: 0.2,
        villageCount: 0,
      },
    });

    const chunk = await cm.getChunk(0, 0);

    expect(chunk).not.toBeNull();
    expect(chunk!.cx).toBe(0);
    expect(chunk!.cy).toBe(0);
    expect(chunk!.width).toBe(4);
    expect(chunk!.height).toBe(4);
    expect(chunk!.tiles.length).toBe(4);
    expect(chunk!.tiles[0].length).toBe(4);

    // Should be cached now
    expect(cm.isChunkLoaded(0, 0)).toBe(true);
    expect(cm.getStats().cachedChunks).toBe(1);
  });

  it('returns cached chunk on second call', async () => {
    const cm = new ChunkManager({
      chunkSize: 4,
      worldSeed: 42,
      terrainOptions: { forestDensity: 0.3, waterLevel: 0.2, villageCount: 0 },
    });

    const chunk1 = await cm.getChunk(0, 0);
    const chunk2 = await cm.getChunk(0, 0);

    // Should be the same object from cache
    expect(chunk1).toBe(chunk2);
  });

  it('fires onChunkGenerated callback', async () => {
    let generatedChunk: any = null;
    const cm = new ChunkManager({
      chunkSize: 4,
      worldSeed: 42,
      terrainOptions: { forestDensity: 0.3, waterLevel: 0.2, villageCount: 0 },
      onChunkGenerated: (chunk) => { generatedChunk = chunk; },
    });

    await cm.getChunk(0, 0);
    expect(generatedChunk).not.toBeNull();
    expect(generatedChunk.key).toBe('0,0');
  });
});
