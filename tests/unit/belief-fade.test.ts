/**
 * THE BELIEF ECONOMY HAS AN EQUILIBRIUM, NOT A CEILING.
 *
 * `understanding` and `devotion` were written monotonically —
 * `Math.min(1, x + delta·FRAC)` in `belief-propagation-system.ts` — with no
 * passive drain anywhere. Measured on the default world (seed 12345, P3 drift
 * live): both pinned at exactly 1.0000 by game-hour 2 and stayed byte-identical
 * for the next 46 hours, so `beliefContribution = f·(1+2u)(1+2d)` was
 * permanently 9·f and a god's mass was a fixed multiple of its faith sum.
 *
 * `UNDERSTANDING_FADE` / `DEVOTION_FADE` (`@/sim/belief-forces`) are the drain.
 * This file pins the four things that can silently break:
 *
 *   1. the DENOMINATION (per day, divided by the day — the R8 class of defect
 *      that left `meaning` 360× wrong when a day went from 240 ticks to 86,400
 *      fires),
 *   2. the SHAPE (proportional, so there is an interior fixed point at all),
 *   3. TIER PARITY of the fade channel specifically — the mean field must feel
 *      it identically, or a statistical believer is worth more than a named one,
 *   4. that the fade does not double-count into faith, and does not duplicate
 *      the EVENT-driven devotion losses (`spendDevotionAt`, the smite penalty,
 *      LLM writeback), which remain the only non-passive downward paths.
 */
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SilentEventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { tickAllNpcEntities } from '@/sim/npc-sim';
import { BeliefPropagationSystem } from '@/sim/systems/belief-propagation-system';
import { MAX_SOCIAL_DEGREE } from '@/sim/systems/npc-encounter-system';
import {
  UNDERSTANDING_FADE, DEVOTION_FADE, UNDERSTANDING_FADE_PER_DAY, DEVOTION_FADE_PER_DAY,
  FIRES_PER_DAY, FAITH_DECAY_BASE, UNDERSTANDING_FRAC, DEVOTION_FRAC,
} from '@/sim/belief-forces';
import {
  addSoul, beliefContribution, emptySettlementCohorts,
  type SettlementCohorts, type SoulObservation,
} from '@/sim/cohorts';
import { driftSettlementBelief, FIRES_PER_GAME_HOUR } from '@/sim/cohort-drift';
import type { Entity, GameMap, NpcNeeds, NpcProperties, Tile } from '@/core/types';

/** Between DESPERATION_THRESHOLD (0.4) and COMFORT_THRESHOLD (0.6): neither the
 *  desperation boost nor the comfort decay runs, so what is measured is the
 *  BASELINE economy and not a stress case. */
const NEEDS: NpcNeeds = { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 };

function emptyMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 8; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 8; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 8, height: 8, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function village(
  n: number, skepticism: number, faith: number, u: number, d: number, connected: boolean,
): World {
  const world = new World(emptyMap());
  const souls: Entity[] = [];
  for (let i = 0; i < n; i++) {
    const p = initNpcProps(`s${i}`, 'farmer', 11 + i) as NpcProperties;
    p.personality = { assertiveness: 0.5, skepticism, piety: 0.5, sociability: 0.5 };
    p.needs = { ...NEEDS };
    p.beliefs = { player: { faith, understanding: u, devotion: d } };
    p.relationships = [];
    p.activity = 'idle';
    const e: Entity = { id: `s${i}`, kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);
    souls.push(e);
  }
  if (connected) {
    for (let i = 0; i < souls.length; i++) {
      for (let j = i + 1; j < souls.length; j++) {
        npcProps(souls[i]).relationships.push({ npcId: souls[j].id, type: 'friend', trust: 0.5 });
        npcProps(souls[j]).relationships.push({ npcId: souls[i].id, type: 'friend', trust: 0.5 });
      }
    }
  }
  return world;
}

function statVillage(n: number, faith: number, u: number, d: number): SettlementCohorts {
  const sc = emptySettlementCohorts('village');
  for (let i = 0; i < n; i++) {
    const obs: SoulObservation = {
      age: 30, beliefs: { player: { faith, understanding: u, devotion: d } }, needs: { ...NEEDS },
    };
    addSoul(sc, obs);
  }
  return sc;
}

