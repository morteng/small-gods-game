import { describe, it, expect } from 'vitest';
import { SfxDirector } from '@/presentation/sfx-director';
import type { MusicBackend, NoteEvent } from '@/presentation/music-backend';

class FakeBackend implements MusicBackend {
  t = 2;
  started = true;
  notes: NoteEvent[] = [];
  programs: Record<number, number> = {};
  now(): number { return this.t; }
  ensureStarted(): void {}
  setProgram(c: number, p: number): void { this.programs[c] = p; }
  scheduleNote(ev: NoteEvent): void { this.notes.push(ev); }
  setMasterVolume(): void {}
  setMuted(): void {}
  dispose(): void {}
}

describe('SfxDirector', () => {
  it('schedules a stinger for a known event, on reserved channels (6–8)', () => {
    const b = new FakeBackend();
    new SfxDirector(b).playFor('omen');
    expect(b.notes.length).toBeGreaterThan(0);
    for (const n of b.notes) {
      expect(n.channel).toBeGreaterThanOrEqual(6);
      expect(n.channel).toBeLessThanOrEqual(8);
      expect(n.startSec).toBeGreaterThanOrEqual(b.t); // scheduled in the future
    }
  });

  it('sets GM programs on the sfx channels exactly once', () => {
    const b = new FakeBackend();
    const sfx = new SfxDirector(b);
    sfx.playFor('miracle');
    const after1 = { ...b.programs };
    expect(Object.keys(after1).length).toBe(3);
    b.programs = {}; // would be repopulated if it set again
    sfx.playFor('smite');
    expect(Object.keys(b.programs).length).toBe(0);
  });

  it('does nothing for unmapped events', () => {
    const b = new FakeBackend();
    new SfxDirector(b).playFor('world_seeded');
    expect(b.notes).toEqual([]);
  });

  it('stays silent while the audio clock is suspended (now=0)', () => {
    const b = new FakeBackend();
    b.t = 0;
    new SfxDirector(b).playFor('smite');
    expect(b.notes).toEqual([]);
  });

  it('a smite is a low, loud crack', () => {
    const b = new FakeBackend();
    new SfxDirector(b).playFor('smite');
    const loudLow = b.notes.find((n) => n.midi <= 40 && n.velocity >= 90);
    expect(loudLow).toBeTruthy();
  });
});
