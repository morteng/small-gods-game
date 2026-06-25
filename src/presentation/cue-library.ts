/**
 * CueLibrary — the queryable store of {@link MusicCue}s the sequencer draws from.
 * Holds the hand-authored base set (M-0) and is extensible with Composer-produced
 * cues (M-2 author-time JSON, M-3 on-demand). All lookups are deterministic — no
 * RNG, stable tie-breaks — so the same world feels the same each play.
 */
import type { MusicCue, MoodRange } from './cue-types';
import { BASE_CUES } from './cues/base-cues';

export interface CueMood {
  tension: number;
  reverence: number;
  liveliness: number;
}

export class CueLibrary {
  private readonly byId = new Map<string, MusicCue>();

  constructor(cues: readonly MusicCue[] = BASE_CUES) {
    this.add(cues);
  }

  /** Merge cues in; a later cue with the same id REPLACES an earlier one. */
  add(cues: readonly MusicCue[]): void {
    for (const c of cues) this.byId.set(c.id, c);
  }

  get(id: string): MusicCue | undefined {
    return this.byId.get(id);
  }

  all(): MusicCue[] {
    return [...this.byId.values()];
  }

  /**
   * Pick the bed for a mood, or null → SILENCE. A bed is eligible only if the
   * mood falls inside every specified axis. Among eligible beds the MOST SPECIFIC
   * wins (narrowest total mood window), so a focused "miracle" bed beats a broad
   * one; ties break on id for determinism.
   */
  eligibleBed(mood: CueMood): MusicCue | null {
    let best: MusicCue | null = null;
    let bestWidth = Infinity;
    for (const c of this.byId.values()) {
      if (c.role !== 'bed') continue;
      if (!moodMatches(c.mood, mood)) continue;
      const width = moodWidth(c.mood);
      if (width < bestWidth || (width === bestWidth && (!best || c.id < best.id))) {
        best = c;
        bestWidth = width;
      }
    }
    return best;
  }

  /** First cue (by id order) carrying `tag`, optionally constrained to a role. */
  byTag(tag: string, role?: MusicCue['role']): MusicCue | null {
    const matches: MusicCue[] = [];
    for (const c of this.byId.values()) {
      if (role && c.role !== role) continue;
      if (c.tags?.includes(tag)) matches.push(c);
    }
    matches.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return matches[0] ?? null;
  }

  /** Authored leitmotif for a theme key, or null (caller may synth a fallback). */
  leitmotif(themeKey: string): MusicCue | null {
    for (const c of this.byId.values()) {
      if (c.role === 'leitmotif' && c.themeKey === themeKey) return c;
    }
    return null;
  }
}

function within(range: MoodRange | undefined, v: number): boolean {
  return !range || (v >= range[0] && v <= range[1]);
}

function moodMatches(m: MusicCue['mood'], mood: CueMood): boolean {
  if (!m) return true;
  return (
    within(m.tension, mood.tension) &&
    within(m.reverence, mood.reverence) &&
    within(m.liveliness, mood.liveliness)
  );
}

/** Total constrained-axis width; unconstrained axes count as their full 0..1. */
function moodWidth(m: MusicCue['mood']): number {
  if (!m) return 3;
  const w = (r: MoodRange | undefined) => (r ? r[1] - r[0] : 1);
  return w(m.tension) + w(m.reverence) + w(m.liveliness);
}
