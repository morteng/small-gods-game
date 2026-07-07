/**
 * The whisper card — the first declarative `UiSpec` (agent-driven-UI P4, keystone).
 *
 * A `whisper` is a BRANCH-shaped affordance: choosing it doesn't fire at once, it
 * opens a card of 2–3 *paths* — different things you could plant in an NPC's mind.
 * This builder is the STRUCTURE half (spec §3): sim-owned, synchronous, deterministic
 * (`Math.random`-free), keyed by the NPC's situation —
 *
 *     dominantNeed  ×  activeEvent  ×  dominantDomainBelief
 *
 * — so the paths always answer what the NPC is actually going through. Each path
 * pre-pairs a real `whisper` `Command` (the already-validated write path), carrying
 * the whispered words in `payload.text` and the steer in `params.slant`. Prose is the
 * authored fallback; an LLM may later rewrite the words (never the branches), warmed
 * on focus — but the returned spec holds resolved strings, so it is replay-safe.
 *
 * Lives in the game layer (not `src/sim/`) because it composes a `UiSpec` (a UI type);
 * it stays pure + deterministic so the presented card reproduces on replay.
 */
import type { NpcNeeds, NpcProperties, SettlementEventType } from '@/core/types';
import type { SpiritId } from '@/core/spirit';
import type { Command, CommandCtx, CommandTarget } from '@/sim/command/types';
import type { BeliefDomain } from '@/core/types';
import { getNpc, npcProps } from '@/world/npc-helpers';
import { getDomainBelief, isOminous, ALL_DOMAINS, DOMAIN_EPSILON } from '@/sim/belief-domains';
import type { UiSpec, UiSpecBlock, UiSpecChoice } from '@/story/uispec';
import { validateUiSpec } from '@/story/uispec';
import type { WhisperTurn } from '@/llm/npc-attention-store';

/** How many recent turns the card shows inline (no scroll yet — C3 unlocks history).
 *  Sized so 2 belief bars + 2 turns (playerLine+npcLine each) fit the 6-block budget. */
const CARD_TURN_TAIL = 2;

type NeedKey = keyof NpcNeeds;

/** Fixed need order — also the deterministic tie-break for the dominant (most acute) need. */
const NEED_ORDER: readonly NeedKey[] = ['safety', 'prosperity', 'community', 'meaning'];

const NEED_LABEL: Record<NeedKey, string> = {
  safety: 'Safety', prosperity: 'Prosperity', community: 'Belonging', meaning: 'Meaning',
};

/** What the NPC's acute deficit sounds like from the inside (the npcLine). */
const NEED_FEELING: Record<NeedKey, string> = {
  safety: 'Something out there means us harm. I can feel it.',
  prosperity: 'The stores run thin. What will we eat?',
  community: 'No one would even notice if I were gone.',
  meaning: 'What is any of this for?',
};

/** The whisper that soothes each need (the always-present first path). */
const NEED_WHISPER: Record<NeedKey, string> = {
  safety: 'You are watched over. The danger will pass.',
  prosperity: 'Hold fast — leaner days end, and your work will bear.',
  community: 'You are not alone. Your people are nearer than you know.',
  meaning: 'Your life turns on a purpose larger than you can see.',
};

/** The whisper that affirms a domain the NPC already half-believes (belief-loop steer). */
const DOMAIN_WHISPER: Record<BeliefDomain, string> = {
  storm: 'Yes — the thunder was mine. Let them be sure of it.',
  flood: 'The rising waters answer to me. Let them know it.',
};
const DOMAIN_CHOICE: Record<BeliefDomain, string> = {
  storm: 'Claim the storm',
  flood: 'Claim the flood',
};

/** The most acute (lowest) need, tie-broken by NEED_ORDER. */
export function dominantNeed(needs: NpcNeeds): NeedKey {
  let best: NeedKey = NEED_ORDER[0];
  for (const k of NEED_ORDER) if (needs[k] < needs[best]) best = k;
  return best;
}

/** The domain this NPC most believes `source` commands (above ε), or null. */
export function dominantDomain(p: NpcProperties, source: SpiritId): BeliefDomain | null {
  let best: BeliefDomain | null = null;
  let bestV = DOMAIN_EPSILON;
  for (const d of ALL_DOMAINS) {
    const v = getDomainBelief(p, source, d);
    if (v > bestV) { bestV = v; best = d; }
  }
  return best;
}

