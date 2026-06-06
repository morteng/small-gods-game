import { getAssetBlob } from '@/services/pixellab';

export type BlobResolver = (id: string) => Promise<Blob | null>;

/**
 * Holds `HTMLImageElement`s for asset ids, loaded lazily via an injected blob
 * resolver (base-library file OR IndexedDB). One instance per Game.
 *
 * `get(id)` returns null until the image is fully loaded so the renderer can
 * fall back to a placeholder during the first frame.
 */
export class ArtImageCache {
  private images = new Map<string, HTMLImageElement>();
  private urls = new Map<string, string>();
  private inFlight = new Set<string>();

  constructor(private readonly resolveBlob: BlobResolver = getAssetBlob) {}

  /** Synchronous accessor for the render loop. Returns null while loading. */
  get(id: string): HTMLImageElement | null {
    const img = this.images.get(id);
    if (img && img.complete && img.naturalWidth > 0) return img;
    if (!this.images.has(id) && !this.inFlight.has(id)) void this.load(id);
    return null;
  }

  /** Kick off (or await an existing) load. Resolves to the image, or null
   *  if the asset id is unknown to the resolver. */
  async load(id: string): Promise<HTMLImageElement | null> {
    const existing = this.images.get(id);
    if (existing) return existing;
    if (this.inFlight.has(id)) return null;
    this.inFlight.add(id);
    try {
      const blob = await this.resolveBlob(id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      this.images.set(id, img);
      this.urls.set(id, url);
      return img;
    } finally {
      this.inFlight.delete(id);
    }
  }

  /** Preload many ids in parallel; resolves when all settle. */
  async preload(ids: Iterable<string>): Promise<void> {
    await Promise.all(Array.from(ids, id => this.load(id)));
  }

  /** Revoke all object URLs and drop references. Called on Game.destroy. */
  destroy(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.images.clear();
    this.inFlight.clear();
  }
}

/** Back-compat alias — existing imports keep working until callers migrate. */
export { ArtImageCache as DecorationImageCache };
