/**
 * CueComposer — the LLM "Composer" seam. Turns cue specs into validated
 * {@link MusicCue}s, at author-time (the seed script) or on demand (M-3 warm).
 * Mirrors the story system's StoryAgent: ADVISORY and determinism-safe — it
 * never sits in the hot path, and any failure (no key, bad JSON, network) yields
 * null/[] so the caller falls back to the hand-authored base set / synth motif.
 */
import type { LLMProvider } from '@/llm/llm-client';
import type { MusicCue } from '../cue-types';
import { validateCue, validateCuePack } from '../cue-schema';
import { COMPOSER_SYSTEM, composerUserPrompt, type CueSpec } from './cue-prompt';

export interface CueComposer {
  /** Compose a batch of cues (author-time library seeding). */
  composeLibrary(specs: CueSpec[]): Promise<MusicCue[]>;
  /** Compose a single leitmotif for a theme key, or null on any failure. */
  composeLeitmotif(themeKey: string, hint?: string): Promise<MusicCue | null>;
}

export interface LlmCueComposerOptions {
  /** Capable-tier model id (e.g. DEFAULT_CAPABLE_MODEL). */
  model?: string;
  /** Lower = steadier; cues want some character, so a touch of warmth. */
  temperature?: number;
}

export class LlmCueComposer implements CueComposer {
  constructor(
    private readonly provider: LLMProvider,
    private readonly opts: LlmCueComposerOptions = {},
  ) {}

  async composeLibrary(specs: CueSpec[]): Promise<MusicCue[]> {
    // Scale the output budget to the batch — a full bed/swell is a few hundred
    // tokens of notes, so 6 cues need headroom well past the single-cue default.
    const parsed = await this.ask(composerUserPrompt(specs), 800 + specs.length * 700);
    if (!parsed) return [];
    // Keep only cues whose id was actually requested (the model can hallucinate).
    const wanted = new Set(specs.map((s) => s.id));
    return validateCuePack(parsed).filter((c) => wanted.has(c.id));
  }

  async composeLeitmotif(themeKey: string, hint?: string): Promise<MusicCue | null> {
    const id = `leitmotif:${themeKey}`;
    const spec: CueSpec = {
      id, role: 'leitmotif', themeKey,
      intent: hint ?? `a short, recognizable motif for "${themeKey}"`,
    };
    const parsed = await this.ask(composerUserPrompt([spec]));
    if (!parsed) return null;
    const cue = validateCuePack(parsed).find((c) => c.id === id) ?? null;
    if (!cue) return null;
    // Force identity so a mislabelled cue still files under the right theme.
    return { ...cue, id, role: 'leitmotif', themeKey };
  }

  /** Single LLM round-trip → parsed JSON object, or null on any failure. */
  private async ask(user: string, maxTokens = 1500): Promise<unknown | null> {
    if (!this.provider.isAvailable()) return null;
    try {
      const res = await this.provider.generate(
        [
          { role: 'system', content: COMPOSER_SYSTEM },
          { role: 'user', content: user },
        ],
        { model: this.opts.model, temperature: this.opts.temperature ?? 0.7, maxTokens },
      );
      return res.parsed ?? safeJson(res.content);
    } catch {
      return null;
    }
  }
}

/** A composer that always declines — the default when on-demand is OFF. */
export class NullCueComposer implements CueComposer {
  async composeLibrary(_specs: CueSpec[]): Promise<MusicCue[]> { return []; }
  async composeLeitmotif(_themeKey: string, _hint?: string): Promise<MusicCue | null> { return null; }
}

function safeJson(text: string): unknown | null {
  // Tolerate stray prose/markdown fences around the JSON object.
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export { validateCue };
