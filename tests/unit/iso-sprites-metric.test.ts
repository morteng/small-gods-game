import { describe, it, expect } from 'vitest';
import { BILLBOARD_H_PX } from '@/render/iso/iso-sprites';
import { npcBillboard } from '@/render/iso/npc-billboard';
import { HUMAN_PX } from '@/render/scale-contract';

describe('NPC billboard is metric', () => {
  it('default head z equals the default OPAQUE BODY height × integer scale', () => {
    const bb = npcBillboard(undefined);
    expect(BILLBOARD_H_PX).toBe((bb.bottom - bb.top) * bb.scale); // 30 × 2 = 60
  });

  it('lands within an integer-snap tolerance of the metric human height', () => {
    // Integer scaling (1:1 rule) can't hit HUMAN_PX exactly; stay within ~15%.
    expect(Math.abs(BILLBOARD_H_PX - HUMAN_PX) / HUMAN_PX).toBeLessThan(0.15);
  });
});