/** The worst ominous event in the NPC's home settlement, or null. */
function worstOminousEvent(homePoiId: string | undefined, ctx: CommandCtx): SettlementEventType | null {
  if (!homePoiId) return null;
  const evs = ctx.world.activeEvents.get(homePoiId) ?? [];
  let worst = 0;
  let type: SettlementEventType | null = null;
  for (const ev of evs) {
    if (isOminous(ev.type) && ev.severity > worst) { worst = ev.severity; type = ev.type; }
  }
  return type;
}

/** Framing paragraph — the door to their mind by what they're doing right now. */
function framing(p: NpcProperties): string {
  switch (p.activity) {
    case 'worship': return 'They kneel in prayer, thoughts laid open to you.';
    case 'sleep':   return 'They dream, and the door to their mind stands ajar.';
    default:        return 'Their surface thoughts lie open to your voice.';
  }
}

function whisperCommand(target: CommandTarget, source: SpiritId, slant: string, text: string): Command {
  return {
    verb: 'whisper',
    source,
    target,
    params: { slant },
    payload: { conversational: true, text },
    seq: 0, // re-stamped by the queue on emit
  };
}

/**
 * Build the whisper card for an NPC target, or null when the target isn't a resolvable
 * NPC. Always yields 2–3 paths: soothe-the-need (always), then name-the-omen (if an
 * ominous event grips their home) and/or affirm-the-domain (if they already lean toward
 * a power you hold); a generic affirmation backfills to guarantee a real choice.
 */
export function buildWhisperCard(
  target: CommandTarget,
  source: SpiritId,
  ctx: CommandCtx,
  transcript?: readonly WhisperTurn[],
): UiSpec | null {
  if (target.kind !== 'npc') return null;
  const e = getNpc(ctx.world, target.npcId);
  if (!e) return null;
  const p = npcProps(e);

  const need = dominantNeed(p.needs);
  const event = worstOminousEvent(p.homePoiId, ctx);
  const domain = dominantDomain(p, source);
  const belief = p.beliefs[source] ?? { faith: 0, understanding: 0, devotion: 0 };

  // ── body ──
  // A conversation underway (C2): pinned belief bars (the feedback instrument) over
  // the last few turns of the transcript. No conversation yet: the situational opener
  // (what they feel + the door into their mind + any omen).
  const body: UiSpecBlock[] = [
    { kind: 'beliefBar', label: 'Faith', value: belief.faith },
    { kind: 'beliefBar', label: NEED_LABEL[need], value: p.needs[need] },
  ];
  if (transcript && transcript.length > 0) {
    for (const t of transcript.slice(-CARD_TURN_TAIL)) {
      body.push({ kind: 'playerLine', text: t.whisper });
      // Empty dialogue = the reply hasn't landed (pending) or was degraded (no LLM) —
      // an ellipsis reads as the whisper falling into their mind without words.
      body.push({ kind: 'npcLine', who: p.name, text: t.dialogue || '…' });
    }
  } else {
    body.push({ kind: 'divider' });
    body.push({ kind: 'npcLine', who: p.name, text: NEED_FEELING[need] });
    body.push({ kind: 'paragraph', text: framing(p) });
    if (event) {
      body.push({ kind: 'omen', text: `A ${event} torments them; they search the sky for a reason.` });
    }
  }

  // ── paths: soothe-the-need, then omen / domain, capped at 3 ──
  const choices: UiSpecChoice[] = [
    {
      text: `Soothe their ${NEED_LABEL[need].toLowerCase()}`,
      command: whisperCommand(target, source, `need:${need}`, NEED_WHISPER[need]),
      hint: 'eases the deficit',
    },
  ];
  if (event) {
    choices.push({
      text: `Name the ${event} your doing`,
      command: whisperCommand(target, source, `event:${event}`,
        `This ${event} is no accident — let them feel your hand in it.`),
      hint: 'builds understanding',
    });
  }
  if (domain) {
    choices.push({
      text: DOMAIN_CHOICE[domain],
      command: whisperCommand(target, source, `domain:${domain}`, DOMAIN_WHISPER[domain]),
      hint: 'deepens the power they grant you',
    });
  }
  if (choices.length < 2) {
    choices.push({
      text: 'Affirm that you are real, and near',
      command: whisperCommand(target, source, 'affirm', 'Kindle a small, sure certainty that you are real, and near.'),
      hint: 'builds understanding',
    });
  }

  return validateUiSpec({ title: `Whisper to ${p.name}`, body, choices });
}
