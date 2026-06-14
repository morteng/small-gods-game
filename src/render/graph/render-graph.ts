// src/render/graph/render-graph.ts
//
// RenderGraph — the renderer's read view of the world (epic: unified renderer
// over the connectome graph; spec 2026-06-14-unified-renderer-spec.md, Slice R0).
//
// This is the SEAM three sessions integrate through: the renderer consumes a
// narrow projection — placed drawable nodes + terrain heightfield + linear
// edges + light — and never reaches into world / sim / connectome internals.
// Today a `WorldRenderGraph` adapter backs it from the live `World`; later the
// connectome can back it natively without the renderer changing.
//
// PURITY: this file must import NOTHING from `@/world`, `@/sim`, or
// `@/catalogue` (guarded by render-graph-r0.test.ts). It stays a pure shape so
// either side of the seam can evolve independently. `RenderNode.ref` is a
// renderer-opaque handle (generic `TRef`) so the interface need not know what a
// node *is* — the adapter parameterises it (Entity | NpcInstance | …) and the
// renderer's resolvers consume it.
import type { Region } from '@/core/types';
import type { Vec3 } from '@/render/lighting-state';

export type { Region };

export type RenderCategory =
  | 'building' | 'vegetation' | 'barrier' | 'npc' | 'prop' | 'decoration';

/** One placed, drawable thing. Positions are world tile coords; `z` is elevation
 *  in metres (0 until Slice R1 resurfaces the heightfield). */
export interface RenderNode<TRef = unknown> {
  id: string;
  x: number;
  y: number;
  z: number;
  footprint: { w: number; h: number };
  kind: string;
  category: RenderCategory;
  /** Resolved SpritePack cache key, when known (an asset-cache hit). */
  assetKey?: string;
  /** Era/descriptor/lifecycle identity that selects the variant sprite. */
  variantKey?: string;
  /** Facing for future 4-direction art (0=S,1=W,2=N,3=E by convention). */
  facing?: 0 | 1 | 2 | 3;
  /** Renderer-opaque handle back to the source row (Entity / NpcInstance /
   *  decoration). The graph stays ignorant of its concrete type; the renderer's
   *  art resolvers consume it. */
  ref: TRef;
}

/** Terrain as the renderer reads it — a sampled heightfield + per-tile material. */
export interface TerrainView {
  /** Elevation in metres at tile (tx,ty). Returns 0 until R1. */
  heightAt(tx: number, ty: number): number;
  /** Material / biome id for ground shading + (R2) ground-texture selection. */
  materialAt(tx: number, ty: number): string;
  waterLevelM: number;
}

/** A linear feature drawn as a ribbon (roads/rivers/walls). Empty until Track V
 *  promotes linear features to graph edges; barriers currently arrive as nodes. */
export type RenderEdge = {
  kind: 'road' | 'river' | 'wall';
  polyline: Array<[number, number]>;
  width: number;
  material?: string;
};

/** Resolved sky light to feed the lit shader (mirrors `studio/solar.ts` output). */
export interface LightView {
  ambient: Vec3;
  sunColor: Vec3;
  /** Direction TOWARD the light, in normal-map screen space (see lighting-state). */
  sunDir: Vec3;
  bands: number;
  body: 'sun' | 'moon';
}

/** The renderer's whole world view. `TRef` is the adapter's node handle type. */
export interface RenderGraph<TRef = unknown> {
  readonly bounds: { w: number; h: number };
  readonly terrain: TerrainView;
  readonly light: LightView;
  /** Drawable nodes intersecting the region. The caller may pre-cull; the
   *  renderer is free to re-cull. */
  nodes(region: Region): Iterable<RenderNode<TRef>>;
  /** Linear features intersecting the region (empty until Track V). */
  edges(region: Region): Iterable<RenderEdge>;
}
