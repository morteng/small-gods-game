import type { AssetStyle, Entity } from '@/core/types';
import type { AssetLibrary } from '@/services/asset-library';

/** FNV-1a hash → non-negative int. Mirrors AssetLibrary's tie-break hash. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Binds world entities to library art for rendering. Render-only: it reads the
 * entity and returns an assetId (or null) without ever writing back, so the sim
 * and replay are untouched. Deterministic + memoized per entity id.
 */
export class ArtResolver {
  private readonly cache = new Map<string, string | null>();

  constructor(private readonly lib: AssetLibrary, private readonly style: AssetStyle) {}

  /** Returns an assetId for the entity, or null if the library has no match. */
  async resolve(e: Entity): Promise<string | null> {
    const cached = this.cache.get(e.id);
    if (cached !== undefined) return cached;
    const picked = await this.lib.pick({
      kind: 'decoration',
      style: this.style,
      tagsAny: [e.kind],
      seed: hashStr(e.id),
    });
    // Only bind on a genuine match. matchesAsset hard-filters on kind+style
    // only, so pick() returns the top candidate even when nothing relates to
    // this entity kind (score 0). Binding a score-0 asset would skin e.g. an
    // oak_tree as wildflowers — keep the procedural/vendored fallback instead.
    const id = picked && picked.score > 0 ? picked.id : null;
    this.cache.set(e.id, id);
    return id;
  }

  /** Synchronous read of an already-resolved id (null if not resolved or miss). */
  peek(e: Entity): string | null {
    return this.cache.get(e.id) ?? null;
  }

  /** Kick resolution without awaiting (fire-and-forget for the render loop). */
  warm(e: Entity): void { void this.resolve(e); }

  /** Clear on world reset. */
  clear(): void { this.cache.clear(); }
}
