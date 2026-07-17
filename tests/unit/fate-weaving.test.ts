/**
 * F5 — weaving (spec §4.5/§5/§7, fate-weaving):
 *
 *  - `advance_arc` carries no effect of its own: the inner tool is re-validated by
 *    its OWN parser (same drift guards + caps as a direct call), and every
 *    servedArcs claim must name a LIVE arc with budget left holding an UNMET goal
 *    the resolved verb plausibly moves (§8.4: a GOAL, never mere subject overlap).
 *  - §7: given two arcs sharing a settlement, one pressure serving both records
 *    servedArcs.length === 2 — on BOTH arcs' audit trails.
 *  - The audit trail is snapshot-backed (bounded ring), budget has teeth, and a
 *    recorded pressure promotes a seeded arc to 'building'.
 *  - Allowlist discipline: every advanceable lever resolves to a capability-
 *    registry verb; every goal→verb mapping names real predicates + real verbs.
 */
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { EventLog } from '@/core/events';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import type { GameMap, Tile } from '@/core/types';
import type { GameState } from '@/core/state';
import type { Command } from '@/sim/command/types';
import { CAPABILITY_REGISTRY } from '@/sim/command/registry';
import { FateArcStore } from '@/sim/fate/arc-store';
import { getArcShape, openArcFromShape } from '@/sim/fate/arc-library';
import { ARC_PREDICATES } from '@/sim/fate/arc-predicates';
import { GOAL_ADVANCING_VERBS, verbAdvancesGoal, advancingVerbsFor } from '@/sim/fate/arc-advance';
import { MAX_APPLIED_PRESSURES, type FateArc } from '@/sim/fate/arc-types';
import {
  FATE_TOOLS, ADVANCE_ARC_TOOLS, parseFateToolCalls,
  type FateToolCtx, type ArcToolMeta,
} from '@/game/fate/fate-tools';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import { LLMClient, MockLLMProvider, type LLMToolCall } from '@/llm/llm-client';

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

/** Full-enough state for snapshot round-trips AND brain deliberations. The open
 *  thread grounds poi1 as a valid Fate subject (validPoiIds is threads-derived). */
function makeState(): GameState {
  const m = map();
  const clock = new SimClock();
  const plotThreads = new PlotThreadStore();
  const t = plotThreads.open('trial', { kind: 'settlement', poiId: 'poi1' }, 0);
  plotThreads.advance(t.id, 'hardship', 1, 0);
  return {
    world: new World(m), map: m, clock, rng: createRng(1),
    eventLog: new EventLog(clock), spirits: new Map(),
    worldSeed: { name: 'T', pois: [{ id: 'poi1', name: 'Northvale' }, { id: 'poi2', name: 'Southmarsh' }] },
    plotThreads, staging: new StagingBuffer(),
    fateArcs: new FateArcStore(),
  } as unknown as GameState;
}

/** Two live arcs sharing poi1 — both wanting settlement_in_crisis. */
function twoArcs(state: GameState): [FateArc, FateArc] {
  const a = openArcFromShape(state.fateArcs, getArcShape('strongman_dies_abroad')!, { poiIds: ['poi1'], npcIds: [] }, 0);
  const b = openArcFromShape(state.fateArcs, getArcShape('kingmaker_discarded')!, { poiIds: ['poi1'], npcIds: [] }, 0);
  return [a, b];
}

const meta = (over?: Partial<ArcToolMeta>): ArcToolMeta => ({
  shape: 'strongman_dies_abroad', castPoiIds: ['poi1'], portentCount: 0,
  unmetGoals: ['settlement_in_crisis'], budget: 4, ...over,
});

function weaveCtx(metas: Array<[number, ArcToolMeta]>): FateToolCtx {
  return {
    validPoiIds: new Set(['poi1']),
    validRivalIds: new Set(['rival-1']),
    validLordPoiIds: new Set(['poi1']),
    now: 100,
    arcs: {
      liveArcIds: new Set(metas.map(([id]) => id)),
      liveArcCount: metas.length,
      isShapeSeedable: () => true,
      arcMeta: new Map(metas),
    },
  };
}

