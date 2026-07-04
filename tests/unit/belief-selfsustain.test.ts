/**
 * R7 WP-B — propagation vs decay: the congregation equilibrium.
 *
 * Before this round, organic spread ran at an EXPECTED ~0.00045 faith/tick
 * (socialize chance 0.2 × trust 0.5 × faith 0.6 × (1−skep 0.5) × RATE 0.015)
 * against a baseline decay of FAITH_DECAY_BASE(0.002) × skepticism ≈ 0.001/tick,
 * and did not scale with congregation size — so every congregation withered
 * without constant divine input. The communion term in BeliefPropagationSystem
 * fixes the balance generatively:
 *
 *   inflow/tick = COMMUNION_RATE(0.006) × sociability × (1 − skepticism/2)
 *                 × min(1, S) × (1 − faith),  S = Σ trust × neighbourFaith
 *                 over neighbours with faith > 0.3.
 *
 * Equilibrium condition for the median NPC (soc .5, skep .5, trust .5),
 * ignoring the stochastic socialization bonus (conservative):
 *   0.006 × .5 × .75 × min(1,S) × (1−f*) = 0.002 × .5
 *   ⇒ 0.00225 × min(1,S) × (1−f*) = 0.001
 *   • S ≥ 1 (saturated congregation): f* = 1 − 0.001/0.00225 ≈ 0.556
 *   • saturation needs S = (N−1)×0.5×f ≥ 1 at f≈0.556 ⇒ N ≥ ~4.6 ⇒ 5+ sustains
 *   • N ≤ 4: inflow ≤ 0.00225 × 0.5(N−1) × max f(1−f)=0.25 < 0.001 ⇒ withers,
 *     and once faith < 0.3 (influence threshold) all inflow cuts out
 *   • lone believer: S = 0 ⇒ pure decay ⇒ 0. Isolation kills gods.
 *
 * These tests run the REAL per-tick pipeline (tickAllNpcEntities decay +
 * BeliefPropagationSystem) with ZERO divine actions. Deterministic: seeded rng,
 * piety pinned to 0 so the desperation boost is exactly zero, needs start at
 * 0.5 so comfort decay (>0.6) never engages, nobody worships.
 */
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { BeliefPropagationSystem } from '@/sim/systems/belief-propagation-system';
import { tickAllNpcEntities } from '@/sim/npc-sim';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import { SilentEventLog } from '@/core/events';
import { BELIEVER_THRESHOLD } from '@/sim/believers';
import type { Entity, GameMap, Tile, NpcProperties } from '@/core/types';

function makeWorld(): World {
  const w = 20, h = 20;
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: w, height: h, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  return new World(map);
}

/** A median believer: soc .5, skep .5, piety 0 (no desperation term), faith 0.6. */
function addBeliever(world: World, id: string): Entity {
  const props = initNpcProps(id, 'farmer', 7) as NpcProperties;
  props.personality = { assertiveness: 0.5, skepticism: 0.5, piety: 0, sociability: 0.5 };
  props.needs = { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 };
  props.beliefs = { player: { faith: 0.6, understanding: 0.3, devotion: 0.2 } };
  props.relationships = [];
  props.activity = 'idle';
  const e = { id, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}

function linkAllPairs(npcs: Entity[], trust = 0.5): void {
  for (let i = 0; i < npcs.length; i++) {
    for (let j = i + 1; j < npcs.length; j++) {
      npcProps(npcs[i]).relationships.push({ npcId: npcs[j].id, type: 'friend', trust });
      npcProps(npcs[j]).relationships.push({ npcId: npcs[i].id, type: 'friend', trust });
    }
  }
}

/** Run K ticks of decay + propagation with NO divine input. */
function runTicks(world: World, K: number, seed = 1): void {
  const sys = new BeliefPropagationSystem();
  const ctx = {
    world, spirits: new Map(), log: new SilentEventLog(null as never),
    clock: { now: () => 0, advance: () => {} } as never,
    rng: createRng(seed), dt: 1000, now: 0,
  };
  for (let t = 0; t < K; t++) {
    tickAllNpcEntities(world);
    sys.tick(ctx as never);
  }
}

function faithOf(e: Entity): number {
  return npcProps(e).beliefs.player?.faith ?? 0;
}

describe('congregation self-sustenance (R7 WP-B)', () => {
  const K = 2000;

  it('a congregation of 8 holds faith with ZERO divine input (f* ≈ 0.556+)', () => {
    const world = makeWorld();
    const flock: Entity[] = [];
    for (let i = 0; i < 8; i++) flock.push(addBeliever(world, `c${i}`));
    linkAllPairs(flock);
    runTicks(world, K);
    // Per NPC: S = 7 × 0.5 × f = 3.5f ⇒ saturated (S ≥ 1) for f ≥ 0.29, so the
    // deterministic equilibrium is f* ≈ 0.556; the stochastic socialization
    // channel adds on top. Assert a conservative floor well above wavering.
    const mean = flock.reduce((s, e) => s + faithOf(e), 0) / flock.length;
    expect(mean).toBeGreaterThanOrEqual(0.45);
    for (const e of flock) expect(faithOf(e)).toBeGreaterThanOrEqual(BELIEVER_THRESHOLD);
  });

  it('a lone believer decays to nothing (S = 0 → pure 0.001/tick decay)', () => {
    const world = makeWorld();
    const hermit = addBeliever(world, 'hermit');
    runTicks(world, K);
    // 0.6 − 2000 × 0.001 clamps to 0 by tick ~600.
    expect(faithOf(hermit)).toBeLessThan(0.05);
  });

  it('a pair is below the sustaining size — withers past the believer line', () => {
    const world = makeWorld();
    const a = addBeliever(world, 'a');
    const b = addBeliever(world, 'b');
    linkAllPairs([a, b]);
    runTicks(world, K);
    // N=2: max inflow 0.00225 × 0.5f(1−f) + expected social 0.00075f < decay
    // 0.001 for all f, so faith bleeds toward the 0.3 influence threshold, then
    // both channels cut out and the pair collapses.
    expect(faithOf(a)).toBeLessThan(BELIEVER_THRESHOLD);
    expect(faithOf(b)).toBeLessThan(BELIEVER_THRESHOLD);
  });

  it('is deterministic — same seed, same equilibrium', () => {
    const run = (): number[] => {
      const world = makeWorld();
      const flock: Entity[] = [];
      for (let i = 0; i < 5; i++) flock.push(addBeliever(world, `d${i}`));
      linkAllPairs(flock);
      runTicks(world, 500, 42);
      return flock.map(faithOf);
    };
    expect(run()).toEqual(run());
  });
});
