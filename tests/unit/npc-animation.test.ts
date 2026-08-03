import { describe, it, expect } from 'vitest';
import { isRigRow, LPC_ANIMATIONS, LPC_DIR_OFFSET, nextFrame, STANDARD_SHEET_ROWS } from '@/core/npc-animation';
import { getSpriteCoords, resolveNpcFrame } from '@/render/npc-animator';
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

  it('resolves a rig animation to its fallback on the standard sheet', () => {
    // No rig strip anywhere near this call — a rig row must never leak a
    // rowBase past the vendored sheet into a reader that only has that sheet.
    const c = getSpriteCoords(npc({ animation: 'pray-raise', direction: 'down', frame: 5 }));
    expect(c).toEqual({ sx: 0, sy: 10 * 64 }); // walk down, column 0 = idle stand
  });
});

describe('rig rows', () => {
  const RIGS = ['pray-raise', 'idle-shift'] as const;

  it('are the entries that sit past the vendored block', () => {
    for (const a of RIGS) {
      expect(isRigRow(LPC_ANIMATIONS[a])).toBe(true);
      expect(LPC_ANIMATIONS[a].rowBase).toBeGreaterThanOrEqual(STANDARD_SHEET_ROWS);
    }
    for (const a of ['spellcast', 'thrust', 'walk', 'slash', 'shoot', 'hurt'] as const) {
      expect(isRigRow(LPC_ANIMATIONS[a])).toBe(false);
    }
  });

  it('loop over the ping-ponged strip', () => {
    expect(LPC_ANIMATIONS['pray-raise'].lastCol).toBe(11);   // 7 authored frames
    expect(LPC_ANIMATIONS['idle-shift'].lastCol).toBe(13);   // 8 authored frames
    expect(nextFrame('pray-raise', 11)).toBe(0);
    expect(nextFrame('idle-shift', 6)).toBe(7);
  });

  it('are authored for south + north only', () => {
    for (const a of RIGS) {
      expect([...LPC_ANIMATIONS[a].facings!].sort()).toEqual(['down', 'up']);
    }
  });

  it('read off the STRIP when it is baked, rebased onto it', () => {
    const spec = LPC_ANIMATIONS['pray-raise'];
    const f = resolveNpcFrame(npc({ animation: 'pray-raise', direction: 'down', frame: 4 }), true);
    expect(f.rig).toBe(true);
    expect(f.sx).toBe(4 * 64);
    expect(f.sy).toBe((spec.rowBase - STANDARD_SHEET_ROWS + LPC_DIR_OFFSET.down) * 64);
  });

  it('fall back for an unbaked strip AND for the facings the rig never authored', () => {
    const unbaked = resolveNpcFrame(npc({ animation: 'pray-raise', direction: 'down', frame: 4 }), false);
    expect(unbaked).toEqual({ sx: 0, sy: 10 * 64, rig: false });
    // Strip baked, but west/east carry no pixels — the idle stand, not a hole.
    const profile = resolveNpcFrame(npc({ animation: 'pray-raise', direction: 'left', frame: 4 }), true);
    expect(profile).toEqual({ sx: 0, sy: (8 + LPC_DIR_OFFSET.left) * 64, rig: false });
  });
});

describe('march (profile rig row)', () => {
  it('is authored for left + right only — the inverse of pray-raise/idle-shift', () => {
    expect([...LPC_ANIMATIONS['march'].facings!].sort()).toEqual(['left', 'right']);
  });

  it('reads off the STRIP on its authored (profile) facings when baked', () => {
    const spec = LPC_ANIMATIONS['march'];
    const west = resolveNpcFrame(npc({ animation: 'march', direction: 'left', frame: 10 }), true);
    expect(west.rig).toBe(true);
    expect(west.sx).toBe(10 * 64);
    expect(west.sy).toBe((spec.rowBase - STANDARD_SHEET_ROWS + LPC_DIR_OFFSET.left) * 64);

    const east = resolveNpcFrame(npc({ animation: 'march', direction: 'right', frame: 10 }), true);
    expect(east.rig).toBe(true);
    expect(east.sy).toBe((spec.rowBase - STANDARD_SHEET_ROWS + LPC_DIR_OFFSET.right) * 64);
  });

  it('falls back to the vendored WALK row for south/north, carrying cycle POSITION not raw frame', () => {
    // march frame 0 of its 0..31 cycle = cycle start -> walk's cycle start (col 1).
    const start = resolveNpcFrame(npc({ animation: 'march', direction: 'down', frame: 0 }), true);
    expect(start).toEqual({ sx: 1 * 64, sy: 10 * 64, rig: false });

    // march's LAST frame (31) = cycle end -> walk's LAST column (8).
    const end = resolveNpcFrame(npc({ animation: 'march', direction: 'up', frame: 31 }), true);
    expect(end).toEqual({ sx: 8 * 64, sy: 8 * 64, rig: false });

    // A literal frame carry-through would clamp anything past column 8 to 8 —
    // prove the MIDPOINT of the march cycle does not read as walk's last
    // frame (frozen), which is exactly the bug the proportional remap avoids.
    const mid = resolveNpcFrame(npc({ animation: 'march', direction: 'down', frame: 16 }), true);
    expect(mid.sx).not.toBe(8 * 64);
    expect(mid.sx).toBe(5 * 64); // 1 + round((16/31)*7) = 5
  });

  it('also falls back — same walk row — when the strip is simply unbaked', () => {
    const unbaked = resolveNpcFrame(npc({ animation: 'march', direction: 'left', frame: 0 }), false);
    expect(unbaked).toEqual({ sx: 1 * 64, sy: (8 + LPC_DIR_OFFSET.left) * 64, rig: false });
  });
});
