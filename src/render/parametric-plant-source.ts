// src/render/parametric-plant-source.ts
// Runtime, memoized source of manifold-generated TREE sprites — the kind-keyed
// twin of ParametricBuildingSource. Trees are MANY (a forest = thousands), so
// unlike buildings they do NOT carry a per-entity blueprint; instead this caches
// ONE SpritePack per species (kind), synthesising the preset on first warm().
// peek() is the sync frame read; warm() kicks async generation off the frame
// path. Any failure / non-plant kind caches null → caller falls back to the
// flat billboard. Never throws on the frame path.
import type { ResolvedBlueprint } from '@/blueprint/types';
import { synthesizeBlueprint, isPlantPreset } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { type SpritePack } from '@/render/iso/sprite-canvas';
import { composeStructure, type StructureSpec, type StructureResult } from '@/assetgen/compose';
import { structureResultToPack } from '@/render/parametric-building-source';

export interface ParametricPlantDeps {
  toSpec?: (rb: ResolvedBlueprint) => StructureSpec | null;
  compose?: (s: StructureSpec) => Promise<StructureResult>;
  toSprite?: (r: StructureResult) => SpritePack | null;
  /** Retain each species' full StructureResult for debug inspection (Render
   *  Studio); off in-game so per-species map buffers aren't held worldwide. */
  keepStages?: boolean;
}

export class ParametricPlantSource {
  private readonly cache = new Map<string, SpritePack | null>();
  private readonly stages = new Map<string, StructureResult>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly toSpec: NonNullable<ParametricPlantDeps['toSpec']>;
  private readonly compose: NonNullable<ParametricPlantDeps['compose']>;
  private readonly toSprite: NonNullable<ParametricPlantDeps['toSprite']>;
  private readonly keepStages: boolean;

  constructor(deps: ParametricPlantDeps = {}) {
    this.toSpec = deps.toSpec ?? ((rb) => toGeometry(rb));
    this.compose = deps.compose ?? composeStructure;
    this.toSprite = deps.toSprite ?? structureResultToPack;
    this.keepStages = deps.keepStages ?? false;
  }

  /** Sync read of an already-generated sprite pack for a species kind (null if absent). */
  peek(kind: string): SpritePack | null {
    return this.cache.get(kind) ?? null;
  }

  /** Sync read of a species' retained pipeline buffers (only when `keepStages`). */
  stagesFor(kind: string): StructureResult | null {
    return this.stages.get(kind) ?? null;
  }

  /** Fire-and-forget generation for a species kind. Safe every frame; runs once per kind. */
  warm(kind: string): void {
    if (this.cache.has(kind) || this.inflight.has(kind)) return;
    if (!isPlantPreset(kind)) { this.cache.set(kind, null); return; }
    const rb = synthesizeBlueprint(kind);
    if (!rb) { this.cache.set(kind, null); return; }
    let spec: StructureSpec | null;
    try {
      spec = this.toSpec(rb);
    } catch (err) {
      if (!this.warned.has(kind)) { console.warn('[parametric-plant] spec failed', err); this.warned.add(kind); }
      this.cache.set(kind, null);
      return;
    }
    if (!spec) { this.cache.set(kind, null); return; }
    this.inflight.add(kind);
    this.compose(spec)
      .then((r) => { if (this.keepStages) this.stages.set(kind, r); this.cache.set(kind, this.toSprite(r)); })
      .catch((err) => {
        if (!this.warned.has(kind)) { console.warn('[parametric-plant] generation failed', err); this.warned.add(kind); }
        this.cache.set(kind, null);
      })
      .finally(() => { this.inflight.delete(kind); });
  }

  /** Clear on world reset. */
  clear(): void { this.cache.clear(); this.stages.clear(); this.inflight.clear(); this.warned.clear(); }
}
