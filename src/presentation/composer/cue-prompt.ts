/**
 * Composer prompts — turn a cue SPEC (role + dramatic intent) into the MusicCue
 * JSON contract. Kept compact; the model writes short, consonant, gentle cues
 * (the score sits UNDER play). Output is validated downstream (cue-schema), so
 * the prompt optimises for "mostly right" rather than "trusted".
 */
import type { CueRole } from '../cue-types';

/** What the Composer should write — a slot the LLM fills with notes. */
export interface CueSpec {
  id: string;
  role: CueRole;
  /** Plain-language brief: the feeling/scene this cue scores. */
  intent: string;
  tags?: string[];
  themeKey?: string;
  mood?: { tension?: [number, number]; reverence?: [number, number]; liveliness?: [number, number] };
}

export const COMPOSER_SYSTEM = [
  'You are a game composer writing SHORT adaptive music cues for a quiet, folk/pixel god-game.',
  'Aesthetic: gentle, consonant, spacious — the score sits UNDER play and must never tire the listener.',
  'You output ONLY a JSON object: {"cues":[ MusicCue, ... ]}. No prose, no markdown fences.',
  '',
  'MusicCue = {',
  '  id: string,            // echo the requested id exactly',
  "  role: 'bed'|'swell'|'leitmotif'|'stinger',",
  '  bpm: number,           // 50–120',
  '  bars: number,          // 1–2 (keep cues short)',
  '  loop: boolean,         // true ONLY for beds',
  '  gain?: number,         // 0..1, ~0.7–0.9',
  '  notes: CueNote[],      // the composition',
  '  mood?, tags?, themeKey? // echo any provided',
  '}',
  "CueNote = { voice: 'pad'|'bass'|'pluck'|'bell'|'lead'|'choir', midi: 0-127, atBeat: number, durBeats: number, vel: 1-127 }",
  '',
  'Rules: keep velocities gentle (24–60). Stay consonant (major or minor pentatonic around one key).',
  'Beds loop and should breathe (leave space — silence is welcome). Voices: pad=warm sustain, bass=low pulse,',
  'pluck=music box, bell=chime, lead=flute melody, choir=swell. atBeat is beats from cue start (0-indexed).',
].join('\n');

/** Build the user message for a batch of specs. */
export function composerUserPrompt(specs: CueSpec[]): string {
  return [
    'Compose these cues. Echo each id exactly and honour the role/tags/themeKey/mood given.',
    '',
    JSON.stringify({ cues: specs }, null, 2),
  ].join('\n');
}
