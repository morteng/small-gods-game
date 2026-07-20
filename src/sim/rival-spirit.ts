/**
 * Rival Spirit System — spirits that compete with the player for believers.
 */
import type { SpiritId } from '@/core/spirit';
import type { NpcNeeds, SpiritBelief } from '@/core/types';
import type { RivalSituation } from '@/sim/rival-claims';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';
import { WHISPER_COST, OMEN_COST, MIRACLE_COST } from '@/sim/divine-actions';

/** The four prayer subjects, in a fixed order — the pool `assignRivalDomains`
 *  shuffles deterministically. Mirrors `NpcNeeds`' field order. */
const NEED_DOMAINS: readonly (keyof NpcNeeds)[] = ['safety', 'prosperity', 'community', 'meaning'];

/** D3 (power-economics spec) — the "ambition bank": a war chest worth exactly
 *  one miracle. Spend/save policy (wealth pressure + save-for-miracle) is
 *  always expressed as a multiple of this, never a raw literal. */
export const AMBITION_BANK = MIRACLE_COST;

/** D3 — how hard power banked ABOVE the ambition bank pushes `expandStrategy`
 *  toward spending it on a miracle instead of a whisper. Zero below the bank. */
export const WEALTH_PRESSURE = 0.25;

export type RivalStrategy = 'expand' | 'defend' | 'undermine' | 'coexist';

export interface RivalPersonality {
  aggression: number;
  subtlety: number;
  territoriality: number;
  assertiveness: number;
  jealousy: number;
}

export interface RivalSpirit {
  id: SpiritId;
  name: string;
  title?: string;
  personality: RivalPersonality;
  strategy: RivalStrategy;
  power: number;
  maxPower: number;
  followers: string[];
  settlements: string[];
  color: string;
  createdTick: number;
  lastActionTick: number;
  actionCooldown: number;
  actionHistory?: RivalAction[];
  /** Need-domain affinity (Track 3 prayer domain-matching) — see the field of the
   *  same name on `Spirit['ai']` (`src/core/spirit.ts`) for the semantics. Optional
   *  so a `RivalSpirit` view reconstructed from a legacy Spirit (no stored
   *  domains) degrades to universal, exactly like the stored field. */
  domains?: readonly (keyof NpcNeeds)[];
}

/** Deterministically pick 1–2 need-domains for a new rival from `rng` — the SAME
 *  closure-scoped rng already threaded through `createRivalSpirit` (a seeded LCG
 *  derived from `worldSeed` in `generateRivalSpirits`, never `Math.random`). A
 *  Fisher-Yates shuffle of the 4 needs, then a length draw, keeps every need
 *  reachable and the choice reproducible for a given seed + call order. */
