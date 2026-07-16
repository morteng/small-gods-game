/**
 * F3 guards (spec §7, fate-arc-guards): seed_arc with unmet seedWhen is REJECTED;
 * an unknown shape is rejected; seeding past MAX_LIVE_ARCS is rejected; and a
 * rejected arc call never kills the deliberation — the other tool calls in the
 * same response still apply. Plus the library-integrity guard (every predicate a
 * shape names exists in the registry — the sim-currency discipline) and the
 * abandon_arc guards.
 */
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { LLMClient, MockLLMProvider, type LLMToolCall } from '@/llm/llm-client';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { initNpcProps } from '@/world/npc-helpers';
import type { ActiveEvent, GameMap, Tile, Entity } from '@/core/types';
import type { GameState } from '@/core/state';
import { FateArcStore } from '@/sim/fate/arc-store';
import { ARC_LIBRARY, ARC_SHAPE_KEYS, openArcFromShape, getArcShape, isShapeSeedable } from '@/sim/fate/arc-library';
import { ARC_PREDICATES } from '@/sim/fate/arc-predicates';
import { MAX_LIVE_ARCS } from '@/sim/fate/arc-types';
import { STUB_ARC_SHAPE } from '@/sim/fate/arc-stub';
import { parseFateToolCalls, type FateToolCtx } from '@/game/fate/fate-tools';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import type { FateFocus } from '@/game/fate/fate-context';

// ─── harness ──────────────────────────────────────────────────────────────────

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 4; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 4; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 4, height: 4, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function makeState(): GameState {
  const world = new World(map());
  const p = initNpcProps('r1', 'farmer', 7); p.homePoiId = 'poi1';
  world.addEntity({ id: 'r1', kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> } as Entity);
  const plotThreads = new PlotThreadStore();
  const t = plotThreads.open('trial', { kind: 'settlement', poiId: 'poi1' }, 0);
  plotThreads.advance(t.id, 'hardship', 1, 0);
  return {
    world, plotThreads, staging: new StagingBuffer(), clock: new SimClock(),
    worldSeed: { name: 'T', pois: [{ id: 'poi1', name: 'Northvale' }] },
    fateArcs: new FateArcStore(),
  } as unknown as GameState;
}

function toolCtx(over?: Partial<NonNullable<FateToolCtx['arcs']>>): FateToolCtx {
  return {
    validPoiIds: new Set(['poi1', 'causal:flood:0001']),
    now: 100,
    arcs: {
      liveArcIds: new Set([1]),
      liveArcCount: 1,
      isShapeSeedable: () => true,
      validNpcIds: new Set(['r1']),
      ...over,
    },
  };
}

function seedCall(args: Record<string, unknown>, id = 's0'): LLMToolCall {
  return { id, name: 'seed_arc', arguments: args };
}
function abandonCall(args: Record<string, unknown>, id = 'a0'): LLMToolCall {
  return { id, name: 'abandon_arc', arguments: args };
}
function client(calls: LLMToolCall[]): LLMClient {
  return new LLMClient(new MockLLMProvider(0, { cannedToolCalls: calls }));
}
function brainFor(state: GameState, calls: LLMToolCall[]): FateBrainService {
  return new FateBrainService({
    getState: () => state, getCapableClient: () => client(calls),
    isScrubbed: () => false, emitCommand: () => {},
  });
}
const focus = (): FateFocus => ({ kind: 'pulse' });

// ─── the library itself ─────────────────────────────────────────────────────────

describe('arc library integrity (sim-currency discipline)', () => {
  it('ships the seven spec shapes, keyed consistently', () => {
    expect([...ARC_SHAPE_KEYS].sort()).toEqual([
      'brother_from_within', 'exile_returns_crowned', 'kingmaker_discarded',
      'martyr_by_accident', 'strongman_dies_abroad', 'the_null_event', 'victory_that_loses',
    ]);
    for (const [key, shape] of Object.entries(ARC_LIBRARY)) expect(shape.key).toBe(key);
  });

  it('every seedWhen + goal predicate a shape names EXISTS in the registry', () => {
    for (const shape of Object.values(ARC_LIBRARY)) {
      for (const p of shape.seedWhen) expect(ARC_PREDICATES[p], `${shape.key} seedWhen "${p}"`).toBeDefined();
      for (const g of shape.goals) expect(ARC_PREDICATES[g.predicate], `${shape.key} goal "${g.predicate}"`).toBeDefined();
    }
  });

  it('does NOT offer the offline stub shape through seed_arc', () => {
    expect(ARC_SHAPE_KEYS).not.toContain(STUB_ARC_SHAPE);
    expect(getArcShape(STUB_ARC_SHAPE)).toBeUndefined();
  });

  it('the_null_event is seedable in any settled world (Fate may decline to author)', () => {
    expect(isShapeSeedable('the_null_event', makeState())).toBe(true);
  });
});

