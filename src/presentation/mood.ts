/**
 * Mood vector — the read-only bridge between the deterministic sim and the
 * adaptive score. `computeMood` is a PURE projection of `GameState`: it reads
 * belief/needs/rival/season aggregates and never mutates anything. The
 * presentation layer is an observer of sim truth (see
 * docs/.../presentation-director-cinematics-score-design.md §2), so nothing in
 * here may import a sim mutator — enforced by
 * tests/unit/presentation-no-sim-import.test.ts.
 */
import type { GameState } from '@/core/state';
import { formatCalendarTick, TICKS_PER_DAY, type Season } from '@/core/calendar';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import type { SimEvent } from '@/core/events';

/** A small bundle of world-feel axes the MusicDirector maps to musical params. */
export interface MoodVector {
  /** 0 calm … 1 dire. Unmet NPC needs blended with rival pressure. */
  tension: number;
  /** 0 secular … 1 sacred. Aggregate player faith + devotion. */
  reverence: number;
  /** 0 empty … 1 bustling. Population + active settlement events. */
  liveliness: number;
  /** 0 midnight … 0.5 noon … 1 midnight. Fraction through the sim day. */
  timeOfDay: number;
  season: Season;
}

export const NEUTRAL_MOOD: MoodVector = {
  tension: 0.2,
  reverence: 0.2,
  liveliness: 0.3,
  timeOfDay: 0.5,
  season: 'spring',
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Project the live sim into a {@link MoodVector}. Single O(npcs) pass; the
 * caller (PresentationDirector) throttles how often this runs. Returns
 * NEUTRAL_MOOD before a world exists.
 */
export function computeMood(state: GameState): MoodVector {
  const world = state.world;
  if (!world) return NEUTRAL_MOOD;

  // Never hardcode 'player' — find the player spirit (see architecture notes).
  let playerId: string | undefined;
  for (const s of state.spirits.values()) {
    if (s.isPlayer) { playerId = s.id; break; }
  }

  const npcs = queryNpcs(world);
  let count = 0;
  let needSum = 0;
  let faithSum = 0;
  let devotionSum = 0;
  for (const e of npcs) {
    const p = npcProps(e);
    count++;
    const n = p.needs;
    needSum += (n.safety + n.prosperity + n.community + n.meaning) / 4;
    if (playerId) {
      const b = p.beliefs[playerId];
      if (b) { faithSum += b.faith; devotionSum += b.devotion; }
    }
  }

  const avgNeed = count > 0 ? needSum / count : 0.5;
  const avgFaith = count > 0 ? faithSum / count : 0;
  const avgDevotion = count > 0 ? devotionSum / count : 0;

  // Rival pressure: any non-player spirit that still holds power weighs in.
  let rivals = 0;
  for (const s of state.spirits.values()) {
    if (!s.isPlayer && s.power > 0) rivals++;
  }
  const rivalPressure = clamp01(rivals * 0.34);

  // Active settlement events (drought/festival/…) add unrest + liveliness.
  let activeEvents = 0;
  for (const list of world.activeEvents.values()) activeEvents += list.length;

  const tension = clamp01(0.6 * (1 - avgNeed) + 0.4 * rivalPressure);
  const reverence = clamp01(0.55 * avgFaith + 0.45 * avgDevotion);
  const liveliness = clamp01(0.7 * Math.min(1, count / 40) + 0.3 * Math.min(1, activeEvents / 3));

  const tick = state.clock.now();
  const cal = formatCalendarTick(tick);
  const timeOfDay = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY / TICKS_PER_DAY;

  return { tension, reverence, liveliness, timeOfDay, season: cal.season };
}

/**
 * Transient accent an event applies to the *target* (smoothing) mood — a brief
 * colouring, not a permanent shift. Returned as a partial delta the director
 * adds with decay. Magnitudes are deliberately small (subtle scoring).
 */
export function eventMoodNudge(type: SimEvent['type']): Partial<MoodVector> | null {
  switch (type) {
    case 'smite':
    case 'power_depleted':
      return { tension: +0.35 };
    case 'omen':
      return { tension: +0.18, reverence: +0.1 };
    case 'miracle':
      return { reverence: +0.3, tension: -0.15 };
    case 'answer_prayer':
    case 'dream':
      return { reverence: +0.2 };
    case 'npc_death':
      return { tension: +0.15, liveliness: -0.1 };
    case 'npc_birth':
    case 'settlement_grown':
      return { liveliness: +0.2 };
    case 'settlement_begin':
      return { tension: +0.2, liveliness: +0.1 };
    default:
      return null;
  }
}
