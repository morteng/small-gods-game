import { describe, expect, it } from 'vitest';
import { sampleClip } from '@/render/paperdoll/rig';
import { CLIP_PRAY_RAISE, LPC_HUMANOID_SOUTH } from '@/render/paperdoll/lpc-humanoid';
import { LPC_HUMANOID_NORTH } from '@/render/paperdoll/lpc-humanoid-north';

describe('LPC_HUMANOID_NORTH — clip-compatibility contract', () => {
  it('chip names exactly match LPC_HUMANOID_SOUTH, same order', () => {
    // This is the WHOLE POINT of the north template: Clip.tracks key by chip
    // name, so any south-authored clip must find the same names in the same
    // template slots to play unmodified on north.
    const southNames = LPC_HUMANOID_SOUTH.chips.map((c) => c.name);
    const northNames = LPC_HUMANOID_NORTH.chips.map((c) => c.name);
    expect(northNames).toEqual(southNames);
  });

  it('index 0 is root (parent -1); every other chip has a valid parent index; rects sit inside the 64px cell', () => {
    const chips = LPC_HUMANOID_NORTH.chips;
    expect(chips[0].parent).toBe(-1);
    chips.forEach((chip, i) => {
      if (i === 0) return;
      expect(chip.parent).toBeGreaterThanOrEqual(0);
      expect(chip.parent).toBeLessThan(chips.length);
      expect(chip.parent).toBeLessThan(i); // parents are authored before children
    });
    for (const chip of chips) {
      const { x, y, w, h } = chip.rect;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      expect(x + w).toBeLessThanOrEqual(LPC_HUMANOID_NORTH.cell);
      expect(y + h).toBeLessThanOrEqual(LPC_HUMANOID_NORTH.cell);
    }
  });

  it('cell size matches south (both slice the same 64px LPC sheets)', () => {
    expect(LPC_HUMANOID_NORTH.cell).toBe(LPC_HUMANOID_SOUTH.cell);
  });

  it.each([0, 0.5, 1])('sampleClip(CLIP_PRAY_RAISE, t=%s) matches south\'s poses exactly', (t) => {
    // CLIP_PRAY_RAISE has no `couple`/`plant` — sampleTrack resolves purely
    // by chip NAME against clip.tracks, independent of a chip's rect/pivot.
    // Since north's pivots were copied verbatim from south (recon found no
    // joint-position delta — see lpc-humanoid-north.ts's doc comment) AND
    // the chip name/order/parent structure is identical (test above), the
    // sampled per-chip pose arrays must be deep-equal between templates.
    const southPoses = sampleClip(LPC_HUMANOID_SOUTH, CLIP_PRAY_RAISE, t);
    const northPoses = sampleClip(LPC_HUMANOID_NORTH, CLIP_PRAY_RAISE, t);
    expect(northPoses).toEqual(southPoses);
  });
});
