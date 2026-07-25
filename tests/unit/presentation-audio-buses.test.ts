import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MUSIC_CHANNELS, SFX_CHANNELS, toCc7, applyBusVolume, type ChannelVolumeTarget } from '@/presentation/audio-buses';

describe('audio-buses — toCc7', () => {
  it('maps 0..1 linearly onto 0..127, clamping out-of-range input', () => {
    expect(toCc7(0)).toBe(0);
    expect(toCc7(1)).toBe(127);
    expect(toCc7(0.5)).toBe(64); // round(63.5) → 64
    expect(toCc7(-3)).toBe(0);
    expect(toCc7(3)).toBe(127);
  });
});

describe('audio-buses — applyBusVolume (the CC7 mechanism, see module header)', () => {
  it('calls setChVol on every channel in the group, and none outside it', () => {
    const calls: Array<{ ch: number; v: number; t: number | undefined }> = [];
    const synth: ChannelVolumeTarget = { setChVol: (ch, v, t) => calls.push({ ch, v, t }) };
    applyBusVolume(synth, MUSIC_CHANNELS, 0.5, false);
    expect(calls.map((c) => c.ch).sort((a, b) => a - b)).toEqual([...MUSIC_CHANNELS]);
    expect(calls.every((c) => c.v === toCc7(0.5))).toBe(true);
  });

  it('mute forces CC7 to 0 regardless of volume', () => {
    const calls: Array<{ ch: number; v: number }> = [];
    const synth: ChannelVolumeTarget = { setChVol: (ch, v) => calls.push({ ch, v }) };
    applyBusVolume(synth, SFX_CHANNELS, 0.9, true);
    expect(calls.every((c) => c.v === 0)).toBe(true);
  });

  it('music and sfx channel groups never overlap', () => {
    const musicSet = new Set<number>(MUSIC_CHANNELS);
    for (const ch of SFX_CHANNELS) expect(musicSet.has(ch)).toBe(false);
  });
});

// — TinySynthBackend integration: verify the ACTUAL mechanism is wired, not
// just the pure helper. jsdom has no Web Audio API, so both the AudioContext
// and the 'webaudio-tinysynth' module are stubbed; we drive the REAL boot()
// path and assert on the stub's captured setChVol calls. —————————————————

interface ChVolCall { ch: number; v: number; t: number | undefined }
let chVolCalls: ChVolCall[];

class FakeGain {
  gain = { value: 1 };
  connect(): void {}
  disconnect(): void {}
}

class FakeAudioContext {
  currentTime = 0;
  state: 'running' | 'suspended' = 'running';
  destination = {};
  createGain(): FakeGain { return new FakeGain(); }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  close(): Promise<void> { return Promise.resolve(); }
}

class FakeTinySynth {
  setAudioContext(): void {}
  setProgram(): void {}
  setReverbLev(): void {}
  setChVol(ch: number, v: number, t?: number): void { chVolCalls.push({ ch, v, t }); }
  noteOn(): void {}
  noteOff(): void {}
}

vi.mock('webaudio-tinysynth', () => ({ default: FakeTinySynth }));

describe('TinySynthBackend — the SFX bus wired end-to-end', () => {
  beforeEach(() => {
    chVolCalls = [];
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  });
  afterEach(() => {
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it('setMusicVolume touches only channels 0-5; setSfxVolume touches only 6-9', async () => {
    const { TinySynthBackend } = await import('@/presentation/tinysynth-backend');
    const b = new TinySynthBackend();
    await b.ensureStarted();
    expect(b.started).toBe(true);
    chVolCalls = []; // clear boot-time bus application
    const musicSet: readonly number[] = MUSIC_CHANNELS;

    b.setMusicVolume(0.5);
    expect(chVolCalls.every((c) => musicSet.includes(c.ch))).toBe(true);
    expect(chVolCalls.map((c) => c.ch).sort((a, x) => a - x)).toEqual([...MUSIC_CHANNELS]);
    expect(chVolCalls.every((c) => c.v === toCc7(0.5))).toBe(true);

    chVolCalls = [];
    b.setSfxVolume(0.2);
    expect(chVolCalls.map((c) => c.ch).sort((a, x) => a - x)).toEqual([...SFX_CHANNELS]);
    expect(chVolCalls.every((c) => c.v === toCc7(0.2))).toBe(true);
  });

  it('muting SFX leaves music untouched, and vice versa (independent buses)', async () => {
    const { TinySynthBackend } = await import('@/presentation/tinysynth-backend');
    const b = new TinySynthBackend();
    await b.ensureStarted();
    b.setMusicVolume(0.8);
    b.setSfxVolume(0.8);
    chVolCalls = [];

    b.setSfxMuted(true);
    // Only SFX channels were touched, and all forced to 0.
    expect(chVolCalls.map((c) => c.ch).sort((a, x) => a - x)).toEqual([...SFX_CHANNELS]);
    expect(chVolCalls.every((c) => c.v === 0)).toBe(true);

    chVolCalls = [];
    b.setMusicVolume(0.3); // music still fully controllable while sfx is muted
    expect(chVolCalls.map((c) => c.ch).sort((a, x) => a - x)).toEqual([...MUSIC_CHANNELS]);
    expect(chVolCalls.every((c) => c.v === toCc7(0.3))).toBe(true);

    chVolCalls = [];
    b.setMusicMuted(true);
    expect(chVolCalls.map((c) => c.ch).sort((a, x) => a - x)).toEqual([...MUSIC_CHANNELS]);
    expect(chVolCalls.every((c) => c.v === 0)).toBe(true);
    // SFX bus (still muted from earlier) wasn't touched by the music mute call.
    chVolCalls = [];
  });

  it('setMusicVolume/setSfxVolume before boot completes are safe no-ops (no synth yet)', async () => {
    const { TinySynthBackend } = await import('@/presentation/tinysynth-backend');
    const b = new TinySynthBackend();
    expect(() => { b.setMusicVolume(0.5); b.setSfxVolume(0.5); }).not.toThrow();
    expect(chVolCalls).toEqual([]);
  });
});
