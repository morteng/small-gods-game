// src/render/parametric-building-source.ts
// Runtime, memoized source of manifold-generated building sprites. Mirrors
// ArtResolver's peek/warm contract: peek() is the sync frame-path read; warm() kicks
// async generation off the frame path. Cache key = blueprint identity, so identical
// buildings share one sprite. Any failure / unsupported plan caches null → caller
// falls back to the legacy massing. Never throws on the frame path.
import type { Entity } from '@/core/types';
import { blueprintOf } from '@/blueprint/entity';
import type { ResolvedBlueprint } from '@/blueprint/types';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { greyToSpriteCanvas, type SpriteCanvas } from '@/render/iso/sprite-canvas';
import { composeStructure, type StructureSpec, type StructureResult } from '@/assetgen/compose';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';

export interface ParametricSourceDeps {
  toSpec?: (rb: ResolvedBlueprint) => StructureSpec | null;
  compose?: (s: StructureSpec) => Promise<StructureResult>;
  toSprite?: (r: StructureResult) => SpriteCanvas | null;
}

function blueprintRbOf(e: Entity): ResolvedBlueprint | undefined {
  return blueprintOf(e)?.rb;
}

/** Stable key from the resolved blueprint (identical blueprints → one cached sprite). */
function keyOf(rb: ResolvedBlueprint): string { return JSON.stringify(rb); }

export class ParametricBuildingSource {
  private readonly cache = new Map<string, SpriteCanvas | null>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly toSpec: NonNullable<ParametricSourceDeps['toSpec']>;
  private readonly compose: NonNullable<ParametricSourceDeps['compose']>;
  private readonly toSprite: NonNullable<ParametricSourceDeps['toSprite']>;

  constructor(deps: ParametricSourceDeps = {}) {
    // Entities restored from an autosave carry an already-RESOLVED blueprint, so this
    // may be the first code path to compile one — register the part/feature types here
    // rather than relying on a preset-synthesis call having happened earlier.
    ensureBuildingTypesRegistered();
    this.toSpec = deps.toSpec ?? ((rb) => toGeometry(rb));
    this.compose = deps.compose ?? composeStructure;
    this.toSprite = deps.toSprite ?? ((r) => greyToSpriteCanvas(r.grey, r.size, r.bbox));
  }

  /** Sync read of an already-generated sprite (null if absent / unsupported / failed). */
  peek(e: Entity): SpriteCanvas | null {
    const rb = blueprintRbOf(e);
    return rb ? (this.cache.get(keyOf(rb)) ?? null) : null;
  }

  /** Fire-and-forget generation. Safe to call every frame; runs at most once per key. */
  warm(e: Entity): void {
    const rb = blueprintRbOf(e);
    if (!rb) return;
    const k = keyOf(rb);
    if (this.cache.has(k) || this.inflight.has(k)) return;
    let spec: StructureSpec | null;
    try {
      spec = this.toSpec(rb);
    } catch (err) {
      // Uphold the never-throws contract: a bad blueprint must not kill the frame loop.
      if (!this.warned.has(k)) { console.warn('[parametric-building] spec failed', err); this.warned.add(k); }
      this.cache.set(k, null);
      return;
    }
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
