// src/render/structure-mesh-field.ts
//
// Per-frame WORLD-space structure-mesh field for the depth-tested structure pass
// (3D-structure epic, S1 — bridges first). Collects the bridge entities in view, peeks each
// one's object-space `StructureMesh` (warming it off-frame on a miss, mirroring the parametric
// sprite source's peek/warm contract), transforms the object verts into world coordinates
// (footprint origin + `liftElev` folded into z), and concatenates everything into ONE
// interleaved vertex buffer the GPU pass uploads and draws in a single call.
//
// Placement parity with the sprite path is by construction: object verts are tile/cube-unit
// coords that `worldToScreen`/`fixedFit` already project at ISO_TILE_W/2 px per unit, so
// translating by the footprint origin (`structureBox`) and folding the terrain lift of
// `liftElev` (the SAME `liftPxFromElev` the sprite's above-water deck uses) lands the mesh
// exactly where the billboard's pixels landed — but now depth-tested against the terrain.

import type { RenderContext, Entity } from '@/core/types';
import type { TileBounds } from '@/render/iso/iso-projection';
import { WorldRenderGraph } from '@/render/graph/world-render-graph';
import type { RenderCategory } from '@/render/graph/render-graph';
import { blueprintOf } from '@/blueprint/entity';
import { structureBox } from '@/blueprint/footprint';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import type { ResolvedBlueprint } from '@/blueprint/types';
import { structureMesh, type StructureMesh, STRUCTURE_MESH_STRIDE_FLOATS as S } from '@/assetgen/structure-mesh';
import { worldStyleOf } from '@/core/world-style';
import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { liftPxFromElev } from '@/render/gpu/terrain-lift';
import { HEIGHT_UNIT_PX } from '@/render/scale-contract';

/** An uploaded structure-mesh field: interleaved world-space verts + count. */
export interface StructureField {
  /** Interleaved `[x,y,z, nx,ny,nz, r,g,b]` per vertex — position in WORLD tile/cube coords
   *  (footprint-placed, lift folded into z), normal in the terrain frame, albedo `[0,1]`. */
  data: Float32Array;
  vertexCount: number;
}

// In-memory content-addressed mesh cache (per resolved blueprint). Bridges of the same class
// share one object-space mesh; identical worlds recompute nothing across frames.
const meshCache = new Map<string, StructureMesh | null>();
const inflight = new Set<string>();
let rev = 0;

/** Bumped when a mesh warm settles — fold into a draw cache key to force a rebuild once the
 *  first bridge mesh is ready (else an idle frame taken before the compose finishes is empty). */
export function structureFieldRev(): number { return rev; }

/** Reset on world change (mirrors the sprite sources' `clear`). */
export function clearStructureMeshCache(): void {
  meshCache.clear();
  inflight.clear();
  rev++;
}

function keyOf(rb: ResolvedBlueprint): string { return JSON.stringify(rb); }

function warm(key: string, rb: ResolvedBlueprint, onWarm?: () => void): void {
  if (inflight.has(key)) return;
  inflight.add(key);
  let spec;
  try { spec = toGeometry(rb); } catch { meshCache.set(key, null); inflight.delete(key); rev++; return; }
  if (!spec) { meshCache.set(key, null); inflight.delete(key); rev++; return; }
  structureMesh(spec)
    .then((m) => { meshCache.set(key, m); })
    .catch((err) => { console.warn('[structure-mesh] extraction failed', err); meshCache.set(key, null); })
    .finally(() => { inflight.delete(key); rev++; onWarm?.(); });
}

/**
 * Build the world-space structure field for the bridges in view. Returns null when no bridge
 * mesh is ready yet (the caller skips the pass; the sprite fallback still draws unless the
 * divert flag suppressed it). Cheap: a handful of bridges, meshes cached across frames.
 */
export function buildStructureField(rc: RenderContext, bounds: TileBounds, onWarm?: () => void): StructureField | null {
  const style = worldStyleOf(rc.map.worldSeed);
  const reliefM = style.mountainRelief;
  const zPxPerM = style.terrainVerticalExaggeration;
  const seaLevel = ELEVATION_SEA_LEVEL;
  const region = {
    x: bounds.minTx, y: bounds.minTy,
    w: bounds.maxTx - bounds.minTx + 1, h: bounds.maxTy - bounds.minTy + 1,
  };
  const out: number[] = [];
  for (const node of new WorldRenderGraph(rc).nodes(region, { categories: new Set<RenderCategory>(['building']) })) {
    if (node.category !== 'building') continue;
    const e = node.ref as Entity;
    const stored = blueprintOf(e);
    if (!stored || stored.rb.preset !== 'bridge') continue;   // MVP: bridges only
    const key = keyOf(stored.rb);
    const mesh = meshCache.get(key);
    if (mesh === undefined) { warm(key, stored.rb, onWarm); continue; }
    if (mesh === null || mesh.vertexCount === 0) continue;
    const s = structureBox(stored.rb);
    const bx = Math.floor(e.x) + s.dx, by = Math.floor(e.y) + s.dy;
    const liftElev = (e.properties as { liftElev?: number } | undefined)?.liftElev;
    // Fold the terrain lift of the seat elevation into z (cube-units): the deck rides its
    // authored bank elevation, its supports plunge below and are occluded by the bed terrain.
    const liftZc = liftElev !== undefined
      ? liftPxFromElev(liftElev, seaLevel, reliefM, zPxPerM) / HEIGHT_UNIT_PX
      : 0;
    const d = mesh.data;
    for (let i = 0; i < d.length; i += S) {
      out.push(
        bx + d[i], by + d[i + 1], d[i + 2] + liftZc,   // world position (lift folded into z)
        d[i + 3], d[i + 4], d[i + 5],                  // terrain-frame normal
        d[i + 6], d[i + 7], d[i + 8],                  // albedo
      );
    }
  }
  if (out.length === 0) return null;
  return { data: new Float32Array(out), vertexCount: out.length / S };
}
