// src/assetgen/geometry/manifold-runtime.ts
// Lazy singleton for the manifold-3d WASM CSG kernel. The ONE async/WASM seam in
// assetgen geometry. Node-side only for now (the Emscripten module locates
// manifold.wasm automatically); browser/Vite wasm-URL plumbing is a later slice.
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

/** Tessellation segments for cylinders/spheres — pinned so output is deterministic. */
export const CIRCULAR_SEGMENTS = 32;

let cached: Promise<ManifoldToplevel> | undefined;

/** Resolve the initialised manifold toplevel (cached after first call). */
export function getManifold(): Promise<ManifoldToplevel> {
  if (!cached) {
    cached = Module().then((wasm) => {
      wasm.setup();
      wasm.setCircularSegments(CIRCULAR_SEGMENTS);
      return wasm;
    });
  }
  return cached;
}