function runFires(world: World, sys: BeliefPropagationSystem, fires: number, seed: number): void {
  const clock = { now: () => 0, advance: () => {} } as never;
  const ctx = {
    world, spirits: new Map(), log: new SilentEventLog(clock),
    clock,
    rng: createRng(seed), dt: 1000, now: 0,
  };
  for (let t = 0; t < fires; t++) {
    tickAllNpcEntities(world);
    sys.tick(ctx as never);
    world.query({ kind: 'npc' }).forEach(e => { npcProps(e).needs = { ...NEEDS }; });
  }
}

function means(world: World): { f: number; u: number; d: number } {
  let f = 0, u = 0, d = 0, n = 0;
  for (const e of world.query({ kind: 'npc' })) {
    const b = npcProps(e).beliefs.player!;
    f += b.faith; u += b.understanding; d += b.devotion; n++;
  }
  return { f: f / n, u: u / n, d: d / n };
}

function statMeans(sc: SettlementCohorts): { f: number; u: number; d: number } {
  let f = 0, u = 0, d = 0, n = 0;
  for (const band of sc.bands) {
    const rec = band.belief.player;
    if (!rec || rec.believerCount <= 0) continue;
    f += rec.sumFaith; u += rec.sumU; d += rec.sumD; n += rec.believerCount;
  }
  return { f: f / n, u: u / n, d: d / n };
}

