// tests/unit/npc-billboard.test.ts
// NPC billboard metric sizing: the OPAQUE BODY (not the 64px LPC frame) is what
// anchors to HUMAN_PX, via a nearest-INTEGER scale (1:1 pixel-perfect rule).
// Source bodies are ~30px in a 64px frame, so frame-scaled-to-54px rendered
// villagers at ~25px ≈ 0.79m apparent — half size vs the building scale contract.
import { describe, it, expect } from 'vitest';
import {
  measureFrameOpaqueRows,
  npcBillboardScale,
  npcBillboard,
  LPC_DEFAULT_BODY,
  NPC_SPRITE_SCALE,
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
  // INTERIM (user decision 2026-06-12): 1× native until the generative NPC
  // system authors sprites at metric size. 2× made villagers door-sized; the
  // metric-true 1.8× is fractional and breaks the 1:1 pixel rule.
  it('is pinned to NPC_SPRITE_SCALE = 1 for every body size', () => {
    expect(NPC_SPRITE_SCALE).toBe(1);
    expect(npcBillboardScale(30)).toBe(NPC_SPRITE_SCALE);
    expect(npcBillboardScale(24)).toBe(NPC_SPRITE_SCALE);
    expect(npcBillboardScale(200)).toBe(NPC_SPRITE_SCALE);
  });
});

describe('npcBillboard (no measurable sheet → LPC defaults)', () => {
  it('falls back to the default adult LPC body metrics', () => {
    const bb = npcBillboard(undefined);
    expect(bb.scale).toBe(npcBillboardScale(LPC_DEFAULT_BODY.bottom - LPC_DEFAULT_BODY.top));
    expect(bb.top).toBe(LPC_DEFAULT_BODY.top);
    expect(bb.bottom).toBe(LPC_DEFAULT_BODY.bottom);
  });

  it('default body renders at native size (interim 1× decision)', () => {
    const bb = npcBillboard(undefined);
    expect((bb.bottom - bb.top) * bb.scale).toBe(30);
  });
});
