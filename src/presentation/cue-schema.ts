/**
 * Cue validation — the trust boundary for cues that did NOT come from the
 * hand-authored TS base set: Composer (LLM) output at author-time and committed
 * JSON loaded at runtime. Both are untrusted shapes, so they pass through here.
 * Invalid cues are dropped (returns null), never crash playback — mirroring the
 * story system's "a bad slot falls back, never desyncs" discipline.
 */
import type { MusicCue, CueNote, VoiceName, CueRole } from './cue-types';

const VOICES: ReadonlySet<string> = new Set<VoiceName>(['pad', 'bass', 'pluck', 'bell', 'lead', 'choir']);
const ROLES: ReadonlySet<string> = new Set<CueRole>(['bed', 'stinger', 'swell', 'leitmotif']);

function num(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

function validateNote(o: unknown): CueNote | null {
  if (!o || typeof o !== 'object') return null;
  const n = o as Record<string, unknown>;
  if (typeof n.voice !== 'string' || !VOICES.has(n.voice)) return null;
  const midi = num(n.midi, 0, 127);
  const atBeat = num(n.atBeat, 0, 256);
  const durBeats = num(n.durBeats, 0, 256);
  const vel = num(n.vel, 0, 127);
  if (midi === null || atBeat === null || durBeats === null || vel === null) return null;
  return { voice: n.voice as VoiceName, midi, atBeat, durBeats, vel };
}

function validateRange(o: unknown): [number, number] | undefined {
  if (!Array.isArray(o) || o.length !== 2) return undefined;
  const a = num(o[0], 0, 1), b = num(o[1], 0, 1);
  return a === null || b === null ? undefined : [Math.min(a, b), Math.max(a, b)];
}

/** Validate one untrusted cue object → a MusicCue, or null if malformed. */
export function validateCue(o: unknown): MusicCue | null {
  if (!o || typeof o !== 'object') return null;
  const c = o as Record<string, unknown>;
  if (typeof c.id !== 'string' || !c.id) return null;
  if (typeof c.role !== 'string' || !ROLES.has(c.role)) return null;
  const bpm = num(c.bpm, 20, 300);
  const bars = num(c.bars, 0.25, 64);
  if (bpm === null || bars === null) return null;
  if (typeof c.loop !== 'boolean') return null;
  if (!Array.isArray(c.notes)) return null;

  const notes: CueNote[] = [];
  for (const raw of c.notes) {
    const n = validateNote(raw);
    if (!n) return null; // a malformed note invalidates the whole cue
    notes.push(n);
  }

  const cue: MusicCue = { id: c.id, role: c.role as CueRole, bpm, bars, loop: c.loop, notes };

  const bpb = num(c.beatsPerBar, 1, 32);
  if (bpb !== null) cue.beatsPerBar = bpb;
  if (Array.isArray(c.tags) && c.tags.every((t) => typeof t === 'string')) cue.tags = c.tags as string[];
  if (typeof c.themeKey === 'string') cue.themeKey = c.themeKey;
  if (c.transition === 'crossfade' || c.transition === 'cut') cue.transition = c.transition;
  const gain = num(c.gain, 0, 1);
  if (gain !== null) cue.gain = gain;
  if (c.mood && typeof c.mood === 'object') {
    const m = c.mood as Record<string, unknown>;
    const mood: NonNullable<MusicCue['mood']> = {};
    const t = validateRange(m.tension); if (t) mood.tension = t;
    const r = validateRange(m.reverence); if (r) mood.reverence = r;
    const l = validateRange(m.liveliness); if (l) mood.liveliness = l;
    if (t || r || l) cue.mood = mood;
  }
  return cue;
}

/**
 * Validate a cue PACK — `{ cues: [...] }` or a bare array — returning only the
 * cues that validate (silently dropping bad ones; the caller logs the count).
 */
export function validateCuePack(o: unknown): MusicCue[] {
  const arr = Array.isArray(o) ? o : (o as { cues?: unknown })?.cues;
  if (!Array.isArray(arr)) return [];
  const out: MusicCue[] = [];
  for (const raw of arr) {
    const cue = validateCue(raw);
    if (cue) out.push(cue);
  }
  return out;
}
