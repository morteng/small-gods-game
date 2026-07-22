// src/game/affordance/speech-bubbles.ts
//
// "A Town You Can Watch", Phase 3 (workstream C): real-time dialog bubbles.
// When the encounter sim (Phase 2) fires an `npc_encounter`, a short spoken line
// floats over the speaker's head for a few seconds — so a player watching the
// town SEES its people talk as they go about their day.
//
// Three pure pieces, no sim/LLM deps (trivially testable, like world-labels):
//   • SpeechBubbleStore — the transient presentation store (TTL'd lines keyed by
//     speaker). Presentation-only: lives on the Game, NOT the sim snapshot.
//   • describeEncounterLine — the always-on FREE producer: a deterministic line
//     from warmth × relationship × the speaker's dominant need. Stands alone with
//     no LLM (an optional garnish may later reword what the player is watching).
//   • buildSpeechBubbles — projects each live speaker position to device px per
//     frame (same idiom as buildWorldLabels), with a fade-in/out alpha.

import type { Camera, NpcNeeds, NpcPersonality, Relationship } from '@/core/types';
import { projectWorldAnchor } from '@/game/affordance/alert-pins';

/** How long a spoken line lingers before it has fully faded (real ms). */
export const BUBBLE_TTL_MS = 4200;
/** Fade-in / fade-out ramp at each end of a bubble's life (real ms). */
export const BUBBLE_FADE_MS = 500;
/** Cap on simultaneously-tracked bubbles — a legible town, not a shouting match.
 *  Oldest drops first when a crowded venue overflows it. */
export const MAX_BUBBLES = 10;
/** Iso-screen px a bubble floats above its speaker's tile centre — clears the
 *  head of a typical sprite at settlement/soul zoom. */
export const BUBBLE_LIFT = 40;

interface ActiveBubble {
  /** Entity id of the speaker — the live position is looked up per frame. */
  npcId: string;
  text: string;
  /** Wall-clock ms (performance.now) when the line was spoken. */
  bornMs: number;
}

export interface SpeechBubbleView {
  npcId: string;
  text: string;
  /** Anchor in device px (world→screen projected + pixel-snapped), the point the
   *  bubble floats ABOVE. */
  x: number;
  y: number;
  /** 0..1 fade alpha (ramps in at birth, out before the TTL). */
  alpha: number;
}

/**
 * Transient store of who is currently "speaking". A speaker holds at most one
 * bubble at a time (a new line replaces the old), and the whole store is capped.
 * Pure bookkeeping — the Game feeds it encounter lines and reads back live
 * bubbles each frame; it never touches the sim.
 */
export class SpeechBubbleStore {
  private bubbles: ActiveBubble[] = [];

  /** Speak a line over `npcId`, replacing that speaker's previous line. Evicts the
   *  oldest bubble if the store is over MAX_BUBBLES. */
  spawn(npcId: string, text: string, nowMs: number): void {
    this.bubbles = this.bubbles.filter(b => b.npcId !== npcId);
    this.bubbles.push({ npcId, text, bornMs: nowMs });
    while (this.bubbles.length > MAX_BUBBLES) this.bubbles.shift();
  }

  /** Swap a live bubble's text IN PLACE, keeping its bornMs (no lifetime reset,
   *  no pop-in). Only replaces if a non-expired bubble for `npcId` is still
   *  showing exactly `from` — so the async LLM garnish (Phase 3c) never clobbers
   *  a newer line the speaker has since spoken, and never resurrects one that
   *  already faded. Returns whether it replaced. */
  retext(npcId: string, from: string, to: string, nowMs: number): boolean {
    const b = this.bubbles.find(x => x.npcId === npcId && nowMs - x.bornMs < BUBBLE_TTL_MS);
    if (!b || b.text !== from) return false;
    b.text = to;
    return true;
  }

  /** Drop lines whose TTL has elapsed. Idempotent; call before reading. */
  prune(nowMs: number): void {
    this.bubbles = this.bubbles.filter(b => nowMs - b.bornMs < BUBBLE_TTL_MS);
  }

  /** Live bubbles (does NOT prune — call prune() first for a clean read). */
  active(): readonly ActiveBubble[] {
    return this.bubbles;
  }

  clear(): void {
    this.bubbles = [];
  }
}

/** Fade alpha for a bubble of the given age: ramp up over BUBBLE_FADE_MS, hold,
 *  then ramp down over the final BUBBLE_FADE_MS before the TTL. */
export function bubbleAlpha(ageMs: number): number {
  if (ageMs <= 0) return 0;
  if (ageMs >= BUBBLE_TTL_MS) return 0;
  if (ageMs < BUBBLE_FADE_MS) return ageMs / BUBBLE_FADE_MS;
  const remaining = BUBBLE_TTL_MS - ageMs;
  if (remaining < BUBBLE_FADE_MS) return remaining / BUBBLE_FADE_MS;
  return 1;
}

/**
 * Project the store's live bubbles to on-screen device-px anchors. `lookupNpc`
 * returns a speaker's current tile position (or null if it despawned — a folded
 * materialized extra), in which case the bubble is skipped this frame. Off-screen
 * bubbles are culled. Same per-frame projection idiom as buildWorldLabels, so a
 * bubble tracks its walking speaker with no swim.
 */
