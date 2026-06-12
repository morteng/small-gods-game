// tests/unit/npc-billboard.test.ts
// NPC billboard metric sizing: the OPAQUE BODY (not the 64px LPC frame) is what
// anchors to HUMAN_PX, via a nearest-INTEGER scale (1:1 pixel-perfect rule).
// Source bodies are ~30px in a 64px frame, so frame-scaled-to-54px rendered
// villagers at ~25px ≈ 0.79m apparent — half size vs the building scale contract.
import { describe, it, expect } from 'vitest';
import { HUMAN_PX } from '@/render/scale-contract';
import {
  measureFrameOpaqueRows,
  npcBillboardScale,
  npcBillboard,
  LPC_DEFAULT_BODY,
} from '@/render/iso/npc-billboard';

function frameWithOpaqueRows(w: number, h: number, top: number, bottom: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = top; y < bottom; y++) data[(y * w + Math.floor(w / 2)) * 4 + 3] = 255;
  return data;
}

describe('measureFrameOpaqueRows', () => {
  it('finds the top and bottom (exclusive) opaque rows', () => {
    const data = frameWithOpaqueRows(64, 64, 32, 62);
    expect(measureFrameOpaqueRows(data, 64, 64)).toEqual({ top: 32, bottom: 62 });
  });

  it('returns null for a fully transparent frame', () => {
    expect(measureFrameOpaqueRows(new Uint8ClampedArray(64 * 64 * 4), 64, 64)).toBeNull();
  });

  it('ignores near-zero alpha noise (threshold)', () => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    data[(5 * 64 + 5) * 4 + 3] = 4; // below threshold
    data[(40 * 64 + 5) * 4 + 3] = 200;
    expect(measureFrameOpaqueRows(data, 64, 64)).toEqual({ top: 40, bottom: 41 });
  });
});

describe('npcBillboardScale', () => {
  it('snaps to the nearest integer scale so the body lands near HUMAN_PX', () => {
    expect(npcBillboardScale(30)).toBe(2); // adult LPC body → 60px ≈ 1.88m
    expect(npcBillboardScale(24)).toBe(2); // child body → 48px ≈ 1.5m
    expect(npcBillboardScale(54)).toBe(1); // body already at HUMAN_PX
  });

  it('never returns below 1 even for oversized source bodies', () => {
    expect(npcBillboardScale(200)).toBe(1);
  });
});

describe('npcBillboard (no measurable sheet → LPC defaults)', () => {
  it('falls back to the default adult LPC body metrics', () => {
    const bb = npcBillboard(undefined);
    expect(bb.scale).toBe(npcBillboardScale(LPC_DEFAULT_BODY.bottom - LPC_DEFAULT_BODY.top));
    expect(bb.top).toBe(LPC_DEFAULT_BODY.top);
    expect(bb.bottom).toBe(LPC_DEFAULT_BODY.bottom);
  });

  it('default body height scaled is within one source pixel of HUMAN_PX', () => {
    const bb = npcBillboard(undefined);
    const bodyPx = (bb.bottom - bb.top) * bb.scale;
    expect(Math.abs(bodyPx - HUMAN_PX)).toBeLessThanOrEqual(bb.scale * 4);
  });
});
