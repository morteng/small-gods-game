/**
 * arc-library.ts — authored story SHAPES, not scripts (Track 4, F3; spec §4.2).
 *
 * A shape declares WHEN Fate may even consider seeding it (`seedWhen` — the
 * "no plot devices" gate), WHAT Fate then works toward (`goals`), which portent
 * flavours suit it (F4 picks the words), and a soft pressure budget. Every
 * predicate a shape names MUST exist in ARC_PREDICATES — same allowlist
 * discipline as story-pack verbs (guard: tests/unit/fate-arc-guards.test.ts).
 *
 * The LLM only ever names a shape KEY + a cast; goals, budget, and portent
 * vocabulary come from here, never from the model. The offline stub shape
 * (`stub_vigil`, arc-stub.ts) is deliberately NOT in this library — seed_arc
 * must not offer it.
 *
 * `the_null_event` is load-bearing, not a joke: an author who never rolls a
 * null is legible as an author (spec §4.2).
 */
import type { GameState } from '@/core/state';
import type { ArcCast, ArcGoal, FateArc } from './arc-types';
import type { FateArcStore } from './arc-store';
import { evalArcPredicate } from './arc-predicates';

export interface ArcShape {
  key: string;
  title: string;                    // for the chronicler + dev UI
  /** One-line story shape — rides the prompt so the LLM knows what it is seeding. */
  logline: string;
  /** Preconditions for Fate to even CONSIDER seeding this arc. Predicate names. */
  seedWhen: string[];
  /** The conditions Fate will work toward. */
  goals: Omit<ArcGoal, 'met'>[];
  /** Which portent flavours suit this shape (the chronicler picks the words — F4). */
  portentKinds: string[];
  /** Soft cap on total pressure. */
  budget: number;
}

/** The first library — the seven Norman shapes (spec §4.2). */
export const ARC_LIBRARY: Record<string, ArcShape> = {
  strongman_dies_abroad: {
    key: 'strongman_dies_abroad',
    title: 'The Strongman Dies Abroad',
    logline: 'A standing power dies far from home, leaving a child heir — the vacuum is not empty; it is a feeding frenzy.',
    seedWhen: ['has_prominent_mortal', 'has_multiple_settlements'],
    goals: [{ predicate: 'settlement_in_crisis' }],
    portentKinds: ['dream', 'sky', 'beast'],
    budget: 4,
  },
  exile_returns_crowned: {
    key: 'exile_returns_crowned',
    title: 'The Exile Returns Crowned',
    logline: 'The exile at a foreign court returns to rule, bringing foreign tastes and a promise that detonates later.',
    seedWhen: ['has_multiple_settlements'],
    goals: [{ predicate: 'has_prominent_mortal' }],
    portentKinds: ['rumor', 'sign'],
    budget: 3,
  },
  kingmaker_discarded: {
    key: 'kingmaker_discarded',
    title: 'The Kingmaker Discarded',
    logline: 'The one who made the ruler becomes the first casualty of the ruler they made.',
    seedWhen: ['has_prominent_mortal', 'has_devout_follower'],
    goals: [{ predicate: 'settlement_in_crisis' }],
    portentKinds: ['dream', 'rumor'],
    budget: 3,
  },
  brother_from_within: {
    key: 'brother_from_within',
    title: 'The Brother From Within',
    logline: 'A rival born of defection — strictly more hostile than one always foreign.',
    seedWhen: ['has_rival', 'player_has_believers'],
    goals: [{ predicate: 'settlement_in_crisis' }],
    portentKinds: ['rumor', 'beast'],
    budget: 3,
  },
  victory_that_loses: {
    key: 'victory_that_loses',
    title: 'The Victory That Loses',
    logline: 'Success as the direct cause of failure — the triumph that empties the field for the real blow.',
    seedWhen: ['settlement_thriving'],
    goals: [{ predicate: 'settlement_in_crisis' }],
    portentKinds: ['sky', 'sign'],
    budget: 3,
  },
  martyr_by_accident: {
    key: 'martyr_by_accident',
    title: 'The Martyr By Accident',
    logline: 'A squalid, unjust death converted into a permanent belief-generating structure — and your enemies can create one by mistake.',
    seedWhen: ['has_devout_follower', 'has_rival'],
    goals: [{ predicate: 'player_has_believers' }],
    portentKinds: ['dream', 'sign', 'beast'],
    budget: 2,
  },
  the_null_event: {
    key: 'the_null_event',
    title: 'The Null Event',
    logline: 'Nothing happens, meaningfully: the usurper simply dies, for no dramatic reason. Fate declines to author; the world merely turns.',
    seedWhen: ['has_settlements'],
    goals: [],
    portentKinds: [],
    budget: 0,
  },
};

/** The seedable shape keys — the seed_arc tool's enum (single source of truth). */
export const ARC_SHAPE_KEYS: readonly string[] = Object.keys(ARC_LIBRARY);

export function getArcShape(key: string): ArcShape | undefined {
  return ARC_LIBRARY[key];
}

/** The "no plot devices" gate: ALL of a shape's seedWhen predicates must hold NOW.
 *  An unknown key (or an unknown predicate, via evalArcPredicate) is honestly false. */
export function isShapeSeedable(key: string, state: GameState): boolean {
  const shape = ARC_LIBRARY[key];
  if (!shape) return false;
  return shape.seedWhen.every((p) => evalArcPredicate(p, state));
}

/** Every shape whose preconditions currently hold — the prompt's seedable digest. */
export function seedableShapes(state: GameState): ArcShape[] {
  return ARC_SHAPE_KEYS.filter((k) => isShapeSeedable(k, state)).map((k) => ARC_LIBRARY[k]);
}

/** True when ANY library shape could be seeded — the online pulse's idle-skip check. */
export function anySeedableShape(state: GameState): boolean {
  return ARC_SHAPE_KEYS.some((k) => isShapeSeedable(k, state));
}

/**
 * Open an arc FROM a library shape: goals + budget come from the shape (never
 * from the LLM); the caller supplies only the cast binding. `met` starts false —
 * `recomputeGoals` is the only writer that sets it true.
 */
export function openArcFromShape(
  store: FateArcStore,
  shape: ArcShape,
  cast: ArcCast,
  now: number,
): FateArc {
  return store.open({
    shape: shape.key,
    openedTick: now,
    goals: shape.goals.map((g) => ({ ...g, met: false })),
    applied: [],
    portents: [],
    cast: { poiIds: [...cast.poiIds], npcIds: [...cast.npcIds] },
    stage: 'seeded',
    pressureBudget: shape.budget,
  });
}
