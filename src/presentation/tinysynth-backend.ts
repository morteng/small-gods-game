/**
 * TinySynthBackend — the first concrete {@link MusicBackend}, wrapping
 * g200kg/webaudio-tinysynth: a ~50KB zero-asset General-MIDI synth. The GM
 * timbre is embraced as folk/chiptune pixel-art identity (design doc §3).
 *
 * Browser-only. The library is **dynamically imported** inside {@link ensureStarted}
 * so it never loads under Node/vitest (it touches `window`/`customElements` at
 * eval time) and never costs anything until music is actually wanted. We give it
 * our OWN AudioContext + master GainNode so we control volume, muting, and the
 * gesture-gated resume — the synth's internal output just feeds our gain node.
 */
import type { MusicBackend, NoteEvent } from './music-backend';

/** The slice of the webaudio-tinysynth API we drive. */
interface TinySynth {
  setAudioContext(ctx: BaseAudioContext, dest?: AudioNode): void;
  setProgram(channel: number, program: number): void;
  setReverbLev(v: number): void;
  noteOn(channel: number, note: number, velocity: number, when: number): void;
  noteOff(channel: number, note: number, when: number): void;
}

export class TinySynthBackend implements MusicBackend {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private synth: TinySynth | null = null;
  private starting: Promise<void> | null = null;
  private volume = 0.35;
  private muted = false;
  started = false;

  now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  ensureStarted(): Promise<void> {
    if (this.started) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.boot().catch((err) => {
      console.warn('[music] tinysynth backend failed to start:', err);
      this.starting = null;
    });
    return this.starting;
  }

  private async boot(): Promise<void> {
    if (typeof window === 'undefined') return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    master.connect(ctx.destination);

    // Dynamic import keeps the lib (and its window/customElements touches) out of
    // the static graph and tests. The default export is the synth class (CJS).
    const mod = (await import('webaudio-tinysynth')) as unknown as { default: new (opt: object) => TinySynth };
    const Synth = mod.default ?? (mod as unknown as new (opt: object) => TinySynth);

    // The lib logs "internalcontext:"/"TSDiff:" on init — hush it so boot stays clean.
    const realLog = console.log;
    console.log = () => {};
    let synth: TinySynth;
    try {
      synth = new Synth({ internalcontext: 0, useReverb: 1, voices: 48 });
      synth.setAudioContext(ctx, master);
    } finally {
      console.log = realLog;
    }
    synth.setReverbLev(0.9);

    // Resume requires a user gesture; if still suspended the caller wires a
    // one-shot pointer handler (see PresentationDirector). Try anyway.
    try { await ctx.resume(); } catch { /* stays suspended until a gesture */ }

    this.ctx = ctx;
    this.master = master;
    this.synth = synth;
    this.started = ctx.state === 'running';
  }

  setProgram(channel: number, gmProgram: number): void {
    this.synth?.setProgram(channel, gmProgram);
  }

  scheduleNote(ev: NoteEvent): void {
    const synth = this.synth;
    const ctx = this.ctx;
    if (!synth || !ctx) return;
    // Re-check the clock: resume may have completed after boot returned.
    if (ctx.state !== 'running') { this.started = false; return; }
    this.started = true;
    const start = Math.max(ev.startSec, ctx.currentTime);
    synth.noteOn(ev.channel, ev.midi, ev.velocity, start);
    synth.noteOff(ev.channel, ev.midi, start + ev.durationSec);
  }

  setMasterVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  dispose(): void {
    this.synth = null;
    this.master?.disconnect();
    this.master = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.started = false;
    this.starting = null;
  }
}