function advCall(args: Record<string, unknown>, id = 'w0'): LLMToolCall {
  return { id, name: 'advance_arc', arguments: args };
}
const nudgeArgs = { subjectPoiId: 'poi1', delta: 0.3 };

// ─── allowlist discipline (sim-currency) ────────────────────────────────────────

describe('weaving allowlists — pressures are LEGAL SIM MUTATIONS only', () => {
  it('every advance_arc lever is a FATE tool resolving to a capability-registry verb', () => {
    const fateToolNames = new Set(FATE_TOOLS.map((t) => t.name));
    for (const [tool, verb] of Object.entries(ADVANCE_ARC_TOOLS)) {
      expect(fateToolNames.has(tool), `lever "${tool}" must be a FATE tool`).toBe(true);
      expect(CAPABILITY_REGISTRY[verb], `verb "${verb}" must be in the registry`).toBeDefined();
    }
  });

  it('every GOAL_ADVANCING_VERBS entry names a real predicate and real registry verbs', () => {
    for (const [predicate, verbs] of Object.entries(GOAL_ADVANCING_VERBS)) {
      expect(ARC_PREDICATES[predicate], `predicate "${predicate}"`).toBeDefined();
      for (const v of verbs) expect(CAPABILITY_REGISTRY[v], `verb "${v}" for "${predicate}"`).toBeDefined();
    }
  });

  it('verbAdvancesGoal checks a GOAL, not subject overlap — unknown pairs are false', () => {
    expect(verbAdvancesGoal('nudge_severity', 'settlement_in_crisis')).toBe(true);
    expect(verbAdvancesGoal('nudge_severity', 'player_has_believers')).toBe(false);
    expect(verbAdvancesGoal('nudge_severity', 'no_such_predicate')).toBe(false);
  });

  it('advancingVerbsFor unions only the UNMET goals', () => {
    expect(advancingVerbsFor([
      { predicate: 'settlement_in_crisis', met: true },
      { predicate: 'player_has_believers', met: false },
    ])).toEqual(['inject_npc']);
  });
});

// ─── parse-level: advance_arc guards ────────────────────────────────────────────

