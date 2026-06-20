import { describe, it, expect } from 'vitest';
import { LPC_ANIMATIONS, LPC_DIR_OFFSET, nextFrame } from '@/core/npc-animation';
import { getSpriteCoords } from '@/render/npc-animator';
import type { NpcInstance } from '@/core/types';

function npc(partial: Partial<NpcInstance>): NpcInstance {
  return {
    id: 'n', name: 'n', role: 'farmer', seed: 1,
    tileX: 0, tileY: 0, direction: 'down', frame: 0, frameTimer: 0,
    ...partial,
  };
}

describe('LPC animation table', () => {
  it('matches the classic universal-sheet row bases', () => {
    expect(LPC_ANIMATIONS.spellcast.rowBase).toBe(0);
    expect(LPC_ANIMATIONS.thrust.rowBase).toBe(4);
    expect(LPC_ANIMATIONS.walk.rowBase).toBe(8);
    expect(LPC_ANIMATIONS.slash.rowBase).toBe(12);
    expect(LPC_ANIMATIONS.shoot.rowBase).toBe(16);
    expect(LPC_ANIMATIONS.hurt.rowBase).toBe(20);
  });

  it('walk reserves column 0 as idle (cycle starts at 1)', () => {
    expect(LPC_ANIMATIONS.walk.firstCol).toBe(1);
    expect(LPC_ANIMATIONS.walk.lastCol).toBe(8);
  });

  it('hurt is the one non-directional, non-looping row', () => {
    expect(LPC_ANIMATIONS.hurt.directional).toBe(false);
    expect(LPC_ANIMATIONS.hurt.loop).toBe(false);
    // every other animation is directional + looping
    for (const a of ['spellcast', 'thrust', 'walk', 'slash', 'shoot'] as const) {
      expect(LPC_ANIMATIONS[a].directional).toBe(true);
      expect(LPC_ANIMATIONS[a].loop).toBe(true);
    }
  });
});

describe('nextFrame', () => {
  it('loops looping animations back to firstCol', () => {
    expect(nextFrame('walk', 8)).toBe(1);   // wrap to firstCol
    expect(nextFrame('walk', 3)).toBe(4);    // advance
    expect(nextFrame('slash', 5)).toBe(0);
  });

  it('holds the last frame for non-looping animations', () => {
    expect(nextFrame('hurt', 5)).toBe(5);    // collapse holds
    expect(nextFrame('hurt', 2)).toBe(3);
  });
});

describe('getSpriteCoords', () => {
  it('defaults to walk when animation is undefined (back-compat)', () => {
    // walk down = row 8 + dir(down=2) = 10, column = frame
    const c = getSpriteCoords(npc({ direction: 'down', frame: 3 }));
    expect(c).toEqual({ sx: 3 * 64, sy: 10 * 64 });
  });

  it('maps each direction to rowBase + offset', () => {
    for (const dir of ['up', 'left', 'down', 'right'] as const) {
      const c = getSpriteCoords(npc({ animation: 'slash', direction: dir, frame: 2 }));
      expect(c.sy).toBe((12 + LPC_DIR_OFFSET[dir]) * 64);
      expect(c.sx).toBe(2 * 64);
    }
  });

  it('hurt ignores direction (single south row)', () => {
    const up = getSpriteCoords(npc({ animation: 'hurt', direction: 'up', frame: 1 }));
    const right = getSpriteCoords(npc({ animation: 'hurt', direction: 'right', frame: 1 }));
    expect(up.sy).toBe(20 * 64);
    expect(right.sy).toBe(20 * 64);
  });

  it('clamps an out-of-range frame to the animation last column', () => {
    // shoot lastCol = 12; a stale frame of 99 must not read past it
    const c = getSpriteCoords(npc({ animation: 'shoot', direction: 'down', frame: 99 }));
    expect(c.sx).toBe(12 * 64);
  });
});
