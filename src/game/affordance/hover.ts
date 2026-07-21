// The hover popover's LOCAL lens (spec §2/§5, P3). Given the target under the
// cursor, build the SAME `Situation` signal the divine inbox scores globally, then
// derive the top divine affordances as compact chips. One salience brain, two
// lenses — global (inbox) and local (hover) never disagree. Pure + deterministic:
// no LLM, no `Math.random`, safe on the frame/hover path.
import type { CommandCtx, CommandTarget, CommandVerb } from '@/sim/command/types';
import type { SpiritId } from '@/core/spirit';
import { getNpc, npcProps } from '@/world/npc-helpers';
import { isOminous } from '@/sim/belief-domains';
import { affordancesForTarget, type VerbUnlock } from './derive';
import { PRAYER_SUBJECT_TEXT, type Situation } from './salience';

/** A hovered target's situation signal + a short human "why" tag ("praying"). */
export interface SituationTag {
  situation: Situation;
  why: string;
}

/**
 * Map the hovered target to the inbox's `Situation` vocabulary — the local-lens
 * adapter (spec §2). Mirrors `divineInbox` exactly (prayer from a worshipping
 * NPC, opportunity from an ominous settlement event) so the two lenses agree.
 * Returns null when the target carries no salient situation — chips still show,
 * just without a why-tag or salience-preferred ordering.
 */
export function buildSituation(target: CommandTarget, ctx: CommandCtx, source: SpiritId): SituationTag | null {
  if (target.kind === 'npc') {
    const e = getNpc(ctx.world, target.npcId);
    if (!e) return null;
    const p = npcProps(e);
    if (p.activity !== 'worship') return null;
    const faith = p.beliefs[source]?.faith ?? 0;
    if (faith <= 0) return null;
    // M0.b: score + label by the plea's SUBJECT need (fallback: the classic meaning-plea).
    const need = p.prayerNeed ?? 'meaning';
    return {
      situation: { kind: 'prayer', faith, needDeficit: 1 - p.needs[need] },
      why: need === 'meaning' ? 'praying' : `prays for ${PRAYER_SUBJECT_TEXT[need]}`,
    };
  }
  if (target.kind === 'settlement') {
    const evs = ctx.world.activeEvents.get(target.poiId) ?? [];
    let worst = 0;
    let worstType: string | null = null;
    for (const ev of evs) {
      if (isOminous(ev.type) && ev.severity > worst) { worst = ev.severity; worstType = ev.type; }
    }
    if (!worstType) return null;
    return { situation: { kind: 'opportunity', severity: worst }, why: worstType };
  }
  return null;
}

/** A compact affordance for the hover popover: a verb the player could issue now. */
export interface HoverChip {
  verb: CommandVerb;
  label: string;
  cost: number;
  unlocked: boolean;
  affordable: boolean;
  /** 'leaf' fires immediately; 'branch' will open a UiSpec card (P4). */
  shape: 'leaf' | 'branch';
  /** The situation reason this chip answers, or null. */
  why: string | null;
}

/** The verb the situation most wants answered — floated to the top of the chips. */
function preferredVerb(sit: Situation | null): CommandVerb | null {
  if (!sit) return null;
  switch (sit.kind) {
    case 'prayer':           return 'answer_prayer';
    case 'prayer_contested': return 'answer_prayer'; // still answerable — beat the rival to it
    case 'prayer_claimed':   return null;            // already lost; nothing to do here
    case 'opportunity':      return 'omen';
    case 'threat':           return 'smite';
    case 'tiding':           return null;            // news, not a call to act (WP-C)
    case 'chronicle':        return null;            // atmosphere, never a call to act (M1)
    case 'lifecycle_tiding': return null;            // life goes on — never a call to act (W4/D8)
  }
}

/** Ordering bucket: situation-preferred first, then castable, then unlocked, then locked. */
function rank(chip: HoverChip, preferred: CommandVerb | null): number {
  if (chip.verb === preferred) return 0;
  if (chip.unlocked && chip.affordable) return 1;
  if (chip.unlocked) return 2;
  return 3;
}

/**
 * The top divine affordances for the hovered target, as compact chips: the
 * situation-appropriate verb first, then castable (unlocked+affordable), then by
 * ascending cost; capped at `max`. `why` is tagged only on the preferred verb.
 * The chip set is `affordancesForTarget` (registry ∩ belief-unlock ∩ preview) —
 * the exact seam the powers panel and inspector render, so the surfaces agree.
 */
export function hoverChips(
  target: CommandTarget,
  source: SpiritId,
  ctx: CommandCtx,
  unlocks: ReadonlyArray<VerbUnlock>,
  max = 3,
): HoverChip[] {
  const tag = buildSituation(target, ctx, source);
  const preferred = preferredVerb(tag?.situation ?? null);
  const chips: HoverChip[] = affordancesForTarget(target, source, ctx, unlocks).map((a) => ({
    verb: a.verb,
    label: a.label,
    cost: a.preview.cost,
    unlocked: a.unlocked,
    affordable: a.preview.affordable,
    shape: a.shape,
    why: a.verb === preferred ? (tag?.why ?? null) : null,
  }));
  chips.sort((x, y) => rank(x, preferred) - rank(y, preferred) || x.cost - y.cost
    || (x.verb < y.verb ? -1 : x.verb > y.verb ? 1 : 0));
  return chips.slice(0, max);
}
