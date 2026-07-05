// The worker executes the SAME composeStructure -> payloadFromResult reduction the inline
// path runs, so the payload it posts back is byte-identical to a main-thread compose. This
// pins that parity WITHOUT spinning a real Worker (jsdom has none): it calls the worker's
// handler logic (`composeToPayload`, the exact function compose-worker.ts invokes) directly
// and deep-compares it to the inline composeStructure -> payloadFromResult output.
import { describe, it, expect } from 'vitest';
import { composeStructure, type StructureSpec } from '@/assetgen/compose';
import { payloadFromResult } from '@/render/parametric-sprite-cache';
import { composeToPayload, payloadTransferables } from '@/render/compose-payload';

const spec: StructureSpec = {
  size: 128,
  parts: [
    { prim: 'box', at: [0, 0, 0], size: [2, 2, 2], material: 'stone' },
    { prim: 'cone', center: [1, 1], baseZ: 2, radius: 1.2, height: 2, material: 'thatch' },
  ],
};

describe('compose payload parity (worker handler === inline)', () => {
  it('composeToPayload deep-equals inline composeStructure -> payloadFromResult', async () => {
    const opts = { surfaceTexture: true };
    const inline = payloadFromResult(await composeStructure(spec, undefined, opts));
    const viaHandler = await composeToPayload(spec, opts);
    expect(inline).not.toBeNull();
    expect(viaHandler).not.toBeNull();
    // Typed arrays compare element-wise under deep-equality; anchors/dims compare structurally.
    expect(viaHandler).toEqual(inline);
  });

  it('surviving a structured-clone round-trip (worker message) preserves the bytes', async () => {
    const payload = await composeToPayload(spec, { surfaceTexture: true });
    expect(payload).not.toBeNull();
    // Mirror the worker->main hop: structuredClone is exactly what postMessage does.
    const cloned = structuredClone(payload!);
    expect(cloned.w).toBe(payload!.w);
    expect(cloned.h).toBe(payload!.h);
    // Bytes survive intact for every backing map.
    expect(Array.from(cloned.grey)).toEqual(Array.from(payload!.grey));
    expect(Array.from(cloned.normal)).toEqual(Array.from(payload!.normal));
    expect(Array.from(cloned.material)).toEqual(Array.from(payload!.material));
    expect(cloned.anchors).toEqual(payload!.anchors);
  });

  it('payloadTransferables lists exactly the backing buffers present', async () => {
    const payload = await composeToPayload(spec, { surfaceTexture: true });
    const bufs = payloadTransferables(payload!);
    const expected = [payload!.grey.buffer, payload!.normal.buffer, payload!.material.buffer];
    if (payload!.emissive) expected.push(payload!.emissive.buffer);
    if (payload!.shadow) expected.push(payload!.shadow.data.buffer);
    expect(bufs).toEqual(expected);
    // Every entry is a distinct, transferable ArrayBuffer (nothing aliases).
    expect(new Set(bufs).size).toBe(bufs.length);
  });
});