// ─── parse-level guards ─────────────────────────────────────────────────────────

describe('parseFateToolCalls — seed_arc guards', () => {
  it('rejects an unknown shape', () => {
    const { arcSeeds } = parseFateToolCalls([seedCall({ shape: 'deus_ex_machina' })], toolCtx());
    expect(arcSeeds).toHaveLength(0);
  });

  it('rejects a shape whose seedWhen preconditions are not met', () => {
    const ctx = toolCtx({ isShapeSeedable: () => false });
    const { arcSeeds } = parseFateToolCalls([seedCall({ shape: 'the_null_event' })], ctx);
    expect(arcSeeds).toHaveLength(0);
  });

  it('rejects a seed at MAX_LIVE_ARCS', () => {
    const ctx = toolCtx({ liveArcCount: MAX_LIVE_ARCS });
    const { arcSeeds } = parseFateToolCalls([seedCall({ shape: 'the_null_event' })], ctx);
    expect(arcSeeds).toHaveLength(0);
  });

  it('counts seeds within ONE response against the cap incrementally', () => {
    const ctx = toolCtx({ liveArcCount: MAX_LIVE_ARCS - 1 });
    const { arcSeeds } = parseFateToolCalls([
      seedCall({ shape: 'the_null_event' }, 's0'),
      seedCall({ shape: 'exile_returns_crowned' }, 's1'),   // one slot left — this must drop
    ], ctx);
    expect(arcSeeds).toHaveLength(1);
    expect(arcSeeds[0].shape).toBe('the_null_event');
  });

  it('drift-guards the cast: unknown poiIds, causal-site ids, and unknown npc ids are filtered (arc still seeds)', () => {
    const { arcSeeds } = parseFateToolCalls([seedCall({
      shape: 'the_null_event',
      castPoiIds: ['poi1', 'ghost-town', 'causal:flood:0001'],
      castNpcIds: ['r1', 'ghost-npc', 42],
    })], toolCtx());
    expect(arcSeeds).toHaveLength(1);
    expect(arcSeeds[0].cast).toEqual({ poiIds: ['poi1'], npcIds: ['r1'] });
  });

  it('drops every npc cast ref when the ctx carries no validNpcIds set', () => {
    const { arcSeeds } = parseFateToolCalls(
      [seedCall({ shape: 'the_null_event', castNpcIds: ['r1'] })],
      toolCtx({ validNpcIds: undefined }),
    );
    expect(arcSeeds).toHaveLength(1);
    expect(arcSeeds[0].cast.npcIds).toEqual([]);
  });

  it('drops every seed_arc when the ctx supplies no arc context at all (safe default)', () => {
    const ctx: FateToolCtx = { validPoiIds: new Set(['poi1']), now: 0 };
    const { arcSeeds } = parseFateToolCalls([seedCall({ shape: 'the_null_event' })], ctx);
    expect(arcSeeds).toHaveLength(0);
  });
});

describe('parseFateToolCalls — abandon_arc guards', () => {
  it('accepts a live arcId with a reason', () => {
    const { arcAbandons } = parseFateToolCalls([abandonCall({ arcId: 1, reason: 'the heir came home' })], toolCtx());
    expect(arcAbandons).toEqual([{ arcId: 1, reason: 'the heir came home' }]);
  });

  it('rejects an arcId that is not live (stale, finished, or hallucinated)', () => {
    const { arcAbandons } = parseFateToolCalls([abandonCall({ arcId: 99, reason: 'x' })], toolCtx());
    expect(arcAbandons).toHaveLength(0);
  });

  it('rejects a non-integer arcId', () => {
    const { arcAbandons } = parseFateToolCalls([abandonCall({ arcId: '1', reason: 'x' })], toolCtx());
    expect(arcAbandons).toHaveLength(0);
  });

  it('rejects a missing or blank reason (it feeds the chronicler)', () => {
    const { arcAbandons } = parseFateToolCalls([
      abandonCall({ arcId: 1 }, 'a0'),
      abandonCall({ arcId: 1, reason: '   ' }, 'a1'),
    ], toolCtx());
    expect(arcAbandons).toHaveLength(0);
  });

  it('drops every abandon_arc when the ctx supplies no arc context', () => {
    const ctx: FateToolCtx = { validPoiIds: new Set(['poi1']), now: 0 };
    const { arcAbandons } = parseFateToolCalls([abandonCall({ arcId: 1, reason: 'x' })], ctx);
    expect(arcAbandons).toHaveLength(0);
  });
});

