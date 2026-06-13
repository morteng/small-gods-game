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
import { greyToSpriteCanvas, rgbaToCanvas, type SpritePack } from '@/render/iso/sprite-canvas';
import { composeStructure, type StructureSpec, type StructureResult } from '@/assetgen/compose';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';

export interface ParametricSourceDeps {
  toSpec?: (rb: ResolvedBlueprint) => StructureSpec | null;
  compose?: (s: StructureSpec) => Promise<StructureResult>;
  toSprite?: (r: StructureResult) => SpritePack | null;
  /** Retain each asset's full StructureResult (every pipeline buffer) for debug
   *  inspection — the Render Studio reads them; the game leaves this off so the
   *  per-asset map buffers aren't held in memory worldwide. */
  keepStages?: boolean;
}

/** Crop the grey render + its co-registered normal/material maps to one pack. */
export function structureResultToPack(r: StructureResult): SpritePack | null {
  const albedo = greyToSpriteCanvas(r.grey, r.size, r.bbox);
  if (!albedo) return null;
  const pack: SpritePack = {
    albedo,
    normal: greyToSpriteCanvas(r.normal, r.size, r.bbox) ?? undefined,
    material: greyToSpriteCanvas(r.material, r.size, r.bbox) ?? undefined,
  };
  // Geometry-baked ground shadow. Offset is stored relative to the albedo crop's
  // BOTTOM-CENTRE (the sprite's foot/ground anchor) — NOT its top-left — so the
  // same shadow aligns under ANY co-footed sprite (parametric OR the img2img
  // building that shares the footprint anchor), letting a cached building borrow
  // this geometry shadow.
  if (r.shadow) {
    const canvas = rgbaToCanvas(r.shadow.data, r.shadow.w, r.shadow.h);
    if (canvas) {
      const footX = r.bbox.x + r.bbox.w / 2, footY = r.bbox.y + r.bbox.h;
      pack.shadow = { canvas, dx: r.shadow.ox - footX, dy: r.shadow.oy - footY };
    }
  }
  return pack;
}

function blueprintRbOf(e: Entity): ResolvedBlueprint | undefined {
  return blueprintOf(e)?.rb;
}

/** Stable key from the resolved blueprint (identical blueprints → one cached sprite). */
function keyOf(rb: ResolvedBlueprint): string { return JSON.stringify(rb); }

export class ParametricBuildingSource {
  private readonly cache = new Map<string, SpritePack | null>();
  private readonly stages = new Map<string, StructureResult>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly toSpec: NonNullable<ParametricSourceDeps['toSpec']>;
  private readonly compose: NonNullable<ParametricSourceDeps['compose']>;
  private readonly toSprite: NonNullable<ParametricSourceDeps['toSprite']>;
  private readonly keepStages: boolean;

  constructor(deps: ParametricSourceDeps = {}) {
    // Entities restored from an autosave carry an already-RESOLVED blueprint, so this
    // may be the first code path to compile one — register the part/feature types here
    // rather than relying on a preset-synthesis call having happened earlier.
    ensureBuildingTypesRegistered();
    this.toSpec = deps.toSpec ?? ((rb) => toGeometry(rb));
    this.compose = deps.compose ?? composeStructure;
    this.toSprite = deps.toSprite ?? structureResultToPack;
    this.keepStages = deps.keepStages ?? false;
  }

  /** Sync read of an already-generated sprite pack (null if absent / unsupported / failed). */
  peek(e: Entity): SpritePack | null {
    const rb = blueprintRbOf(e);
    return rb ? (this.cache.get(keyOf(rb)) ?? null) : null;
  }

  /** Sync read of an asset's retained pipeline buffers (only when `keepStages`). */
  stagesFor(e: Entity): StructureResult | null {
    const rb = blueprintRbOf(e);
    return rb ? (this.stages.get(keyOf(rb)) ?? null) : null;
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
      .then((r) => { if (this.keepStages) this.stages.set(k, r); this.cache.set(k, this.toSprite(r)); })
      .catch((err) => {
        if (!this.warned.has(k)) { console.warn('[parametric-building] generation failed', err); this.warned.add(k); }
        this.cache.set(k, null);
      })
      .finally(() => { this.inflight.delete(k); });
  }

  /** Clear on world reset. */
  clear(): void { this.cache.clear(); this.stages.clear(); this.inflight.clear(); this.warned.clear(); }
}
