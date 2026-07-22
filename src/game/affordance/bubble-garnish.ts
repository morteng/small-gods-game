// src/game/affordance/bubble-garnish.ts
//
// "A Town You Can Watch", Phase 3c: the OPTIONAL LLM garnish for speech bubbles.
//
// The deterministic producer (describeEncounterLine) always runs first — free,
// instant, offline. This module reroutes JUST the line the player is actively
// watching (soul band, on the selected soul's conversations) through the fast
// chat tier for a one-off in-character rewording, then slots the reworded text
// into the SAME live bubble. The deterministic line is the always-on fallback:
// if no LLM is configured, the throttle is spent, or the call fails, the player
// simply keeps the template line and nothing is spent.
//
// The load-bearing piece is GarnishThrottle — a REAL budget throttle. CLAUDE.md
// notes CostTracker only MEASURES spend; it never throttles. So garnish spend is
// bounded here, independently, by three hard limits: a per-session USD cap, a
// minimum interval between calls, and a single-in-flight lock. Presentation-only
// (no sim), so wall-clock ms is fine — determinism rules apply to src/sim/ alone.

import type { NpcNeeds, Relationship } from '@/core/types';

/** Longest reworded line we accept — a bubble, not a speech. Matched to the
 *  deterministic tables' one-clause length so garnish never blows the layout. */
export const GARNISH_MAX_CHARS = 46;

/** Default per-session spend ceiling for bubble garnish (USD). Chat-tier lines
 *  are a few dozen tokens each, so this is hundreds of rewordings — but it is a
 *  HARD stop, independent of the building-art cap, so a long spectate session
 *  can never quietly run up a bill. */
export const GARNISH_SESSION_CAP_USD = 0.05;

/** Minimum real ms between garnish calls. A busy well fires many encounters a
 *  second; we reword at most one every this-many-ms so the town reads as alive
 *  without a burst of requests. */
export const GARNISH_MIN_INTERVAL_MS = 2500;

/**
 * A real budget throttle for the LLM bubble garnish — three hard bounds:
 *   • a single in-flight call (no pile-ups while one is pending),
 *   • a minimum interval between calls (rate limit), and
 *   • a per-session USD cap (spend stops dead once reached).
 * Spend is fed back in via end() from each call's reported cost, so the cap
 * tracks REAL money, not a guess. Pure bookkeeping; wall-clock ms passed in.
 */
export class GarnishThrottle {
  private spentUsd = 0;
  private lastAtMs = -Infinity;
  private inFlight = false;

  constructor(
    private readonly capUsd = GARNISH_SESSION_CAP_USD,
    private readonly minIntervalMs = GARNISH_MIN_INTERVAL_MS,
  ) {}

  /** May a garnish call start now? False if one is in flight, the rate interval
   *  hasn't elapsed, or the session cap is reached. */
  canGarnish(nowMs: number): boolean {
    return !this.inFlight
      && this.spentUsd < this.capUsd
      && nowMs - this.lastAtMs >= this.minIntervalMs;
  }

  /** Mark a call as started — take the in-flight lock and stamp the rate clock
   *  from the START of the call (so latency never lets a burst slip through). */
  begin(nowMs: number): void {
    this.inFlight = true;
    this.lastAtMs = nowMs;
  }

  /** Mark the in-flight call done and bank its cost against the session cap. */
  end(costUsd = 0): void {
    this.inFlight = false;
    if (costUsd > 0) this.spentUsd += costUsd;
  }

  /** Session spend so far (USD) — telemetry / tests. */
  get spent(): number {
    return this.spentUsd;
  }
}

/** Everything the prompt needs to voice a rewording. Pure data (built from the
 *  speaker's NpcProperties in the Game), so this module stays sim-free. */
export interface GarnishInput {
  speakerName: string;
  /** The speaker's role, e.g. 'farmer' — light occupational colour. */
  role: string;
  warm: boolean;
  relType: Relationship['type'];
  partnerName: string;
  /** The need grinding on the speaker (their lowest, if it crossed the worry
   *  floor), else null — lets the model colour the line with the same worry the
   *  deterministic producer chose. */
  worry: keyof NpcNeeds | null;
  /** The deterministic line — the SEED the model rewords (and the fallback). */
  baseLine: string;
}

const WORRY_HINT: Record<keyof NpcNeeds, string> = {
  safety: 'They feel unsafe.',
  prosperity: 'Money is tight for them.',
  community: 'They feel lonely.',
  meaning: 'They are questioning their purpose.',
};

/**
 * Build the two-message prompt for a one-off rewording. Deliberately tiny (the
 * seed line carries the meaning; we only ask for fresh phrasing) and it hard-
 * constrains the output shape — one short ASCII line — so sanitizeGarnish rarely
 * has to fall back.
 */
export function buildGarnishPrompt(input: GarnishInput): { system: string; user: string } {
  const system =
    'You reword ONE line of spoken dialogue for a common villager in a medieval ' +
    'fantasy god-game. Reply with ONLY the reworded line the person says aloud: ' +
    `one short clause, at most ${GARNISH_MAX_CHARS} characters, plain ASCII (no ` +
    'quotation marks, no emoji, no accented letters, no dashes). Keep the meaning ' +
    'and mood of the seed line. Do not add narration, names, or stage directions.';

  const mood = input.warm ? 'friendly' : 'prickly and short';
  const worryLine = input.worry ? ` ${WORRY_HINT[input.worry]}` : '';
  const user =
    `${input.speakerName}, a ${input.role}, speaks to ${input.partnerName} ` +
    `(their ${input.relType}). Tone: ${mood}.${worryLine}\n` +
    `Seed line: ${input.baseLine}\n` +
    'Reworded line:';

  return { system, user };
}

/**
 * Coerce a raw model reply into a single safe bubble line, or return `fallback`
 * (the deterministic line) when the reply is unusable. Enforces the UI pixel
 * font's hard constraint — ASCII only; curly quotes / em-dashes render as blanks
 * — plus one-line and length limits. Never throws.
 */
export function sanitizeGarnish(raw: string, fallback: string): string {
  if (!raw) return fallback;
  // First non-empty line only (models sometimes add a stray blank or second line).
  let s = raw.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
  // Strip wrapping quotes/backticks the model may add around the line.
  s = s.replace(/^['"`]+/, '').replace(/['"`]+$/, '').trim();
  // Normalise common non-ASCII punctuation to ASCII before the hard filter, so a
  // good line with a curly apostrophe survives instead of losing a character.
  s = s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...');
  // Drop anything still outside printable ASCII.
  s = s.replace(/[^\x20-\x7E]/g, '').trim();
  if (!s) return fallback;
  if (s.length > GARNISH_MAX_CHARS) {
    // Clamp on a word boundary where possible, else hard-cut; trailing punctuation
    // tidied so we never end on a lone comma/space.
    const cut = s.slice(0, GARNISH_MAX_CHARS);
    const sp = cut.lastIndexOf(' ');
    s = (sp > GARNISH_MAX_CHARS * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:-]+$/, '').trim();
  }
  return s.length > 0 ? s : fallback;
}