// ─── through the brain (rejections never kill the deliberation) ─────────────────

describe('FateBrainService — arc tools end-to-end', () => {
  it('seed_arc opens an arc with goals + budget from the LIBRARY, cast drift-guarded', async () => {
    const state = makeState();
    await brainFor(state, [seedCall({
      shape: 'the_null_event', castPoiIds: ['poi1', 'ghost'], castNpcIds: ['r1', 'ghost'],
    })]).deliberate(focus());
    const arcs = state.fateArcs.live();
    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toMatchObject({
      shape: 'the_null_event', stage: 'seeded',
      pressureBudget: ARC_LIBRARY.the_null_event.budget,
      cast: { poiIds: ['poi1'], npcIds: ['r1'] },
    });
    expect(arcs[0].goals).toEqual(ARC_LIBRARY.the_null_event.goals.map((g) => ({ ...g, met: false })));
  });

  it('the seedWhen gate is evaluated against REAL state: victory_that_loses needs a thriving settlement', async () => {
    const state = makeState();
    await brainFor(state, [seedCall({ shape: 'victory_that_loses' })]).deliberate(focus());
    expect(state.fateArcs.live()).toHaveLength(0);           // no festival ⇒ unmet ⇒ rejected

    const ev: ActiveEvent = { type: 'festival', poiId: 'poi1', severity: 0.5, durationTicks: 100, ticksElapsed: 0 };
    state.world!.activeEvents.set('poi1', [ev]);
    await brainFor(state, [seedCall({ shape: 'victory_that_loses' })]).deliberate(focus());
    expect(state.fateArcs.live()).toHaveLength(1);           // now the precondition holds
    expect(state.fateArcs.live()[0].shape).toBe('victory_that_loses');
  });

  it('never seeds past MAX_LIVE_ARCS even when the model insists', async () => {
    const state = makeState();
    const shape = getArcShape('the_null_event')!;
    for (let i = 0; i < MAX_LIVE_ARCS; i++) {
      openArcFromShape(state.fateArcs, shape, { poiIds: [], npcIds: [] }, 0);
    }
    await brainFor(state, [seedCall({ shape: 'the_null_event' })]).deliberate(focus());
    expect(state.fateArcs.live()).toHaveLength(MAX_LIVE_ARCS);
  });

  it('abandon_arc folds a live arc, recording the reason', async () => {
    const state = makeState();
    const arc = openArcFromShape(state.fateArcs, getArcShape('the_null_event')!, { poiIds: [], npcIds: [] }, 0);
    await brainFor(state, [abandonCall({ arcId: arc.id, reason: 'the moment passed' })]).deliberate(focus());
    const folded = state.fateArcs.get(arc.id)!;
    expect(folded.stage).toBe('abandoned');
    expect(folded.abandonedReason).toBe('the moment passed');
    expect(state.fateArcs.live()).toHaveLength(0);
  });

  it('a REJECTED arc call does NOT kill the deliberation — sibling calls still apply', async () => {
    const state = makeState();
    await brainFor(state, [
      seedCall({ shape: 'deus_ex_machina' }),                                    // rejected: unknown shape
      abandonCall({ arcId: 99, reason: 'x' }),                                   // rejected: not live
      { id: 'b0', name: 'arm_staged_beat',
        arguments: { subjectPoiId: 'poi1', threadId: 1, hard: 'none', soft: 'A hush falls.' } },
      seedCall({ shape: 'the_null_event' }, 's9'),                               // valid — must still land
    ]).deliberate(focus());
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(1);           // the beat survived
    expect(state.fateArcs.live()).toHaveLength(1);                               // and so did the good seed
    expect(state.fateArcs.live()[0].shape).toBe('the_null_event');
  });

  it('arc tools stay disabled (drop, not crash) when the state has no arc store', async () => {
    const state = makeState();
    delete (state as { fateArcs?: FateArcStore }).fateArcs;                      // legacy/partial state
    await brainFor(state, [seedCall({ shape: 'the_null_event' })]).deliberate(focus());
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(0);           // nothing armed, nothing thrown
  });
});