describe('parseFateToolCalls — advance_arc', () => {
  it('§7: a pressure serving two arcs that share a settlement records servedArcs.length === 2', () => {
    const ctx = weaveCtx([[1, meta()], [2, meta({ shape: 'kingmaker_discarded', budget: 3 })]]);
    const { arcAdvances } = parseFateToolCalls(
      [advCall({ tool: 'nudge_event_severity', args: nudgeArgs, servedArcs: [1, 2] })], ctx,
    );
    expect(arcAdvances).toHaveLength(1);
    expect(arcAdvances[0].servedArcs).toEqual([1, 2]);
    expect(arcAdvances[0].servedArcs).toHaveLength(2);
    expect(arcAdvances[0].command).toMatchObject({
      verb: 'nudge_severity', source: 'fate', target: { kind: 'settlement', poiId: 'poi1' }, payload: { delta: 0.3 },
    });
  });

  it('drops a claim on an arc with NO unmet goal the verb moves (goal check, not overlap)', () => {
    // Arc 2 shares poi1 in its cast but wants believers — a nudge moves nothing it needs.
    const ctx = weaveCtx([[1, meta()], [2, meta({ unmetGoals: ['player_has_believers'] })]]);
    const { arcAdvances } = parseFateToolCalls(
      [advCall({ tool: 'nudge_event_severity', args: nudgeArgs, servedArcs: [1, 2] })], ctx,
    );
    expect(arcAdvances[0].servedArcs).toEqual([1]);
  });

  it('a met goal earns no claim', () => {
    const ctx = weaveCtx([[1, meta({ unmetGoals: [] })]]);
    const { arcAdvances } = parseFateToolCalls(
      [advCall({ tool: 'nudge_event_severity', args: nudgeArgs, servedArcs: [1] })], ctx,
    );
    expect(arcAdvances).toHaveLength(0);
  });

  it('drops a claim on a spent arc (budget ≤ 0) and on a non-live arc id', () => {
    const ctx = weaveCtx([[1, meta({ budget: 0 })], [2, meta({ budget: 2 })]]);
    const { arcAdvances } = parseFateToolCalls(
      [advCall({ tool: 'nudge_event_severity', args: nudgeArgs, servedArcs: [1, 2, 99] })], ctx,
    );
    expect(arcAdvances[0].servedArcs).toEqual([2]);
  });

  it('drops the WHOLE call when no claim survives — a serve-nothing advance is not a free command', () => {
    const ctx = weaveCtx([[1, meta({ budget: 0 })]]);
    const { arcAdvances, commands } = parseFateToolCalls(
      [advCall({ tool: 'nudge_event_severity', args: nudgeArgs, servedArcs: [1, 99] })], ctx,
    );
    expect(arcAdvances).toHaveLength(0);
    expect(commands).toHaveLength(0);
  });

  it('dedupes servedArcs and drops non-integer ids', () => {
    const ctx = weaveCtx([[1, meta()]]);
    const { arcAdvances } = parseFateToolCalls(
      [advCall({ tool: 'nudge_event_severity', args: nudgeArgs, servedArcs: [1, 1, '2', 1.5] })], ctx,
    );
    expect(arcAdvances[0].servedArcs).toEqual([1]);
  });

  it('rejects a non-advanceable tool WITHOUT killing the deliberation (siblings survive)', () => {
    const ctx = weaveCtx([[1, meta()]]);
    const { arcAdvances } = parseFateToolCalls([
      advCall({ tool: 'smite', args: {}, servedArcs: [1] }, 'w0'),                 // not a lever
      advCall({ tool: 'arm_staged_beat', args: {}, servedArcs: [1] }, 'w1'),       // staged ≠ advanceable
      advCall({ tool: 'nudge_event_severity', args: nudgeArgs, servedArcs: [1] }, 'w2'),
    ], ctx);
    expect(arcAdvances).toHaveLength(1);
    expect(arcAdvances[0].command.verb).toBe('nudge_severity');
  });

  it('the inner call is re-validated by ITS OWN parser: ungrounded poi / bad delta / bad args drop the advance', () => {
    const ctx = weaveCtx([[1, meta()]]);
    const { arcAdvances } = parseFateToolCalls([
      advCall({ tool: 'nudge_event_severity', args: { subjectPoiId: 'ghost', delta: 0.3 }, servedArcs: [1] }, 'w0'),
      advCall({ tool: 'nudge_event_severity', args: { subjectPoiId: 'poi1', delta: 'lots' }, servedArcs: [1] }, 'w1'),
      advCall({ tool: 'nudge_event_severity', args: 'not-an-object', servedArcs: [1] }, 'w2'),
      advCall({ tool: 'nudge_event_severity', servedArcs: [1] }, 'w3'),
    ], ctx);
    expect(arcAdvances).toHaveLength(0);
  });

  it('inner caps still apply: an oversized delta rides through clamped, exactly as a direct call', () => {
    const ctx = weaveCtx([[1, meta()]]);
    const { arcAdvances } = parseFateToolCalls(
      [advCall({ tool: 'nudge_event_severity', args: { subjectPoiId: 'poi1', delta: 9 }, servedArcs: [1] })], ctx,
    );
    expect(arcAdvances[0].command.payload).toEqual({ delta: 0.5 });
  });

  it('set_lord_stance weaves too (tithe pressure toward a crisis goal)', () => {
    const ctx = weaveCtx([[1, meta()]]);
    const { arcAdvances } = parseFateToolCalls(
      [advCall({ tool: 'set_lord_stance', args: { poiId: 'poi1', tithe: 0.15 }, servedArcs: [1] })], ctx,
    );
    expect(arcAdvances).toHaveLength(1);
    expect(arcAdvances[0].command).toMatchObject({ verb: 'set_lord_stance', payload: { tithe: 0.15 } });
  });

  it('drops every advance_arc when the ctx supplies no arc metadata (safe default)', () => {
    const noArcs: FateToolCtx = { validPoiIds: new Set(['poi1']), now: 0 };
    expect(parseFateToolCalls(
      [advCall({ tool: 'nudge_event_severity', args: nudgeArgs, servedArcs: [1] })], noArcs,
    ).arcAdvances).toHaveLength(0);
    const noMeta = weaveCtx([]);
    noMeta.arcs!.arcMeta = undefined;
    expect(parseFateToolCalls(
      [advCall({ tool: 'nudge_event_severity', args: nudgeArgs, servedArcs: [1] })], noMeta,
    ).arcAdvances).toHaveLength(0);
  });
});

