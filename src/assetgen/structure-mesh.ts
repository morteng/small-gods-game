// src/assetgen/structure-mesh.ts
//
// Structure-mesh extraction (the 3D-structure epic, S0). Shares `partFacets` with
// `composeStructure` so the mesh path and the sprite path build from the SAME manifold
// solids + materials — they cannot drift. It stops BEFORE `projectFacets`/`rasterizeMaps`
// (the sprite flatten) and instead emits an interleaved triangle buffer in OBJECT space
// (blueprint-local: tile x, tile y; cube-unit z — the frame `WorldFacet` already uses, and
// exactly the frame `worldToScreen`/`fixedFit` project at ISO_TILE_W/2 px per unit).
//
// The live structure pass (`structure-mesh-wgsl.ts`) projects these object verts through the
// TERRAIN iso projection + writes the terrain iso depth, so a structure interleaves with the
// terrain heightfield in the shared depth buffer (founding + mutual occlusion) — the whole
// point of rendering the geometry we already build instead of a flat billboard of it.
//
// Fixed dimetric camera ⇒ back-face cull at extraction (`frontFacing`, the SAME cull the
// sprite path applies in `projectFacets`): only camera-facing faces survive, so a solid's own
// front/back faces never fight for the same height-independent iso depth.

import type { Vec3, WorldFacet } from '@/assetgen/types';
import { partFacets, makeYawRotor, type StructureSpec } from '@/assetgen/compose';
import { frontFacing } from '@/assetgen/render/projection';

/** Interleaved vertex stride: position(3) + terrain-frame normal(3) + albedo rgb(3). */
export const STRUCTURE_MESH_STRIDE_FLOATS = 9;

export interface StructureMesh {
  /** Interleaved verts `[x,y,z, nx,ny,nz, r,g,b]` in OBJECT space (tile x,y; cube-unit z;
   *  normal in the TERRAIN frame — x east, y up, z south — so the structure fragment shades
   *  under the same tile-space sun as the ground; albedo rgb in `[0,1]`). */
  data: Float32Array;
  vertexCount: number;
  /** Object-space AABB (placement + culling). */
  bbox: { lo: Vec3; hi: Vec3 };
}

/** Build the depth-testable triangle mesh for a structure spec. Async because
 *  `partFacets` drives the manifold (wasm) CSG, exactly as `composeStructure` does. */
export async function structureMesh(spec: StructureSpec): Promise<StructureMesh> {
  const parts = await Promise.all(spec.parts.map(partFacets));
  let facets: WorldFacet[] = parts.flatMap((p) => p.facets);
  // Turntable yaw (studio orbit) — a compose no-op for yaw≈0, so the game path (bridges yaw
  // their geometry via part params, spec.yaw undefined) is unaffected.
  const rot = makeYawRotor(facets, spec.yaw);
  if (rot) {
    facets = facets.map((f) => ({ ...f, pts: f.pts.map((p) => rot(p)), normal: rot(f.normal, true) }));
  }

  const data: number[] = [];
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const f of facets) {
    if (!frontFacing(f.normal)) continue;   // fixed dimetric camera → only camera-facing faces
    // Facet normal is tile-frame with z UP; the terrain sun/normal frame is y-up
    // (x east, y up, z south). Swap so the banded diffuse dots against uSun correctly.
    const nx = f.normal[0], ny = f.normal[2], nz = f.normal[1];
    const r = f.albedo[0] / 255, g = f.albedo[1] / 255, b = f.albedo[2] / 255;
    // Fan-triangulate the (convex, planar) facet polygon.
    for (let i = 1; i + 1 < f.pts.length; i++) {
      const tri = [f.pts[0], f.pts[i], f.pts[i + 1]];
      for (const p of tri) {
        data.push(p[0], p[1], p[2], nx, ny, nz, r, g, b);
        if (p[0] < lo[0]) lo[0] = p[0]; if (p[0] > hi[0]) hi[0] = p[0];
        if (p[1] < lo[1]) lo[1] = p[1]; if (p[1] > hi[1]) hi[1] = p[1];
        if (p[2] < lo[2]) lo[2] = p[2]; if (p[2] > hi[2]) hi[2] = p[2];
      }
    }
  }
  return {
    data: new Float32Array(data),
    vertexCount: data.length / STRUCTURE_MESH_STRIDE_FLOATS,
    bbox: { lo, hi },
  };
}