export function assignRivalDomains(rng: () => number): readonly (keyof NpcNeeds)[] {
  const pool = [...NEED_DOMAINS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const count = 1 + Math.floor(rng() * 2); // 1 or 2 domains
  return pool.slice(0, count);
}

export interface RivalAction {
  type: 'whisper' | 'omen' | 'miracle' | 'curse' | 'proselytize' | 'discredit';
  rivalId: SpiritId;
  targetNpcId?: string;
  targetSettlementId?: string;
  targetSpiritId?: SpiritId;
  powerCost: number;
  effect: { faithModifier?: number; moodModifier?: number; relationshipModifier?: { targetNpcId: string; delta: number } };
  description: string;
  tick: number;
}

export function createRivalSpirit(
  id: SpiritId,
  name: string,
  rng: () => number,
  options: {
    title?: string;
    personality?: Partial<RivalPersonality>;
    settlements?: string[];
    color?: string;
    domains?: readonly (keyof NpcNeeds)[];
  } = {},
): RivalSpirit {
  const personality: RivalPersonality = {
    aggression: 0.3 + rng() * 0.4,
    subtlety: 0.3 + rng() * 0.4,
    territoriality: 0.4 + rng() * 0.3,
    assertiveness: 0.3 + rng() * 0.4,
    jealousy: 0.2 + rng() * 0.5,
    ...options.personality,
  };

  return {
    id,
    name,
    title: options.title,
    personality,
    strategy: strategyForPersonality(personality),
    power: 5 + Math.floor(rng() * 10),
    maxPower: 20,
    followers: [],
    settlements: options.settlements ?? [],
    color: options.color ?? `hsl(${Math.floor(rng() * 360)}, 70%, 60%)`,
    createdTick: 0,
    lastActionTick: 0,
    actionCooldown: 100 + Math.floor(rng() * 200),
    // Domain draw runs AFTER every other rng() call above so existing fields
    // (power/color/cooldown/personality) keep drawing in their old order —
    // inserting it earlier would silently reroll every downstream value.
    domains: options.domains ?? assignRivalDomains(rng),
  };
}

export function generateRivalSpirits(
  worldSeed: number,
  settlementIds: string[],
  count: number = 3,
): RivalSpirit[] {
  const rivals: RivalSpirit[] = [];
  const names = [
    { name: 'Sablethorn', title: 'The Root in Darkness' },
    { name: 'Goldentongue', title: 'The Silver-Tongued' },
    { name: 'Ironwill', title: 'The Unyielding' },
    { name: 'Whisperwind', title: 'The Breath on the Neck' },
    { name: 'Flameheart', title: 'The Burning Zealot' },
    { name: 'Mirthless', title: 'The Grinning Void' },
    { name: 'Cragarm', title: 'The Stone-Silent' },
    { name: 'Dewfall', title: 'The Gentle Drench' },
  ];

  // Simple seeded PRNG
  let seed = worldSeed * 137;
  const rng = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < count && i < names.length; i++) {
    const nameData = names[i];
    const personality: RivalPersonality = {
      aggression: 0.2 + rng() * 0.6,
      subtlety: 0.2 + rng() * 0.6,
      territoriality: 0.3 + rng() * 0.5,
      assertiveness: 0.2 + rng() * 0.6,
      jealousy: 0.3 + rng() * 0.5,
    };

    const rivalSettlements: string[] = [];
    const availableSettlements = [...settlementIds];
    const numSettlements = 1 + Math.floor(rng() * 2);
    for (let j = 0; j < numSettlements && availableSettlements.length > 0; j++) {
      const idx = Math.floor(rng() * availableSettlements.length);
      rivalSettlements.push(availableSettlements.splice(idx, 1)[0]);
    }

    rivals.push(createRivalSpirit(
      `rival-${i + 1}` as SpiritId,
      nameData.name,
      rng,
      {
        title: nameData.title,
        personality,
        settlements: rivalSettlements,
        color: `hsl(${Math.floor(rng() * 360)}, 70%, 60%)`,
      }
    ));
  }

  return rivals;
}

/** The personality → strategy decision tree. Called LIVE on every decision (and
 *  to refresh the stored `ai.policy` label after `set_rival_stance`), so Fate's
 *  coaching deltas change behaviour from the very next decision. */
export function strategyForPersonality(p: RivalPersonality): RivalStrategy {
  if (p.aggression > 0.7) return 'expand';
  if (p.aggression > 0.4 && p.subtlety < 0.4) return 'undermine';
  if (p.territoriality > 0.7) return 'defend';
  return 'coexist';
}

/** Deterministic best-settlement pick: highest score wins, ties break toward the
 *  lexicographically-first id. `-Infinity` disqualifies a candidate outright, and
 *  '' (settlement-less NPCs) is never a target. */
function pickSettlement(candidates: Iterable<string>, score: (id: string) => number): string | null {
  let best: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const id of [...candidates].sort()) {
    if (!id) continue;
    const s = score(id);
    if (s === Number.NEGATIVE_INFINITY) continue;
    if (best === null || s > bestScore) { best = id; bestScore = s; }
  }
  return best;
}

/** Every settlement this rival can see: its holdings plus anywhere any god
 *  (itself or ANY opposition, D4/D5) has counted believers. */
function knownSettlements(rival: RivalSpirit, sit: RivalSituation): Set<string> {
  return new Set([
    ...rival.settlements,
    ...Object.keys(sit.playerFollowersInSettlement),
    ...Object.keys(sit.rivalFollowersInSettlement),
    ...Object.keys(sit.opposingFollowersInSettlement),
  ]);
}

/** The rival's own turf: holdings plus anywhere it has believers. */
function ownSettlements(rival: RivalSpirit, sit: RivalSituation): Set<string> {
  return new Set([...rival.settlements, ...Object.keys(sit.rivalFollowersInSettlement)]);
}

export function decideRivalAction(
  rival: RivalSpirit,
  currentTick: number,
  situation: RivalSituation,
  rng: () => number,
): RivalAction | null {
  if (currentTick - rival.lastActionTick < rival.actionCooldown) return null;
  // Strategy derives live from personality, NOT the cached `strategy`/`ai.policy`
  // field — a set_rival_stance nudge must bite on the next decision.
  switch (strategyForPersonality(rival.personality)) {
    case 'expand': return expandStrategy(rival, situation, rng);
    case 'defend': return defendStrategy(rival, situation, rng);
    case 'undermine': return undermineStrategy(rival, situation, rng);
    case 'coexist': return coexistStrategy(rival, situation, rng);
    default: return null;
  }
}