describe('passive fade of understanding and devotion', () => {
  it('is DENOMINATED PER DAY and divided by the day', () => {
    // The R8 guard. A rate written per fire survives a tick-rate change looking
    // fine and meaning something 360× different; these two must reconstruct
    // their per-day fiction exactly.
    expect(UNDERSTANDING_FADE * FIRES_PER_DAY).toBeCloseTo(UNDERSTANDING_FADE_PER_DAY, 9);
    expect(DEVOTION_FADE * FIRES_PER_DAY).toBeCloseTo(DEVOTION_FADE_PER_DAY, 9);
    expect(FIRES_PER_DAY).toBe(86_400);          // 1 Hz fires in a 24-hour day
  });

  it('drains practice faster than comprehension', () => {
    // Fiction: you go on knowing what a god is FOR long after you stop keeping
    // its rites. Code: understanding has no other downward path at all, while
    // devotion is already spent by miracles.
    expect(DEVOTION_FADE_PER_DAY).toBeGreaterThan(UNDERSTANDING_FADE_PER_DAY);
  });

  it('must exceed the communion pump, or there is no equilibrium to have', () => {
    // AT FAITH EQUILIBRIUM the communion inflow EQUALS the faith decay, so
    // understanding is pumped at UNDERSTANDING_FRAC × that, per fire. A fade
    // slower than the pump cannot hold u below 1 — which is exactly the state
    // this round removed. Stated for the median mortal (skepticism 0.5).
    const pumpPerDay = FAITH_DECAY_BASE * 0.5 * FIRES_PER_DAY;
    expect(UNDERSTANDING_FADE_PER_DAY).toBeGreaterThan(pumpPerDay * UNDERSTANDING_FRAC);
    expect(DEVOTION_FADE_PER_DAY).toBeGreaterThan(pumpPerDay * DEVOTION_FRAC);
  });

  it('is PROPORTIONAL — an unattended believer decays exponentially, not linearly', () => {
    // Shape, not rate. A FLAT drain against an inflow that does not depend on u
    // has no interior fixed point at all (du/dt = ι − λ is a knife edge that
    // pins u at 1 or runs it to 0); proportional is what makes u* = ι/λ exist.
    // skepticism 0 and no neighbours ⇒ NOTHING else moves this soul's belief.
    const world = village(1, 0, 0.6, 0.8, 0.8, false);
    const sys = new BeliefPropagationSystem();
    const fires = FIRES_PER_GAME_HOUR;
    runFires(world, sys, fires, 3);
    const m = means(world);
    expect(m.u).toBeCloseTo(0.8 * Math.pow(1 - UNDERSTANDING_FADE, fires), 9);
    expect(m.d).toBeCloseTo(0.8 * Math.pow(1 - DEVOTION_FADE, fires), 9);
    // Faith is NOT touched by the fade — its own decay is the only faith force
    // here, and skepticism 0 means it does not move either.
    expect(m.f).toBeCloseTo(0.6, 9);
  });

  it('leaves the faith decay exactly as it was (no double-count)', () => {
    // The fade lands AFTER the faith line inside the same per-belief loop, so
    // the comfort/abandonment resistance still reads the devotion the mortal
    // woke up with. With u = d = 0 there is nothing to fade and faith must
    // decay at precisely FAITH_DECAY_BASE × skepticism per fire.
    const world = village(1, 0.5, 0.6, 0, 0, false);
    runFires(world, new BeliefPropagationSystem(), 100, 5);
    expect(means(world).f).toBeCloseTo(0.6 - 100 * FAITH_DECAY_BASE * 0.5, 9);
  });

  it('TIER PARITY: the mean field feels the identical fade', () => {
    // Isolated on both sides (no congregation ⇒ no communion, skepticism 0 ⇒ no
    // faith decay), so this compares the FADE CHANNEL ALONE and the two tiers
    // must agree to float precision — not to the parity test's 0.1% band, which
    // budgets for the Gauss-Seidel/Jacobi difference in the communion term.
    const world = village(1, 0, 0.6, 0.8, 0.8, false);
    runFires(world, new BeliefPropagationSystem(), FIRES_PER_GAME_HOUR, 11);
    const sc = statVillage(1, 0.6, 0.8, 0.8);
    driftSettlementBelief(sc, {
      fires: FIRES_PER_GAME_HOUR,
      params: { skepticism: 0, piety: 0.5, sociability: 0.5, trust: 0.5 },
    });
    const named = means(world);
    const stat = statMeans(sc);
    expect(stat.u).toBeCloseTo(named.u, 12);
    expect(stat.d).toBeCloseTo(named.d, 12);
  });

  it('a congregation at rest settles BELOW the ceiling it used to pin at', () => {
    // The regression this whole round exists to prevent. A complete graph at
    // exactly the edge budget, median personality, run well past its fixed
    // point: before the fade this village sat at u = d = 1.0000 and
    // contribution = 9·f. It must now rest strictly inside the box, and the
    // ordering u* > d* must hold (understanding is pumped at twice devotion's
    // fraction and drained more gently).
    const world = village(MAX_SOCIAL_DEGREE + 1, 0.5, 0.4, 0.1, 0.05, true);
    const sys = new BeliefPropagationSystem();
    // Six game-hours: the fixed point is reached inside three (measured with
    // scripts/probe-belief-decay.ts bench), so this is well past the transient.
    for (let hour = 0; hour < 6; hour++) runFires(world, sys, FIRES_PER_GAME_HOUR, 20 + hour);
    const m = means(world);
    expect(m.u).toBeLessThan(0.95);
    expect(m.d).toBeLessThan(0.95);
    expect(m.u).toBeGreaterThan(m.d);
    // Faith is genuinely high here — the point is that a believer is no longer
    // WORTH 9× it. `beliefContribution` is the number god tiers are read off.
    expect(m.f).toBeGreaterThan(0.8);
    const contribution = beliefContribution({ faith: m.f, understanding: m.u, devotion: m.d });
    expect(contribution).toBeLessThan(0.6 * 9 * m.f);
  }, 30_000);

  it('devotion spent on a miracle is re-earned, not lost forever', () => {
    // `spendDevotionAt` scales devotion by (1 − amount/pool). The passive fade
    // COMPOUNDS with that spend economy by design — but the communion pump
    // refills devotion on a 1/DEVOTION_FADE_PER_DAY timescale, so the cost must
    // be recoverable rather than permanent. Halve the congregation's devotion
    // at its fixed point and it must come back within a game-hour.
    const world = village(MAX_SOCIAL_DEGREE + 1, 0.5, 0.4, 0.1, 0.05, true);
    const sys = new BeliefPropagationSystem();
    for (let hour = 0; hour < 4; hour++) runFires(world, sys, FIRES_PER_GAME_HOUR, 40 + hour);
    const rest = means(world).d;
    for (const e of world.query({ kind: 'npc' })) npcProps(e).beliefs.player!.devotion *= 0.5;
    expect(means(world).d).toBeCloseTo(rest * 0.5, 6);
    runFires(world, sys, FIRES_PER_GAME_HOUR, 99);
    expect(means(world).d).toBeGreaterThan(rest * 0.9);
  }, 30_000);
});
