/**
 * VoiceDirector — optional spoken narration over the browser's built-in
 * SpeechSynthesis (design doc §4, slice P-E). Serverless / BYOK-friendly (no
 * API, no audio assets), but the timbre is robotic, so it is OPT-IN (default
 * off) and easy to silence. It speaks the opening line of a story card; one
 * utterance at a time, cancellable.
 *
 * Browser-guarded — a no-op anywhere `speechSynthesis` is absent (Node/SSR).
 */
const STORAGE_KEY = 'small-gods-voice';

export interface VoiceDirectorOptions {
  enabled?: boolean;
}

export class VoiceDirector {
  private enabled: boolean;
  private voice: SpeechSynthesisVoice | null = null;

  constructor(opts: VoiceDirectorOptions = {}) {
    this.enabled = opts.enabled ?? loadEnabled();
  }

  isEnabled(): boolean { return this.enabled; }

  setEnabled(on: boolean): void {
    this.enabled = on;
    saveEnabled(on);
    if (!on) this.cancel();
  }

  /** Speak `text` (cancelling anything in flight). No-op unless enabled. */
  speak(text: string): void {
    if (!this.enabled || !text) return;
    const synth = this.synth();
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 0.9;
    u.volume = 0.9;
    const v = this.pickVoice(synth);
    if (v) u.voice = v;
    synth.speak(u);
  }

  cancel(): void {
    this.synth()?.cancel();
  }

  private synth(): SpeechSynthesis | null {
    return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  }

  /** Prefer a stable English voice; cache it (voices load async). */
  private pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
    if (this.voice) return this.voice;
    const voices = synth.getVoices();
    if (!voices.length) return null;
    this.voice = voices.find((v) => /en[-_]/i.test(v.lang) && v.localService)
      ?? voices.find((v) => /^en/i.test(v.lang))
      ?? voices[0];
    return this.voice;
  }
}

function loadEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

function saveEnabled(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
