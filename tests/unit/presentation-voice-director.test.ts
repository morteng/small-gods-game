import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VoiceDirector } from '@/presentation/voice-director';

// jsdom has no Web Speech API — install a minimal stub.
class FakeUtterance {
  text: string;
  rate = 1; pitch = 1; volume = 1;
  voice: unknown = null;
  constructor(text: string) { this.text = text; }
}

interface SpynSynth { spoken: string[]; cancels: number; speak: (u: FakeUtterance) => void; cancel: () => void; getVoices: () => unknown[] }

function installSynth(): SpynSynth {
  const synth: SpynSynth = {
    spoken: [], cancels: 0,
    speak(u) { this.spoken.push(u.text); },
    cancel() { this.cancels++; },
    getVoices() { return [{ lang: 'en-US', localService: true, name: 'Test' }]; },
  };
  (globalThis as unknown as { speechSynthesis: unknown; SpeechSynthesisUtterance: unknown }).speechSynthesis = synth;
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;
  return synth;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('VoiceDirector', () => {
  it('is opt-in: speaks nothing when disabled (the default)', () => {
    const synth = installSynth();
    const v = new VoiceDirector();
    expect(v.isEnabled()).toBe(false);
    v.speak('Hello, mortal.');
    expect(synth.spoken).toEqual([]);
  });

  it('speaks once enabled, cancelling anything in flight first', () => {
    const synth = installSynth();
    const v = new VoiceDirector({ enabled: true });
    v.speak('A sign in the clouds.');
    expect(synth.spoken).toEqual(['A sign in the clouds.']);
    expect(synth.cancels).toBeGreaterThanOrEqual(1);
  });

  it('ignores empty text', () => {
    const synth = installSynth();
    const v = new VoiceDirector({ enabled: true });
    v.speak('');
    expect(synth.spoken).toEqual([]);
  });

  it('setEnabled persists and cancels on disable', () => {
    const synth = installSynth();
    const v = new VoiceDirector({ enabled: true });
    v.setEnabled(false);
    expect(localStorage.getItem('small-gods-voice')).toBe('0');
    expect(synth.cancels).toBeGreaterThanOrEqual(1);
    v.speak('quiet');
    expect(synth.spoken).toEqual([]);
  });

  it('no-ops gracefully when the Speech API is absent', () => {
    delete (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    const v = new VoiceDirector({ enabled: true });
    expect(() => v.speak('into the void')).not.toThrow();
  });
});
