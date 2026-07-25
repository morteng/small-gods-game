import { describe, it, expect, afterEach } from 'vitest';
import { installUiCues, uninstallUiCues, uiTick, uiConfirm } from '@/presentation/ui-cues';
import type { MusicBackend, NoteEvent } from '@/presentation/music-backend';

class FakeBackend implements MusicBackend {
  clock = 0; // 0 = suspended/pre-gesture, matching the real backend's now()===0 convention
  started = false;
  notes: NoteEvent[] = [];
  programs: Record<number, number> = {};
  now(): number { return this.clock; }
  ensureStarted(): void {}
  setProgram(c: number, p: number): void { this.programs[c] = p; }
  scheduleNote(ev: NoteEvent): void { this.notes.push(ev); }
  setMasterVolume(): void {}
  setMuted(): void {}
  setMusicVolume(): void {}
  setSfxVolume(): void {}
  setMusicMuted(): void {}
  setSfxMuted(): void {}
  dispose(): void {}
}

describe('ui-cues — autoplay contract', () => {
  afterEach(() => uninstallUiCues());

  it('uiTick()/uiConfirm() before install() are silent no-ops, never throw', () => {
    expect(() => { uiTick(); uiConfirm(); }).not.toThrow();
  });

  it('a cue fired before the first gesture (now()<=0) is dropped, not queued', () => {
    const b = new FakeBackend();
    b.clock = 0; // pre-gesture
    installUiCues(b);
    uiTick();
    uiConfirm();
    expect(b.notes).toEqual([]);
    // Advancing the clock later does NOT flush a queued burst — nothing was queued.
    b.clock = 5;
    expect(b.notes).toEqual([]);
  });

  it('works after the gesture unlocks the clock (now()>0)', () => {
    const b = new FakeBackend();
    b.clock = 3;
    installUiCues(b);
    uiTick();
    expect(b.notes.length).toBeGreaterThan(0);
    expect(b.notes.every((n) => n.channel === 9)).toBe(true);
  });

  it('uninstallUiCues() reverts to silent no-ops', () => {
    const b = new FakeBackend();
    b.clock = 3;
    installUiCues(b);
    uninstallUiCues();
    uiTick();
    expect(b.notes).toEqual([]);
  });
});

describe('ui-cues — tick vs confirm', () => {
  afterEach(() => uninstallUiCues());

  it('confirm is distinguishable from tick (more notes — "slightly warmer")', () => {
    const bTick = new FakeBackend();
    bTick.clock = 1;
    installUiCues(bTick);
    uiTick();
    const tickNotes = bTick.notes.length;

    const bConfirm = new FakeBackend();
    bConfirm.clock = 1;
    installUiCues(bConfirm);
    uiConfirm();
    const confirmNotes = bConfirm.notes.length;

    expect(confirmNotes).toBeGreaterThan(tickNotes);
  });

  it('sets the GM program on channel 9 exactly once across repeated calls', () => {
    const b = new FakeBackend();
    b.clock = 1;
    installUiCues(b);
    uiTick();
    uiTick();
    uiConfirm();
    expect(Object.keys(b.programs)).toEqual(['9']);
  });
});