// ─── the store: audit ring, budget teeth, stage promotion ───────────────────────

describe('FateArcStore.recordPressure — the audit trail', () => {
  it('records on every live served arc, spends budget, and promotes seeded → building', () => {
    const state = makeState();
    const [a, b] = twoArcs(state);
    const served = state.fateArcs.recordPressure({
      tick: 7, verb: 'nudge_severity', args: { delta: 0.3 }, servedArcs: [a.id, b.id],
    });
    expect(served).toEqual([a.id, b.id]);
    for (const arc of [state.fateArcs.get(a.id)!, state.fateArcs.get(b.id)!]) {
      expect(arc.applied).toHaveLength(1);
      expect(arc.applied[0]).toMatchObject({ tick: 7, verb: 'nudge_severity', servedArcs: [a.id, b.id] });
      expect(arc.stage).toBe('building');
    }
    expect(state.fateArcs.get(a.id)!.pressureBudget).toBe(getArcShape('strongman_dies_abroad')!.budget - 1);
    expect(state.fateArcs.get(b.id)!.pressureBudget).toBe(getArcShape('kingmaker_discarded')!.budget - 1);
  });

  it('filters folded arcs out of the recorded servedArcs; serving nothing records nothing', () => {
    const state = makeState();
    const [a, b] = twoArcs(state);
    state.fateArcs.abandon(a.id, 'folded');
    const served = state.fateArcs.recordPressure({ tick: 1, verb: 'bias_event', args: {}, servedArcs: [a.id, b.id] });
    expect(served).toEqual([b.id]);
    expect(state.fateArcs.get(a.id)!.applied).toHaveLength(0);
    expect(state.fateArcs.get(b.id)!.applied[0].servedArcs).toEqual([b.id]);   // the trail never lies
    expect(state.fateArcs.recordPressure({ tick: 2, verb: 'bias_event', args: {}, servedArcs: [a.id] })).toEqual([]);
  });

  it('the applied ring is bounded (MAX_APPLIED_PRESSURES) and budget floors at 0', () => {
    const state = makeState();
    const [a] = twoArcs(state);
    for (let i = 0; i < MAX_APPLIED_PRESSURES + 3; i++) {
      state.fateArcs.recordPressure({ tick: i, verb: 'nudge_severity', args: {}, servedArcs: [a.id] });
    }
    const arc = state.fateArcs.get(a.id)!;
    expect(arc.applied).toHaveLength(MAX_APPLIED_PRESSURES);
    expect(arc.applied[0].tick).toBe(3);                     // oldest three dropped
    expect(arc.pressureBudget).toBe(0);                      // never negative
  });

  it('the audit trail RIDES THE SNAPSHOT — pressures round-trip and scrub away', () => {
    const state = makeState();
    const [a, b] = twoArcs(state);
    const before = captureSnapshot(state);
    state.fateArcs.recordPressure({ tick: 5, verb: 'nudge_severity', args: { delta: 0.2 }, servedArcs: [a.id, b.id] });

    // Round-trip: capture → wipe → restore preserves the trail exactly.
    const after = captureSnapshot(state);
    state.fateArcs.hydrate([]);
    restoreSnapshot(state, after);
    const restored = state.fateArcs.get(a.id)!;
    expect(restored.applied).toEqual([{ tick: 5, verb: 'nudge_severity', args: { delta: 0.2 }, servedArcs: [a.id, b.id] }]);
    expect(restored.stage).toBe('building');
    expect(restored.pressureBudget).toBe(getArcShape('strongman_dies_abroad')!.budget - 1);

    // Scrub: restoring the earlier point un-happens the pressure (sim truth).
    restoreSnapshot(state, before);
    expect(state.fateArcs.get(a.id)!.applied).toHaveLength(0);
    expect(state.fateArcs.get(a.id)!.stage).toBe('seeded');
  });
});

