import { describe, it, expect } from 'vitest';
import { updateNpcs, getSpriteCoords, FRAME_MS } from '@/render/npc-animator';
import type { NpcInstance } from '@/core/types';

function makeNpc(overrides: Partial<NpcInstance> = {}): NpcInstance {
  return {
    id: 'test',
    role: 'farmer',
    seed: 0,
    tileX: 0,
    tileY: 0,
    direction: 'down',
    frame: 1,
    frameTimer: 0,
    ...overrides,
  };
}

describe('updateNpcs', () => {
  it('advances frameTimer without changing frame when delta is small', () => {
    const npc = makeNpc({ frame: 1, frameTimer: 0 });
    updateNpcs([npc], FRAME_MS - 1);
    expect(npc.frame).toBe(1);
    expect(npc.frameTimer).toBe(FRAME_MS - 1);
  });

  it('increments frame and resets timer when delta exceeds FRAME_MS', () => {
    const npc = makeNpc({ frame: 1, frameTimer: 0 });
    updateNpcs([npc], FRAME_MS + 10);
    expect(npc.frame).toBe(2);
    expect(npc.frameTimer).toBe(10);
  });

  it('wraps frame from 8 back to 1', () => {
    const npc = makeNpc({ frame: 8, frameTimer: 0 });
    updateNpcs([npc], FRAME_MS + 5);
    expect(npc.frame).toBe(1);
  });

  it('never auto-advances idle frame (frame 0)', () => {
    const npc = makeNpc({ frame: 0, frameTimer: 0 });
    updateNpcs([npc], FRAME_MS * 10);
    expect(npc.frame).toBe(0);
    expect(npc.frameTimer).toBe(0);
  });
});

describe('getSpriteCoords', () => {
  it('maps direction up to row 8', () => {
    const { sy } = getSpriteCoords(makeNpc({ direction: 'up', frame: 0 }));
    expect(sy).toBe(8 * 64);
  });

  it('maps direction left to row 9', () => {
    const { sy } = getSpriteCoords(makeNpc({ direction: 'left', frame: 0 }));
    expect(sy).toBe(9 * 64);
  });

  it('maps direction down to row 10', () => {
    const { sy } = getSpriteCoords(makeNpc({ direction: 'down', frame: 0 }));
    expect(sy).toBe(10 * 64);
  });

  it('maps direction right to row 11', () => {
    const { sy } = getSpriteCoords(makeNpc({ direction: 'right', frame: 0 }));
    expect(sy).toBe(11 * 64);
  });

  it('computes sx as frame * 64', () => {
    const { sx } = getSpriteCoords(makeNpc({ frame: 3 }));
    expect(sx).toBe(3 * 64);
  });
});
