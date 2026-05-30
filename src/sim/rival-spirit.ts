/**
 * Rival Spirit System — spirits that compete with the player for believers.
 */
import type { SpiritId } from '@/core/spirit';
import type { SpiritBelief } from '@/core/types';

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
  options: { title?: string; personality?: Partial<RivalPersonality>; settlements?: string[]; color?: string } = {},
): RivalSpirit {
  const personality: RivalPersonality = {
    aggression: 0.3 + rng() * 0.4,
    subtlety: 0.3 + rng() * 0.4,
    territoriality: 0.4 + rng() * 0.3,
    assertiveness: 0.3 + rng() * 0.4,
    jealousy: 0.2 + rng() * 0.5,
    ...options.personality,
  };

  let strategy: RivalStrategy = 'coexist';
  if (personality.aggression > 0.7) strategy = 'expand';
  else if (personality.aggression > 0.4 && personality.subtlety < 0.4) strategy = 'undermine';
  else if (personality.territoriality > 0.7) strategy = 'defend';

  return {
    id,
    name,
    title: options.title,
    personality,
    strategy,
    power: 5 + Math.floor(rng() * 10),
    maxPower: 20,
    followers: [],
    settlements: options.settlements ?? [],
    color: options.color ?? `hsl(${Math.floor(rng() * 360)}, 70%, 60%)`,
    createdTick: 0,
    lastActionTick: 0,
    actionCooldown: 100 + Math.floor(rng() * 200),
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

export function decideRivalAction(
  rival: RivalSpirit,
  currentTick: number,
  context: {
    playerPower: number;
    playerFollowersInSettlement: Record<string, number>;
    rivalFollowersInSettlement: Record<string, number>;
    npcBeliefs: Map<string, SpiritBelief>;
  },
  rng: () => number,
): RivalAction | null {
  if (currentTick - rival.lastActionTick < rival.actionCooldown) return null;
  switch (rival.strategy) {
    case 'expand': return expandStrategy(rival, rng(), context);
    case 'defend': return defendStrategy(rival, rng(), context);
    case 'undermine': return undermineStrategy(rival, rng(), context);
    case 'coexist': return coexistStrategy(rival, rng(), context);
    default: return null;
  }
}

export function expandStrategy(
  rival: RivalSpirit,
  rng: number,
  _context: { playerPower: number; playerFollowersInSettlement: Record<string, number>; rivalFollowersInSettlement: Record<string, number>; npcBeliefs: Map<string, SpiritBelief> },
): RivalAction | null {
  if (rng < 0.4 && rival.power >= 3) {
    return { type: 'miracle', rivalId: rival.id, powerCost: 3, effect: { faithModifier: 0.1 }, description: `${rival.name} performs a minor miracle`, tick: 0 };
  }
  if (rng < 0.7) {
    return { type: 'whisper', rivalId: rival.id, powerCost: 1, effect: { faithModifier: 0.05 }, description: `${rival.name} whispers encouragement`, tick: 0 };
  }
  return null;
}

export function defendStrategy(
  rival: RivalSpirit,
  rng: number,
  _context: { playerPower: number; playerFollowersInSettlement: Record<string, number>; rivalFollowersInSettlement: Record<string, number>; npcBeliefs: Map<string, SpiritBelief> },
): RivalAction | null {
  if (rng < 0.5 && rival.power >= 1) {
    return { type: 'proselytize', rivalId: rival.id, powerCost: 1, effect: { faithModifier: 0.03 }, description: `${rival.name} strengthens followers`, tick: 0 };
  }
  return null;
}

export function undermineStrategy(
  rival: RivalSpirit,
  rng: number,
  _context: { playerPower: number; playerFollowersInSettlement: Record<string, number>; rivalFollowersInSettlement: Record<string, number>; npcBeliefs: Map<string, SpiritBelief> },
): RivalAction | null {
  if (rng < 0.3 && rival.power >= 3) {
    return { type: 'discredit', rivalId: rival.id, targetSpiritId: 'player', powerCost: 3, effect: { faithModifier: -0.08 }, description: `${rival.name} spreads doubt`, tick: 0 };
  }
  if (rng < 0.6 && rival.power >= 2) {
    return { type: 'curse', rivalId: rival.id, powerCost: 2, effect: { moodModifier: -0.1 }, description: `${rival.name} sends a blight`, tick: 0 };
  }
  return null;
}

export function coexistStrategy(
  rival: RivalSpirit,
  rng: number,
  _context: { playerPower: number; playerFollowersInSettlement: Record<string, number>; rivalFollowersInSettlement: Record<string, number>; npcBeliefs: Map<string, SpiritBelief> },
): RivalAction | null {
  if (rng < 0.3 && rival.power >= 1) {
    return { type: 'whisper', rivalId: rival.id, powerCost: 1, effect: { faithModifier: 0.02 }, description: `${rival.name} offers guidance`, tick: 0 };
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
