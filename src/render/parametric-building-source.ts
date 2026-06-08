// src/render/parametric-building-source.ts
// Runtime, memoized source of manifold-generated building sprites. Mirrors
// ArtResolver's peek/warm contract: peek() is the sync frame-path read; warm() kicks
// async generation off the frame path. Cache key = descriptor identity, so identical
// buildings share one sprite. Any failure / unsupported plan caches null → caller
// falls back to the legacy massing. Never throws on the frame path.
import type { Entity } from '@/core/types';
import type { BuildingDescriptor } from '@/world/building-descriptor';
import { descriptorToSpec } from '@/render/iso/building-spec';
import { greyToSpriteCanvas, type SpriteCanvas } from '@/render/iso/sprite-canvas';
import { composeStructure, type StructureSpec, type StructureResult } from '@/assetgen/compose';

export interface ParametricSourceDeps {
  toSpec?: (d: BuildingDescriptor) => StructureSpec | null;
  compose?: (s: StructureSpec) => Promise<StructureResult>;
  toSprite?: (r: StructureResult) => SpriteCanvas | null;
}

function descriptorOf(e: Entity): BuildingDescriptor | undefined {
  return e.properties?.descriptor as BuildingDescriptor | undefined;
}

/** Stable key from the descriptor (identical descriptors → one cached sprite). */
function keyOf(d: BuildingDescriptor): string { return JSON.stringify(d); }

export class ParametricBuildingSource {
  private readonly cache = new Map<string, SpriteCanvas | null>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly toSpec: NonNullable<ParametricSourceDeps['toSpec']>;
  private readonly compose: NonNullable<ParametricSourceDeps['compose']>;
  private readonly toSprite: NonNullable<ParametricSourceDeps['toSprite']>;

  constructor(deps: ParametricSourceDeps = {}) {
    this.toSpec = deps.toSpec ?? descriptorToSpec;
    this.compose = deps.compose ?? composeStructure;
    this.toSprite = deps.toSprite ?? ((r) => greyToSpriteCanvas(r.grey, r.size, r.bbox));
  }

  /** Sync read of an already-generated sprite (null if absent / unsupported / failed). */
  peek(e: Entity): SpriteCanvas | null {
    const d = descriptorOf(e);
    return d ? (this.cache.get(keyOf(d)) ?? null) : null;
  }

  /** Fire-and-forget generation. Safe to call every frame; runs at most once per key. */
  warm(e: Entity): void {
    const d = descriptorOf(e);
    if (!d) return;
    const k = keyOf(d);
    if (this.cache.has(k) || this.inflight.has(k)) return;
    const spec = this.toSpec(d);
    if (!spec) { this.cache.set(k, null); return; }
    this.inflight.add(k);
    this.compose(spec)
      .then((r) => { this.cache.set(k, this.toSprite(r)); })
      .catch((err) => {
        if (!this.warned.has(k)) { console.warn('[parametric-building] generation failed', err); this.warned.add(k); }
        this.cache.set(k, null);
      })
      .finally(() => { this.inflight.delete(k); });
  }

  /** Clear on world reset. */
  clear(): void { this.cache.clear(); this.inflight.clear(); this.warned.clear(); }
}
