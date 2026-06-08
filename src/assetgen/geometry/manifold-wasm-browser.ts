// src/assetgen/geometry/manifold-wasm-browser.ts
// Browser-ONLY. The `?url` import is Vite syntax; Node/vitest must never import this
// file. Call initManifoldWasm() once from the game bootstrap before any generation.
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { setManifoldWasmUrl } from './manifold-runtime';

let done = false;
export function initManifoldWasm(): void {
  if (done) return;
  setManifoldWasmUrl(wasmUrl);
  done = true;
}
