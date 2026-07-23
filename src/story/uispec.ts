/**
 * UiSpec — the declarative card the WebGPU UI renders (agent-driven-UI, Tier-0).
 *
 * The first "structured spec, not open-ended HTML" surface (brainstorm Direction B):
 * a CLOSED, enumerated description of a card — title + a walk of body blocks +
 * terminal choices — that `renderUiSpec` (ui-runtime) lays out entirely on its own.
 * The card carries no scripting: each `Choice` pre-pairs an already-validated
 * `Command` from the capability set, so picking one just `bus.emit()`s it.
 *
 * Two-layer, the game's architecture in miniature (spec §3):
 *  - **Structure** is sim-owned, synchronous, deterministic — a builder composes the
 *    blocks + choices from sim numbers (see `game/affordance/whisper-card.ts`). It
 *    exists with or without an LLM, so it is replay-safe.
 *  - **Prose** may be LLM-enriched, warmed on focus — but the *rendered* spec holds
 *    resolved strings (never a live prompt), so replay re-presents stored text with
 *    zero model calls and every field has an authored fallback by construction.
 *
 * There is no WebGPU scroll or text-input yet, so a card must fit one screen:
 * `validateUiSpec` clamps to no-scroll budgets (same discipline as state-writeback
 * delta-clamping) rather than rejecting — an over-long spec degrades, never crashes.
 */
import type { Command } from '@/sim/command/types';

/** The kind of thought a mind-cloud token stands for — colours it in the render.
 *  `need` = a grinding want, `divine` = belief in what you command, `memory` = a
 *  remembered deed, `person` = someone they trust. */
export type CloudTone = 'need' | 'divine' | 'memory' | 'person';
const CLOUD_TONES = new Set<CloudTone>(['need', 'divine', 'memory', 'person']);

/** One weighted word in a mind cloud: `weight` (0–1) is its loudness (need
 *  urgency / memory salience / belief strength / trust), which the renderer maps
 *  to a size band + opacity. The layout is the renderer's job (blocks carry only
 *  content) — see `render/ui/mind-cloud-layout.ts`. */
export interface CloudToken { text: string; weight: number; tone: CloudTone; }

/** A single body element. The renderer owns ALL layout; blocks only carry content. */
export type UiSpecBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'npcLine'; who: string; text: string }
  /** A line the player (the god) whispered — the transcript's own-voice turn. */
  | { kind: 'playerLine'; text: string }
  | { kind: 'omen'; text: string }
  | { kind: 'divider' }
  | { kind: 'beliefBar'; label: string; value: number }
  /** B (mind-reading): the "second face" of PROBE MIND — a soul's preoccupations
   *  as one weighted cloud (size = the sim's real number). Gestalt, beside the
   *  inspector's exact-number rows. */
  | { kind: 'wordCloud'; tokens: CloudToken[] };

/** A terminal choice: display text + the pre-paired command it emits (+ a why-hint). */
export interface UiSpecChoice {
  text: string;
  command: Command;
  hint?: string;
}

/** A declarative card: title, a walk of body blocks, and terminal choices. */
export interface UiSpec {
  title: string;
  body: UiSpecBlock[];
  choices: UiSpecChoice[];
  /** Reuse the `StagedBeat.musicCue` vocabulary (optional). */
  musicCue?: string;
}

/** No-scroll budgets. A card must fit one screen (no WebGPU scroll/input yet). */
export const UISPEC_BUDGETS = {
  title: 48,
  blocks: 6,
  /** Per-text-bearing-block character cap (paragraph / npcLine / omen). */
  blockChars: 220,
  /** Speaker key cap on an npcLine. */
  whoChars: 32,
  /** Belief-bar label cap. */
  barLabelChars: 32,
  choices: 4,
  choiceChars: 72,
  hintChars: 40,
  /** Max words in a mind cloud (a legible gestalt, not a shouting match) + the
   *  per-token character cap (short thoughts read; long ones clutter). */
  cloudTokens: 16,
  cloudTokenChars: 24,
} as const;

/** Clamp a string to a max length, trimming trailing whitespace on a hard cut. */
function clampStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+$/, '');
}

/**
 * Clamp a spec to the no-scroll budgets — deterministic and total (never throws).
 * Over-long titles/blocks/choices are truncated; excess blocks/choices are dropped;
 * belief-bar values are clamped to 0–1. The result always fits one card. A spec with
 * no choices is still valid (a pure display card); callers decide if that's useful.
 */
export function validateUiSpec(spec: UiSpec): UiSpec {
  const body: UiSpecBlock[] = [];
  for (const b of spec.body) {
    if (body.length >= UISPEC_BUDGETS.blocks) break;
    body.push(clampBlock(b));
  }
  const choices: UiSpecChoice[] = [];
  for (const ch of spec.choices) {
    if (choices.length >= UISPEC_BUDGETS.choices) break;
    choices.push({
      text: clampStr(ch.text, UISPEC_BUDGETS.choiceChars),
      command: ch.command,
      ...(ch.hint != null ? { hint: clampStr(ch.hint, UISPEC_BUDGETS.hintChars) } : {}),
    });
  }
  return {
    title: clampStr(spec.title, UISPEC_BUDGETS.title),
    body,
    choices,
    ...(spec.musicCue != null ? { musicCue: spec.musicCue } : {}),
  };
}

function clampBlock(b: UiSpecBlock): UiSpecBlock {
  switch (b.kind) {
    case 'paragraph':
      return { kind: 'paragraph', text: clampStr(b.text, UISPEC_BUDGETS.blockChars) };
    case 'npcLine':
      return {
        kind: 'npcLine',
        who: clampStr(b.who, UISPEC_BUDGETS.whoChars),
        text: clampStr(b.text, UISPEC_BUDGETS.blockChars),
      };
    case 'playerLine':
      return { kind: 'playerLine', text: clampStr(b.text, UISPEC_BUDGETS.blockChars) };
    case 'omen':
      return { kind: 'omen', text: clampStr(b.text, UISPEC_BUDGETS.blockChars) };
    case 'divider':
      return { kind: 'divider' };
    case 'beliefBar':
      return {
        kind: 'beliefBar',
        label: clampStr(b.label, UISPEC_BUDGETS.barLabelChars),
        value: Math.max(0, Math.min(1, b.value)),
      };
    case 'wordCloud': {
      const tokens: CloudToken[] = [];
      for (const t of b.tokens) {
        if (tokens.length >= UISPEC_BUDGETS.cloudTokens) break;
        const text = clampStr(t.text, UISPEC_BUDGETS.cloudTokenChars);
        if (!text) continue;
        tokens.push({
          text,
          weight: Math.max(0, Math.min(1, t.weight)),
          tone: CLOUD_TONES.has(t.tone) ? t.tone : 'memory',
        });
      }
      return { kind: 'wordCloud', tokens };
    }
  }
}
