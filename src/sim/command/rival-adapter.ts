/**
 * Rival ⇄ Spirit adapters.
 *
 * Rivals are stored as non-player `Spirit`s in `state.spirits` (so they get power
 * regen, snapshot/replay, and divine-action compatibility for free), carrying
 * their behavioural profile in `Spirit.ai`. These helpers convert between the
 * generated `RivalSpirit` shape (used by generation + the rival UI panel) and the
 * stored `Spirit`.
 */
import type { Spirit } from '@/core/spirit';
import type { RivalSpirit, RivalStrategy } from '@/sim/rival-spirit';

const RIVAL_SIGIL = '◆';
const DEFAULT_MAX_POWER = 20;
const DEFAULT_COOLDOWN = 100;

/** Build a stored non-player Spirit from a freshly-generated rival. */
export function rivalToSpirit(r: RivalSpirit): Spirit {
  return {
    id: r.id,
    name: r.name,
    sigil: RIVAL_SIGIL,
    color: r.color,
    isPlayer: false,
    power: r.power,
    manifestation: null,
    ai: {
      policy: r.strategy,
      cooldowns: {},
      personality: r.personality,
      settlements: r.settlements,
      lastActionTick: r.lastActionTick,
      actionCooldown: r.actionCooldown,
    },
  };
}

/**
 * Reconstruct a RivalSpirit view from a stored Spirit, or null if the Spirit is
 * not a rival (no behavioural profile). `power` is read live from the Spirit (the
 * authoritative value SpiritSystem regenerates).
 */
export function spiritToRivalView(s: Spirit): RivalSpirit | null {
  if (!s.ai?.personality) return null;
  return {
    id: s.id,
    name: s.name,
    personality: s.ai.personality,
    strategy: (s.ai.policy as RivalStrategy) ?? 'coexist',
    power: s.power,
    maxPower: Math.max(DEFAULT_MAX_POWER, s.power),
    followers: [],
    settlements: s.ai.settlements ?? [],
    color: s.color,
    createdTick: 0,
    lastActionTick: s.ai.lastActionTick ?? 0,
    actionCooldown: s.ai.actionCooldown ?? DEFAULT_COOLDOWN,
  };
}
