/**
 * Hall of the Gods H1 — the projection.
 *
 * Two things under test: the pure sim-side sibling
 * (`aggregateDomainDimensions` — weighted dimension means over a domain's
 * reached believers) and the DERIVED legibility fields `beliefPowers()` hangs
 * off it (`dimensions`, `tier`). Tier is derived every read, so a decay that
 * drops conviction must RE-LOCK the node — no stored tier, no crossing event.
 *
 * Plan: docs/superpowers/plans/2026-07-26-hall-of-the-gods-plan.md §2 (H1), §4.1/§4.2
 */
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import {
  addDomainBelief, aggregateDomainDimensions, DOMAIN_DEFS, DOMAIN_REACH_FLOOR,
} from '@/sim/belief-domains';
import {
  createGameQuery, CLAIM_CONVICTION_FRACTION, DOCTRINE_DEVOTION_BAR,
  type BeliefPowerView,
} from '@/game/game-query';
import { createState } from '@/core/state';
import { dispatchBus, type BusLike } from '@/dev/bus-bridge-protocol';

// ── scaffolding (mirrors belief-powers.test.ts) ───────────────────────────────
function makeWorld(): World {
  return new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
}

let nextId = 0;
function addNpc(
  world: World,
  opts: { poi?: string; faith?: number; understanding?: number; devotion?: number; storm?: number } = {},
): Entity {
  const id = `n${nextId++}`;
  const props = initNpcProps('Pip', 'farmer', nextId) as NpcProperties;
  props.beliefs = {
    player: {
      faith: opts.faith ?? 0.5,
      understanding: opts.understanding ?? 0.5,
      devotion: opts.devotion ?? 0.2,
    },
  };
  if (opts.poi) props.homePoiId = opts.poi;
  if (opts.storm !== undefined) addDomainBelief(props, 'player', 'storm', opts.storm);
  const e = { id, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}

function props(e: Entity): NpcProperties {
  return e.properties as unknown as NpcProperties;
}

function stormPower(world: World | null): BeliefPowerView {
  const state = createState();
  if (world) state.world = world;
  return createGameQuery({ state }).beliefPowers().find(p => p.domain === 'storm')!;
}

const STORM_BAR = DOMAIN_DEFS.storm.unlockThreshold;

// ── the pure sibling ─────────────────────────────────────────────────────────
describe('aggregateDomainDimensions (H1, pure)', () => {
  it('is all zeros with no believers at all', () => {
    expect(aggregateDomainDimensions(makeWorld(), 'player', 'storm'))
      .toEqual({ faith: 0, understanding: 0, devotion: 0 });
  });

  it('is all zeros when nobody has REACHED the domain', () => {
    const world = makeWorld();
    // strong faith, but their model of you has no storm in it
    addNpc(world, { faith: 1, understanding: 1, devotion: 1, storm: 0 });
    // and one who holds it below the visible floor
    addNpc(world, { faith: 1, understanding: 1, devotion: 1, storm: DOMAIN_REACH_FLOOR / 2 });
    expect(aggregateDomainDimensions(world, 'player', 'storm'))
      .toEqual({ faith: 0, understanding: 0, devotion: 0 });
  });

  it('means over a single reached believer are that believer', () => {
    const world = makeWorld();
    addNpc(world, { faith: 0.8, understanding: 0.4, devotion: 0.7, storm: 0.5 });
    const d = aggregateDomainDimensions(world, 'player', 'storm');
    expect(d.faith).toBeCloseTo(0.8, 6);
    expect(d.understanding).toBeCloseTo(0.4, 6);
    expect(d.devotion).toBeCloseTo(0.7, 6);
  });

  it('excludes non-reached believers from the mean', () => {
    const world = makeWorld();
    addNpc(world, { faith: 0.5, understanding: 1, devotion: 0.5, storm: 0.5 });
    // a big crowd of faith-bearers who do NOT hold storm: they must not dilute
    for (let i = 0; i < 20; i++) addNpc(world, { faith: 1, understanding: 0, devotion: 1, storm: 0 });
    const d = aggregateDomainDimensions(world, 'player', 'storm');
    expect(d.understanding).toBeCloseTo(1, 6);
    expect(d.faith).toBeCloseTo(0.5, 6);
  });

  it('weights by faith × (0.5 + 0.5·devotion) — the conviction aggregate’s weight', () => {
    const world = makeWorld();
    // A: faith 1, devotion 1 → w = 1.0 ; B: faith 0.5, devotion 0 → w = 0.25
    addNpc(world, { faith: 1, understanding: 1, devotion: 1, storm: 1 });
    addNpc(world, { faith: 0.5, understanding: 0, devotion: 0, storm: 1 });
    const d = aggregateDomainDimensions(world, 'player', 'storm');
    const wA = 1 * (0.5 + 0.5 * 1), wB = 0.5 * (0.5 + 0.5 * 0);
    expect(d.understanding).toBeCloseTo((wA * 1 + wB * 0) / (wA + wB), 6);
    expect(d.faith).toBeCloseTo((wA * 1 + wB * 0.5) / (wA + wB), 6);
    expect(d.devotion).toBeCloseTo((wA * 1 + wB * 0) / (wA + wB), 6);
  });

  it('is world-wide, not per-congregation (unlike conviction)', () => {
    const world = makeWorld();
    // Two towns, each with one reached believer of differing understanding.
    addNpc(world, { poi: 'a', faith: 1, understanding: 1, devotion: 0, storm: 1 });
    addNpc(world, { poi: 'b', faith: 1, understanding: 0, devotion: 0, storm: 1 });
    // Both weigh the same → the mean sits between them, which a per-congregation
    // "best bucket" reduction could never produce.
    expect(aggregateDomainDimensions(world, 'player', 'storm').understanding).toBeCloseTo(0.5, 6);
  });

  it('ignores faithless bystanders who nonetheless "believe" the domain', () => {
    const world = makeWorld();
    addNpc(world, { faith: 0, understanding: 1, devotion: 1, storm: 1 });
    expect(aggregateDomainDimensions(world, 'player', 'storm'))
      .toEqual({ faith: 0, understanding: 0, devotion: 0 });
  });
});

// ── the derived tier ─────────────────────────────────────────────────────────
describe('beliefPowers tier derivation (H1)', () => {
  it('dormant: nobody has heard of it', () => {
    const world = makeWorld();
    addNpc(world, { faith: 0.9, devotion: 0.9, storm: 0 });
    const p = stormPower(world);
    expect(p.tier).toBe('dormant');
    expect(p.unlocked).toBe(false);
    expect(p.dimensions).toEqual({ faith: 0, understanding: 0, devotion: 0 });
  });

  it('claim: conviction past half the unlock bar, still locked', () => {
    const world = makeWorld();
    // one convinced believer beside one unconvinced neighbour in the same town →
    // congregation conviction lands between the CLAIM bar and the unlock bar.
    addNpc(world, { poi: 'v', faith: 1, devotion: 1, storm: 0.6 });
    addNpc(world, { poi: 'v', faith: 1, devotion: 1, storm: 0 });
    const p = stormPower(world);
    expect(p.conviction).toBeGreaterThanOrEqual(CLAIM_CONVICTION_FRACTION * STORM_BAR);
    expect(p.conviction).toBeLessThan(STORM_BAR);
    expect(p.unlocked).toBe(false);
    expect(p.tier).toBe('claim');
  });

  it('command: unlocked, but the belief is not yet devout', () => {
    const world = makeWorld();
    addNpc(world, { poi: 'v', faith: 1, devotion: 0.2, storm: 1 });
    const p = stormPower(world);
    expect(p.unlocked).toBe(true);
    expect(p.dimensions!.devotion).toBeLessThan(DOCTRINE_DEVOTION_BAR);
    expect(p.tier).toBe('command');
  });

  it('doctrine: unlocked AND the reached believers are devout', () => {
    const world = makeWorld();
    addNpc(world, { poi: 'v', faith: 1, devotion: 0.9, storm: 1 });
    const p = stormPower(world);
    expect(p.unlocked).toBe(true);
    expect(p.dimensions!.devotion).toBeGreaterThanOrEqual(DOCTRINE_DEVOTION_BAR);
    expect(p.tier).toBe('doctrine');
  });

  it('doctrine sits exactly AT the devotion bar (inclusive)', () => {
    const world = makeWorld();
    addNpc(world, { poi: 'v', faith: 1, devotion: DOCTRINE_DEVOTION_BAR, storm: 1 });
    expect(stormPower(world).tier).toBe('doctrine');
  });

  it('regresses: doctrine → command → claim → dormant as belief decays', () => {
    const world = makeWorld();
    const believer = addNpc(world, { poi: 'v', faith: 1, devotion: 0.9, storm: 1 });
    expect(stormPower(world).tier).toBe('doctrine');

    // devotion slips (the loyalty half decays first) → the domain is still
    // commanded, but the belief no longer self-sustains.
    props(believer).beliefs.player.devotion = 0.2;
    expect(stormPower(world).tier).toBe('command');

    // now the storm itself fades out of their model of you: conviction drops
    // below the unlock bar, so the node RE-LOCKS to a mere claim.
    addDomainBelief(props(believer), 'player', 'storm', -0.7);
    const claimed = stormPower(world);
    expect(claimed.conviction).toBeLessThan(STORM_BAR);
    expect(claimed.conviction).toBeGreaterThanOrEqual(CLAIM_CONVICTION_FRACTION * STORM_BAR);
    expect(claimed.unlocked).toBe(false);
    expect(claimed.tier).toBe('claim');

    // …and finally out of earshot entirely
    addDomainBelief(props(believer), 'player', 'storm', -1);
    expect(stormPower(world).tier).toBe('dormant');
  });

  it('degrades honestly with NO world: fields present, zeroed, dormant', () => {
    const p = stormPower(null);
    expect(p.tier).toBe('dormant');
    expect(p.dimensions).toEqual({ faith: 0, understanding: 0, devotion: 0 });
    expect(p.conviction).toBe(0);
    expect(p.reach).toBe(0);
    expect(p.believers).toBe(0);
  });

  it('every domain carries both new fields, always', () => {
    const world = makeWorld();
    addNpc(world, { faith: 0.5, storm: 0.3 });
    const state = createState();
    state.world = world;
    for (const p of createGameQuery({ state }).beliefPowers()) {
      expect(p.dimensions).toBeDefined();
      expect(p.tier).toBeDefined();
    }
  });
});

// ── the wire: JSON + the bridge/MCP passthrough ──────────────────────────────
describe('beliefPowers over the wire (H1)', () => {
  function busFor(world: World): BusLike {
    const state = createState();
    state.world = world;
    const query = createGameQuery({ state });
    return {
      query,
      capabilities: () => [],
      preview: () => null,
      emit: () => {},
    };
  }

  it('stays JSON-serializable (views cross MCP/bus)', () => {
    const world = makeWorld();
    addNpc(world, { poi: 'v', faith: 1, devotion: 0.9, storm: 1 });
    const rows = stormPower(world);
    const round = JSON.parse(JSON.stringify(rows)) as BeliefPowerView;
    expect(round).toEqual(rows);
    expect(round.tier).toBe('doctrine');
    expect(typeof round.dimensions!.faith).toBe('number');
  });

  it('MCP `belief_powers` passthrough carries the new fields unreshaped', async () => {
    const world = makeWorld();
    addNpc(world, { poi: 'v', faith: 1, devotion: 0.9, storm: 1 });
    // the same dispatch tools/mcp-server.ts drives: query fn 'beliefPowers'
    const raw = await dispatchBus(busFor(world), 'query', { fn: 'beliefPowers' }, { allowWrite: false });
    const rows = JSON.parse(JSON.stringify(raw)) as BeliefPowerView[];
    const storm = rows.find(p => p.domain === 'storm')!;
    expect(storm.tier).toBe('doctrine');
    expect(storm.dimensions!.devotion).toBeCloseTo(0.9, 6);
    // the shape is unchanged apart from the two additions
    expect(Object.keys(storm).sort()).toEqual([
      'believers', 'blurb', 'conviction', 'dimensions', 'domain', 'label',
      'reach', 'threshold', 'tier', 'unlocked', 'verb',
    ]);
  });

  it('the explicit spiritId argument still routes (a rival reads dormant)', async () => {
    const world = makeWorld();
    addNpc(world, { poi: 'v', faith: 1, devotion: 0.9, storm: 1 });
    const raw = await dispatchBus(busFor(world), 'query', { fn: 'beliefPowers', args: ['rival:1'] }, { allowWrite: false });
    const rows = raw as BeliefPowerView[];
    expect(rows.every(p => p.tier === 'dormant')).toBe(true);
    expect(rows.every(p => p.dimensions!.faith === 0)).toBe(true);
  });
});
