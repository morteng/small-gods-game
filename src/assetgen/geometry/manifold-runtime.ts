// src/assetgen/geometry/manifold-runtime.ts
// Lazy singleton for the manifold-3d WASM CSG kernel. Node locates manifold.wasm
// on the filesystem automatically; the browser must point the Emscripten module at
// the Vite-served wasm via setManifoldWasmUrl() before the first getManifold().
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

/** Tessellation segments for cylinders/spheres — pinned so output is deterministic. */
export const CIRCULAR_SEGMENTS = 32;

let cached: Promise<ManifoldToplevel> | undefined;
let wasmUrl: string | undefined;

/** Browser only: point the Emscripten kernel at the Vite-served wasm URL. No-op for Node. */
export function setManifoldWasmUrl(url: string): void { wasmUrl = url; }

/** Emscripten Module() options — `locateFile` only when a browser url was set. */
export function manifoldModuleOptions(): Record<string, unknown> {
  return wasmUrl ? { locateFile: () => wasmUrl as string } : {};
}

/** Test-only: forget any set url so cases start from the Node default. */
export function __resetManifoldWasmUrlForTest(): void { wasmUrl = undefined; }

/** Resolve the initialised manifold toplevel (cached after first call). */
export function getManifold(): Promise<ManifoldToplevel> {
  if (!cached) {
    cached = Module(manifoldModuleOptions() as { locateFile: () => string }).then((wasm) => {
      wasm.setup();
      wasm.setCircularSegments(CIRCULAR_SEGMENTS);
      return wasm;
    });
  }
  return cached;
}