// ─── through the brain (end-to-end) ─────────────────────────────────────────────

function brainFor(state: GameState, calls: LLMToolCall[], emitted: Array<Omit<Command, 'seq'>>): FateBrainService {
  return new FateBrainService({
    getState: () => state,
    getCapableClient: () => new LLMClient(new MockLLMProvider(0, { cannedToolCalls: calls })),
    isScrubbed: () => false,
    emitCommand: (c) => emitted.push(c),
  });
}

describe('FateBrainService — weaving end-to-end', () => {
  it('one advance_arc serving two live arcs emits ONE command and writes BOTH audit trails', async () => {
    const state = makeState();
    const [a, b] = twoArcs(state);          // both goals (settlement_in_crisis) unmet: no crisis active
    const emitted: Array<Omit<Command, 'seq'>> = [];
    await brainFor(state, [
      advCall({ tool: 'nudge_event_severity', args: { subjectPoiId: 'poi1', delta: 0.4 }, servedArcs: [a.id, b.id] }),
    ], emitted).deliberate({ kind: 'pulse' });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ verb: 'nudge_severity', target: { kind: 'settlement', poiId: 'poi1' } });
    for (const arc of [state.fateArcs.get(a.id)!, state.fateArcs.get(b.id)!]) {
      expect(arc.applied).toHaveLength(1);
      expect(arc.applied[0].servedArcs).toEqual([a.id, b.id]);
      expect(arc.stage).toBe('building');
    }
  });

  it('an advance whose every served arc folded in the SAME response drops — command and all', async () => {
    const state = makeState();
    const [a, b] = twoArcs(state);
    state.fateArcs.abandon(b.id, 'clear the second arc');    // leave only arc a live
    const emitted: Array<Omit<Command, 'seq'>> = [];
    await brainFor(state, [
      { id: 'a0', name: 'abandon_arc', arguments: { arcId: a.id, reason: 'the moment passed' } },
      advCall({ tool: 'nudge_event_severity', args: nudgeArgs, servedArcs: [a.id] }),
    ], emitted).deliberate({ kind: 'pulse' });
    expect(emitted).toHaveLength(0);                          // no orphaned pressure command
    expect(state.fateArcs.get(a.id)!.applied).toHaveLength(0);
  });

  it('a partial fold keeps the pressure honest: only the surviving arc is recorded', async () => {
    const state = makeState();
    const [a, b] = twoArcs(state);
    const emitted: Array<Omit<Command, 'seq'>> = [];
    await brainFor(state, [
      { id: 'a0', name: 'abandon_arc', arguments: { arcId: a.id, reason: 'folded first' } },
      advCall({ tool: 'nudge_event_severity', args: nudgeArgs, servedArcs: [a.id, b.id] }),
    ], emitted).deliberate({ kind: 'pulse' });
    expect(emitted).toHaveLength(1);
    expect(state.fateArcs.get(a.id)!.applied).toHaveLength(0);
    expect(state.fateArcs.get(b.id)!.applied[0].servedArcs).toEqual([b.id]);
  });

  it('an arc-linked HARD beat records an inject_npc pressure at arm time (single-arc audit)', async () => {
    const state = makeState();
    const [a] = twoArcs(state);
    const emitted: Array<Omit<Command, 'seq'>> = [];
    await brainFor(state, [
      // Foreshadow-then-land in one response (the F4 gate counts same-response omens).
      { id: 'p0', name: 'plant_portent', arguments: { arcId: a.id, kind: 'dream', omen: 'A black sail.' } },
      { id: 'b0', name: 'arm_staged_beat', arguments: { subjectPoiId: 'poi1', hard: 'inject_npc', role: 'preacher', arcId: a.id } },
    ], emitted).deliberate({ kind: 'pulse' });
    const arc = state.fateArcs.get(a.id)!;
    expect(arc.applied).toHaveLength(1);
    expect(arc.applied[0]).toMatchObject({ verb: 'inject_npc', servedArcs: [a.id] });
    expect(arc.stage).toBe('building');
    expect(arc.pressureBudget).toBe(getArcShape('strongman_dies_abroad')!.budget - 1);
  });
});