export function buildSpeechBubbles(
  store: SpeechBubbleStore,
  nowMs: number,
  lookupNpc: (npcId: string) => { x: number; y: number } | null,
  cam: Camera,
  dpr: number,
  viewport: { w: number; h: number },
  cullMargin = 80,
): SpeechBubbleView[] {
  store.prune(nowMs);
  const out: SpeechBubbleView[] = [];
  for (const b of store.active()) {
    const pos = lookupNpc(b.npcId);
    if (!pos) continue;
    const p = projectWorldAnchor(pos, BUBBLE_LIFT, cam, dpr);
    if (p.x < -cullMargin || p.y < -cullMargin || p.x > viewport.w + cullMargin || p.y > viewport.h + cullMargin) continue;
    out.push({ npcId: b.npcId, text: b.text, x: p.x, y: p.y, alpha: bubbleAlpha(nowMs - b.bornMs) });
  }
  return out;
}

// ── The deterministic producer ────────────────────────────────────────────────

/** What the producer needs to voice the SPEAKER of an encounter. Pure data. */
export interface EncounterLineInput {
  /** false → the meeting is friction (a rival); true → warmth. */
  warm: boolean;
  relType: Relationship['type'];
  personality: NpcPersonality;
  needs: NpcNeeds;
  /** The partner's given name, for the odd line that addresses them. */
  partnerName: string;
  /** Deterministic variation seed (fold speaker+partner+tick so the same meeting
   *  always voices the same line, but different meetings vary). */
  seed: number;
}

/** Fixed iteration order → deterministic argmin of the speaker's needs. */
const NEED_KEYS: readonly (keyof NpcNeeds)[] = ['safety', 'prosperity', 'community', 'meaning'];

/** Lines a soul grumbles when a particular need is grinding on them (chosen when
 *  that need is the lowest AND below WORRY). Small talk is really shared worry. */
// NOTE: ASCII only — the UI pixel font renders no curly quotes / em-dashes
// (they come out as blanks). Straight apostrophes + hyphens throughout.
const NEED_LINES: Record<keyof NpcNeeds, string[]> = {
  safety:     ["The roads aren't safe these days.", 'I sleep with one eye open now.', 'Did you hear the dogs last night?'],
  prosperity: ['The harvest looks thin this year.', "Coin doesn't stretch like it did.", 'Another lean season coming, mark me.'],
  community:  ['Good to see a friendly face.', 'We hardly gather like we used to.', 'Feels like the old days, this.'],
  meaning:    ["What's it all for, in the end?", 'The gods are quiet lately.', 'I keep asking and no one answers.'],
};

/** Warm relationship greetings, by tie. */
const WARM_LINES: Record<string, string[]> = {
  family: ['How fares the household?', 'Mother sends her love.', "Come by for supper, won't you?"],
  lover:  ['I thought of you all morning.', 'There you are - my heart lifts.', 'Walk with me a while?'],
  mentor: ['Mind what I told you, now.', "You're coming along well.", 'Patience - it comes with time.'],
  friend: ['Well met, friend!', 'Fine weather for it, eh?', 'Any news from the road?'],
};

/** Friction lines, sharpened by the speaker's assertiveness. */
const BARB_LINES_SOFT = ['Hm. You again.', "I've nothing to say to you.", "Let's not, today."];
const BARB_LINES_HARD = ['Out of my way.', "You've some nerve, showing your face.", 'Say that again to my face.'];

/** The WORRY floor — a need must be at least this low to colour the line. */
const WORRY = 0.45;

/** The single need "grinding on" a soul: its lowest need, if that need has
 *  crossed the WORRY floor; else null (all is well → a plain greeting). Shared by
 *  the deterministic producer AND the LLM garnish so both colour the line with
 *  the same worry. Fixed NEED_KEYS order → deterministic tie-break. */
export function lowestWorry(needs: NpcNeeds): keyof NpcNeeds | null {
  let worst: keyof NpcNeeds | null = null;
  let lowest = Infinity;
  for (const k of NEED_KEYS) {
    const v = needs[k];
    if (v < WORRY && v < lowest) { lowest = v; worst = k; }
  }
  return worst;
}

function pick(arr: string[], seed: number): string {
  return arr[Math.abs(seed) % arr.length];
}

/** Deterministic variation seed for a meeting: fold both entity ids + the sim
 *  tick so the same encounter always voices the same line, different ones vary. */
export function encounterSeed(aId: string, bId: string, tick: number): number {
  let h = 2166136261 ^ (tick | 0);
  const s = `${aId}|${bId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/**
 * Voice the speaker's line for an encounter. Deterministic and LLM-free:
 *   friction → a barb (harder the more assertive the speaker);
 *   otherwise, if a need is grinding (lowest & below WORRY) → shared worry;
 *   else → a warmth greeting keyed to the relationship tie.
 * Kept short (one clause) so it reads as a bubble, not a paragraph.
 */
export function describeEncounterLine(input: EncounterLineInput): string {
  if (!input.warm) {
    const table = input.personality.assertiveness >= 0.5 ? BARB_LINES_HARD : BARB_LINES_SOFT;
    return pick(table, input.seed);
  }

  // Dominant worry: the lowest need, if it has crossed the WORRY floor.
  const worst = lowestWorry(input.needs);
  if (worst) return pick(NEED_LINES[worst], input.seed);

  const table = WARM_LINES[input.relType] ?? WARM_LINES.friend;
  return pick(table, input.seed);
}
