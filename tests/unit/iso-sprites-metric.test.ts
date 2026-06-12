import { describe, it, expect } from 'vitest';
import { BILLBOARD_H_PX } from '@/render/iso/iso-sprites';
import { npcBillboard } from '@/render/iso/npc-billboard';

describe('NPC billboard sizing', () => {
  // INTERIM (user decision 2026-06-12): NPCs render 1× native (~0.94m apparent)
  // until the generative NPC system authors sprites at metric size — the 1.8×
  // metric-true scale is fractional (breaks 1:1), and 2× made them door-sized.
  it('default head z equals the default OPAQUE BODY height × sprite scale', () => {
    const bb = npcBillboard(undefined);
    expect(BILLBOARD_H_PX).toBe((bb.bottom - bb.top) * bb.scale); // 30 × 1 = 30
  });
});
