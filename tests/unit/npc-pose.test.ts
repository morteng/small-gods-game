// The sim's half of march (M5c): the sim names the state unconditionally
// ("a soldier who is MOVING marches; everyone else walks") and the renderer
// (`render/npc-animator.ts`, covered in `npc-animation.test.ts`) resolves it
// against whatever is actually baked. This file covers only the naming.
import { describe, it, expect } from 'vitest';
import { animateWalking } from '@/sim/npc-pose';
import { LPC_ANIMATIONS } from '@/core/npc-animation';
import { initNpcProps } from '@/world/npc-helpers';

describe('animateWalking', () => {
  it('a moving soldier marches', () => {
    const p = initNpcProps('Legionary', 'soldier', 1);
    animateWalking(p, 0);
    expect(p.animation).toBe('march');
  });

  it('a moving non-soldier walks, same as before march existed', () => {
    for (const role of ['farmer', 'priest', 'merchant', 'elder', 'child', 'noble', 'beggar'] as const) {
      const p = initNpcProps('Someone', role, 1);
      animateWalking(p, 0);
      expect(p.animation, role).toBe('walk');
    }
  });

  it('march starts at frame 0 — unlike walk, it has no reserved idle column', () => {
    const p = initNpcProps('Legionary', 'soldier', 1);
    animateWalking(p, 0);
    expect(p.frame).toBe(0);
  });

  it('walk never lands on frame 0 (the idle stand) while actually moving', () => {
    const p = initNpcProps('Farmer', 'farmer', 1);
    animateWalking(p, 0);
    expect(p.frame).toBeGreaterThanOrEqual(LPC_ANIMATIONS.walk.firstCol);
  });

  it('march wraps at its OWN lastCol (31), not walk\'s 8', () => {
    const p = initNpcProps('Legionary', 'soldier', 1);
    animateWalking(p, 0); // anim = 'march', frame = 0
    p.frame = LPC_ANIMATIONS.march.lastCol;
    p.frameTimer = 149;
    animateWalking(p, 1); // crosses the 150ms threshold — one frame step
    expect(p.frame).toBe(LPC_ANIMATIONS.march.firstCol);
  });

  it('switching role mid-stride (soldier -> farmer) restarts the cycle on the new anim', () => {
    const p = initNpcProps('Turncoat', 'soldier', 1);
    animateWalking(p, 0);
    expect(p.animation).toBe('march');
    p.role = 'farmer';
    animateWalking(p, 0);
    expect(p.animation).toBe('walk');
    expect(p.frame).toBe(LPC_ANIMATIONS.walk.firstCol);
  });
});
