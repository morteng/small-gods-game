// The rig rows (M3) are addressed as if they were appended UNDER the vendored
// universal sheet. That only works while the two blocks are disjoint, and the
// vendored block's height lives in someone else's file — so pin the seam here
// rather than trusting a number nobody re-reads.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  isRigRow,
  LPC_ANIMATIONS,
  STANDARD_SHEET_ROWS,
  type LpcAnimSpec,
  type NpcAnimation,
} from '@/core/npc-animation';
import { RIG_ROW_CLIPS, RIG_STRIP_COLS, RIG_STRIP_ROWS, stripOrder } from '@/render/lpc/rig-rows';
import { IMPORTED_CLIP_META } from '@/render/paperdoll/clips';

/** Every sheet row a spec occupies (4 for a directional block, 1 otherwise). */
function rowsOf(spec: LpcAnimSpec): number[] {
  const n = spec.directional ? 4 : 1;
  return Array.from({ length: n }, (_, i) => spec.rowBase + i);
}

const entries = Object.entries(LPC_ANIMATIONS) as [NpcAnimation, LpcAnimSpec][];

describe('LPC sheet row space', () => {
  it('STANDARD_SHEET_ROWS matches the vendored composer’s SHEET_HEIGHT', () => {
    const src = readFileSync(resolve(__dirname, '../../src/render/lpc/canvas/renderer.js'), 'utf8');
    const height = Number(/export const SHEET_HEIGHT = (\d+)/.exec(src)?.[1]);
    expect(height).toBeGreaterThan(0);
    expect(STANDARD_SHEET_ROWS).toBe(height / 64);
  });

  it('no two animations share a row — rig rows collide with no standard row', () => {
    const owner = new Map<number, NpcAnimation>();
    for (const [name, spec] of entries) {
      for (const row of rowsOf(spec)) {
        expect(owner.get(row), `row ${row} claimed by both ${owner.get(row)} and ${name}`).toBeUndefined();
        owner.set(row, name);
      }
    }
  });

  it('splits cleanly at the seam: vendored rows below it, rig rows above', () => {
    for (const [name, spec] of entries) {
      const rows = rowsOf(spec);
      if (isRigRow(spec)) {
        expect(Math.min(...rows), name).toBeGreaterThanOrEqual(STANDARD_SHEET_ROWS);
      } else {
        expect(Math.max(...rows), name).toBeLessThan(STANDARD_SHEET_ROWS);
      }
    }
  });

  it('the strip is exactly big enough for the rows the bake writes', () => {
    const rigs = entries.filter(([, s]) => isRigRow(s));
    expect(rigs.length).toBe(RIG_ROW_CLIPS.length);
    // Four rows per clip: the two unauthored profile facings stay empty rather
    // than shifting the direction offsets into a second arithmetic.
    expect(RIG_STRIP_ROWS).toBe(rigs.length * 4);
    for (const [name, spec] of rigs) {
      const localTop = spec.rowBase - STANDARD_SHEET_ROWS + 3;
      expect(localTop, name).toBeLessThan(RIG_STRIP_ROWS);
      expect(spec.lastCol, name).toBeLessThan(RIG_STRIP_COLS);
    }
  });

  it('every rig row declares a STANDARD-block fallback and its authored facings', () => {
    for (const [name, spec] of entries.filter(([, s]) => isRigRow(s))) {
      expect(spec.facings, name).toBeDefined();
      expect(spec.fallback, name).toBeDefined();
      // The fallback must itself be drawable off the vendored sheet, or an
      // unbaked NPC would chase a row that does not exist.
      expect(isRigRow(LPC_ANIMATIONS[spec.fallback!.anim]), name).toBe(false);
    }
  });

  it('lastCol matches the strip order — ping-ponged for a clip that does not close on its own, straight for one that does', () => {
    for (const { anim, clip } of RIG_ROW_CLIPS) {
      const order = stripOrder(clip);
      expect(LPC_ANIMATIONS[anim].lastCol, anim).toBe(order.length - 1);
      if (IMPORTED_CLIP_META[clip.name]?.loop) {
        // A closed cycle (e.g. march): played straight through, no ping-pong.
        expect(order, anim).toEqual(Array.from({ length: clip.frames }, (_, i) => i));
      } else {
        // An open clip (the hand-authored devotional clips): ping-ponged so
        // consecutive poses close the loop with no pop at the wrap.
        expect(order.length, anim).toBe(clip.frames * 2 - 2);
        expect(order[0]).toBe(0);
        expect(order[order.length - 1]).toBe(1);
      }
    }
  });
});