/** EXPAND (aggressive growth) — press where the OPPOSITION is WEAKEST overall
 *  (D5: `opposingFollowersInSettlement` — player AND every other rival, not
 *  player-only). Big spends (miracle) scale with aggression AND banked wealth
 *  (D3: `WEALTH_PRESSURE`, zero below `AMBITION_BANK`); the cheap whisper
 *  fallback scales with assertiveness. Power gates use the CANONICAL verb
 *  costs so a rival never wastes its cooldown proposing a command the executor
 *  will reject as unaffordable.
 *
 *  D3 save-for-miracle: an aggressive rival sitting on HALF a miracle chest
 *  eyeing a genuinely contested settlement will sometimes hold the whisper
 *  entirely instead of dribbling it out — a war chest, not a dribble. */
export function expandStrategy(
  rival: RivalSpirit,
  situation: RivalSituation,
  rng: () => number,
): RivalAction | null {
  const target = pickSettlement(
    knownSettlements(rival, situation),
    id => -(situation.opposingFollowersInSettlement[id] ?? 0),
  );
  if (!target) return null;
  const p = rival.personality;

  const contested = (situation.opposingFollowersInSettlement[target] ?? 0)
    > (situation.rivalFollowersInSettlement[target] ?? 0);
  if (
    p.aggression > 0.6
    && rival.power >= AMBITION_BANK / 2 && rival.power < AMBITION_BANK
    && contested
    && rng() < 0.5
  ) {
    return null; // hold the whisper, bank for the big play
  }

  // Wealth pressure is 0 below the bank; above it, banked power flows back out
  // as a rising lean toward the miracle instead of the cheap whisper.
  const wealthTerm = rival.power > AMBITION_BANK
    ? WEALTH_PRESSURE * Math.min(1, (rival.power - AMBITION_BANK) / AMBITION_BANK)
    : 0;
  const miracleChance = Math.min(0.95, 0.2 + 0.5 * p.aggression + wealthTerm);
  if (rival.power >= MIRACLE_COST && rng() < miracleChance) {
    return { type: 'miracle', rivalId: rival.id, targetSettlementId: target, powerCost: MIRACLE_COST, effect: { faithModifier: 0.1 }, description: `${rival.name} performs a minor miracle`, tick: 0 };
  }
  if (rival.power >= WHISPER_COST && rng() < 0.4 + 0.4 * p.assertiveness) {
    return { type: 'whisper', rivalId: rival.id, targetSettlementId: target, powerCost: WHISPER_COST, effect: { faithModifier: 0.05 }, description: `${rival.name} whispers encouragement`, tick: 0 };
  }
  return null;
}

/** DEFEND (territorial consolidation) — shore up where ground is being LOST
 *  (most negative follower delta since the last baseline), else where the player
 *  has pushed deepest into held turf, else the largest own congregation. Acts
 *  urgently when actually losing, at a territoriality-scaled rate otherwise. */
export function defendStrategy(
  rival: RivalSpirit,
  situation: RivalSituation,
  rng: () => number,
): RivalAction | null {
  if (rival.power < WHISPER_COST) return null;
  const own = ownSettlements(rival, situation);
  const losing = pickSettlement(own, id => {
    const d = situation.rivalFollowerDelta[id] ?? 0;
    return d < 0 ? -d : Number.NEGATIVE_INFINITY;    // deepest loss wins
  });
  const invaded = pickSettlement(own, id => {
    const n = situation.playerFollowersInSettlement[id] ?? 0;
    return n > 0 ? n : Number.NEGATIVE_INFINITY;
  });
  const anchor = pickSettlement(own, id => situation.rivalFollowersInSettlement[id] ?? 0);
  const target = losing ?? invaded ?? anchor;
  if (!target) return null;
  if (rng() < (losing ? 0.75 : 0.3 + 0.4 * rival.personality.territoriality)) {
    return { type: 'proselytize', rivalId: rival.id, targetSettlementId: target, powerCost: WHISPER_COST, effect: { faithModifier: 0.03 }, description: `${rival.name} strengthens followers`, tick: 0 };
  }
  return null;
}

