// src/render/compose-payload.ts
//
// The compose→cache-payload boundary shared by the inline scheduler and the
// off-thread worker pool (R10 WP-A). This is the ONE seam that runs `composeStructure`
// and reduces its heavy StructureResult to the pure typed-array `CachedSpritePayload`
// (`payloadFromResult` — "no canvas anywhere"), so the exact same reduction runs
// whether the compose happened on the main thread or in a Web Worker.
//
// Deliberately worker-safe AND Node-safe: it touches no `document`/`window` and no
// Vite `?url` asset import, so the worker entry (`compose-worker.ts`) can import it and
// vitest can call `composeToPayload` directly for the payload-parity test. The pool
// dispatcher and the worker-URL literal live in `compose-offthread.ts`.
import { composeStructure, type StructureSpec } from '@/assetgen/compose';
import { payloadFromResult, type CachedSpritePayload } from '@/render/parametric-sprite-cache';

/** The compose options the three runtime sources actually pass (buildings pass
 *  surfaceTexture+yaw, barriers surfaceTexture, plants neither). A structured-clone-safe
 *  subset of ComposeOpts — the only shape that crosses the worker message boundary. */
export interface ComposePayloadOpts {
  surfaceTexture?: boolean;
  yaw?: number;
}

/**
 * Compose a spec and reduce it to its cacheable payload — the whole unit of work a
 * worker performs. Returns null when the render is degenerate (same gate as
 * `payloadFromResult`), which the caller treats as "cache a null pack" (no sprite).
 * Never touches a canvas, so it runs identically on the main thread or in a worker.
 */
export async function composeToPayload(
  spec: StructureSpec,
  opts?: ComposePayloadOpts,
): Promise<CachedSpritePayload | null> {
  const r = await composeStructure(spec, undefined, opts);
  return payloadFromResult(r);
}

/**
 * The transferable ArrayBuffers backing a payload's typed arrays — each map is a fresh
 * crop (`cropRgba` allocates a new buffer per map, and the shadow owns its own), so
 * transferring them all detaches nothing the payload still needs. Used by the worker to
 * post the payload zero-copy; harmless to compute on any payload.
 */
export function payloadTransferables(p: CachedSpritePayload): ArrayBuffer[] {
  const out: ArrayBuffer[] = [p.grey.buffer, p.normal.buffer, p.material.buffer];
  if (p.emissive) out.push(p.emissive.buffer);
  if (p.shadow) out.push(p.shadow.data.buffer);
  return out;
}
