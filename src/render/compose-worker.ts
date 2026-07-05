// src/render/compose-worker.ts
//
// Module-worker entry for off-thread parametric sprite composition (R10 WP-A).
// Vite bundles this as a dedicated worker chunk via the
// `new Worker(new URL('./compose-worker.ts', import.meta.url), { type: 'module' })`
// literal in `compose-offthread.ts`. It must be imported ONLY through that literal —
// never by Node/vitest — because it touches `self` and the Vite `?url` wasm import at
// module eval.
//
// Protocol:
//   in : { id: number; spec: StructureSpec; opts?: ComposePayloadOpts }
//   out: { id; payload: CachedSpritePayload | null; cpuMs }  (transfers the payload buffers)
//     | { id; error: string }
//
// The worker runs the SAME `composeToPayload` (composeStructure → payloadFromResult) the
// inline path runs, so its output is byte-identical to a main-thread compose; the main
// thread then treats the returned payload exactly like an IDB/vendored cache hit.
/// <reference lib="webworker" />
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
import { composeToPayload, payloadTransferables, type ComposePayloadOpts } from '@/render/compose-payload';
import type { StructureSpec } from '@/assetgen/compose';

// The manifold CSG kernel loads lazily on the first compose; point it at the Vite-served
// wasm now (the `?url` import resolves per-worker, mirroring the main-thread bootstrap).
initManifoldWasm();

interface ComposeRequest { id: number; spec: StructureSpec; opts?: ComposePayloadOpts }

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<ComposeRequest>): void => {
  const { id, spec, opts } = e.data;
  const t0 = performance.now();
  void composeToPayload(spec, opts).then(
    (payload) => {
      const cpuMs = performance.now() - t0;
      // A null payload (degenerate render) still posts back so the caller settles it as a
      // null pack — that is NOT an error.
      if (!payload) { ctx.postMessage({ id, payload: null, cpuMs }); return; }
      ctx.postMessage({ id, payload, cpuMs }, payloadTransferables(payload));
    },
    (err: unknown) => {
      ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    },
  );
};
