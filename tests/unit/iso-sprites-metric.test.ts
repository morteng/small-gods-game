import { describe, it, expect } from 'vitest';
import { BILLBOARD_H_PX } from '@/render/iso/iso-sprites';
import { HUMAN_PX } from '@/render/scale-contract';

describe('NPC billboard is metric', () => {
  it('billboard height equals the metric human visible height', () => {
    expect(BILLBOARD_H_PX).toBe(HUMAN_PX);   // 54
  });
});