/** UNDERMINE (jealous sabotage) — strike the STRONGEST opponent god OVERALL
 *  (D5: player or another rival, by total follower count — jealousy is about
 *  the biggest god, not specifically the player) at their strongest
 *  settlement: discredit (jealousy-scaled) or curse (aggression-scaled).
 *  Nothing of anyone's anywhere ⇒ nothing worth undermining. Ties go to the
 *  player (the strict `>` below never displaces the starting victim). */
export function undermineStrategy(
  rival: RivalSpirit,
  situation: RivalSituation,
  rng: () => number,
): RivalAction | null {
  let victimId: SpiritId = PLAYER_SPIRIT_ID;
  let victimTotal = Object.values(situation.playerFollowersInSettlement).reduce((a, b) => a + b, 0);
  let victimFollowers = situation.playerFollowersInSettlement;
  for (const other of situation.otherRivals) {   // id-sorted ⇒ deterministic tie-break
    if (other.followerTotal > victimTotal) {
      victimId = other.id;
      victimTotal = other.followerTotal;
      victimFollowers = other.followersInSettlement;
    }
  }
  if (victimTotal <= 0) return null;

  const stronghold = pickSettlement(
    Object.keys(victimFollowers),
    id => {
      const n = victimFollowers[id];
      return n > 0 ? n : Number.NEGATIVE_INFINITY;
    },
  );
  if (!stronghold || rival.power < OMEN_COST) return null;
  const p = rival.personality;
  if (rng() < 0.2 + 0.5 * p.jealousy) {
    return { type: 'discredit', rivalId: rival.id, targetSpiritId: victimId, targetSettlementId: stronghold, powerCost: OMEN_COST, effect: { faithModifier: -0.08 }, description: `${rival.name} spreads doubt`, tick: 0 };
  }
  if (rng() < 0.3 + 0.3 * p.aggression) {
    return { type: 'curse', rivalId: rival.id, targetSpiritId: victimId, targetSettlementId: stronghold, powerCost: OMEN_COST, effect: { moodModifier: -0.1 }, description: `${rival.name} sends a blight`, tick: 0 };
  }
  return null;
}

/** COEXIST (cautious opportunism) — minister where unanswered-prayer pressure is
 *  highest on its own turf (souls the resident gods neglect), subtlety-scaled;
 *  otherwise only the occasional gentle word to its largest congregation. */
export function coexistStrategy(
  rival: RivalSpirit,
  situation: RivalSituation,
  rng: () => number,
): RivalAction | null {
  if (rival.power < WHISPER_COST) return null;
  const own = ownSettlements(rival, situation);
  const pressed = pickSettlement(own, id => {
    const n = situation.prayerPressureInSettlement[id] ?? 0;
    return n > 0 ? n : Number.NEGATIVE_INFINITY;
  });
  if (pressed) {
    if (rng() < 0.4 + 0.4 * rival.personality.subtlety) {
      return { type: 'whisper', rivalId: rival.id, targetSettlementId: pressed, powerCost: WHISPER_COST, effect: { faithModifier: 0.03 }, description: `${rival.name} comforts the unheard`, tick: 0 };
    }
    return null;
  }
  const anchor = pickSettlement(own, id => situation.rivalFollowersInSettlement[id] ?? 0);
  if (anchor && rng() < 0.15) {
    return { type: 'whisper', rivalId: rival.id, targetSettlementId: anchor, powerCost: WHISPER_COST, effect: { faithModifier: 0.02 }, description: `${rival.name} offers guidance`, tick: 0 };
  }
  return null;
}

export function applyRivalAction(
  action: RivalAction,
  getNpc: (id: string) => { properties: Record<string, unknown> } | undefined,
  updateNpc: (id: string, updates: { properties: Record<string, unknown> }) => void,
): void {
  if (action.targetNpcId) {
    const npc = getNpc(action.targetNpcId);
    if (!npc) return;
    const beliefs = (npc.properties as Record<string, unknown>).beliefs as Record<string, SpiritBelief> ?? {};
    const targetBelief = beliefs[action.rivalId] ?? { faith: 0, understanding: 0, devotion: 0 };
    if (action.effect.faithModifier) {
      targetBelief.faith = Math.max(0, Math.min(1, targetBelief.faith + action.effect.faithModifier));
    }
    beliefs[action.rivalId] = targetBelief;
    updateNpc(action.targetNpcId, { properties: { beliefs: beliefs as unknown as Record<string, unknown> } });
  }
}
