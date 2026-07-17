/**
 * F6 — era-authoring (spec §6, the D2 skip loop's missing half): an arc that
 * spans a time-skip authors the era summary from its own goals + applied
 * pressures. Deterministic sim-side settle (`settleArcsAcrossSkip` — the same
 * dispositions sweep the pulse runs, so a premise that collapsed over the era
 * folds honestly and its beats never fire), a deterministic offline era annal
 * (the honest no-LLM fallback), LLM output validated at the boundary, and the
 * entry riding the snapshot-backed chronicle ring with an `era` marker.
 */
import { describe, it, expect, vi } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { createState } from '@/core/state';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { ChronicleStore } from '@/core/chronicle-store';
import type { ActiveEvent, GameMap, Tile } from '@/core/types';
import type { GameState } from '@/core/state';
import { FateArcStore } from '@/sim/fate/arc-store';
import { getArcShape, openArcFromShape } from '@/sim/fate/arc-library';
import { settleArcsAcrossSkip, type EraArcDigest } from '@/sim/fate/arc-era';
import type { FateArc } from '@/sim/fate/arc-types';
import { applySkip, type SkipSummary } from '@/sim/time-skip';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import { dayIndexForTick, formatCalendarTick } from '@/core/calendar';
import {
  buildEraChroniclePrompt, renderOfflineEraAnnal, eraArcFactLine,
  ERA_CHRONICLER_ADDENDUM, type EraChronicleWindow,
} from '@/llm/chronicle-prompt-builder';
import { ChronicleService } from '@/game/chronicle-service';
import { LLMClient, type LLMProvider } from '@/llm/llm-client';

// ─── harness (mirrors fate-arc-abandon.test.ts) ────────────────────────────────

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
  return {
    world: new World(map()), staging: new StagingBuffer(), clock: new SimClock(),
    worldSeed: { name: 'T', pois: [{ id: 'poi1', name: 'Northvale' }, { id: 'poi2', name: 'Southmarsh' }] },
    fateArcs: new FateArcStore(),
  } as unknown as GameState;
}

function event(type: ActiveEvent['type'], poiId: string): ActiveEvent {
  return { type, poiId, severity: 0.5, durationTicks: 1000, ticksElapsed: 0 };
}

/** Seed victory_that_loses (seedWhen: settlement_thriving) under a live festival. */
function seedVictoryArc(state: GameState): FateArc {
  state.world!.activeEvents.set('poi1', [event('festival', 'poi1')]);
  return openArcFromShape(state.fateArcs, getArcShape('victory_that_loses')!, { poiIds: ['poi1'], npcIds: [] }, 0);
}

function armHeavyBeat(state: GameState, arcId: number) {
  return state.staging.arm({
    subject: { kind: 'settlement', poiId: 'poi1' }, trigger: { kind: 'discovery' },
    hard: [{ verb: 'inject_npc', source: 'fate', target: { kind: 'settlement', poiId: 'poi1' }, payload: { role: 'refugee' }, seq: 0 }],
    arcId, stagedTick: 0,
  });
}

function summaryOf(years: number): SkipSummary {
  return {
    fromTick: 0, toTick: years * TICKS_PER_YEAR, years,
    deaths: 7, births: 11, believersBefore: 3, believersAfter: 5,
  };
}

function mockClient(content: string): LLMClient {
  const provider: LLMProvider = {
    isAvailable: () => true, name: () => 'mock',
    async generate() { return { content, latencyMs: 0 }; },
  };
  return new LLMClient(provider);
}

function throwingClient(): LLMClient {
  const provider: LLMProvider = {
    isAvailable: () => true, name: () => 'mock-fail',
    async generate() { throw new Error('network down'); },
  };
  return new LLMClient(provider);
}

// ─── settleArcsAcrossSkip: the deterministic sim-side settle ────────────────────

describe('settleArcsAcrossSkip — spanning arcs settle and digest', () => {
  it('a worked arc whose goal came true over the era LANDS and digests its full story', () => {
    const state = makeState();
    const arc = seedVictoryArc(state);
    state.fateArcs.recordPressure({ tick: 1, verb: 'bias_event', args: {}, servedArcs: [arc.id] });
    state.fateArcs.recordPressure({ tick: 2, verb: 'bias_event', args: {}, servedArcs: [arc.id] });
    state.fateArcs.plantPortent(arc.id, { tick: 3, kind: 'sky', discovered: true, text: 'a red comet stood over the field' });
    // Over the "skip", a crisis took hold — the goal is now true post-skip.
    state.world!.activeEvents.set('poi2', [event('drought', 'poi2')]);

    const digests = settleArcsAcrossSkip(state);
    expect(digests).toHaveLength(1);
    const d = digests[0];
    expect(d.stage).toBe('landed');
    expect(d.title).toBe('The Victory That Loses');
    expect(d.logline).toBeTruthy();
    expect(d.goals).toEqual([{ predicate: 'settlement_in_crisis', met: true }]);
    expect(d.pressures).toEqual([{ verb: 'bias_event', count: 2 }]);
    expect(d.portentsPlanted).toBe(1);
    expect(d.portentsDiscovered).toBe(1);
    expect(d.omens).toEqual(['a red comet stood over the field']);
    // The store itself settled — the digest is truth, not a parallel copy.
    expect(state.fateArcs.get(arc.id)!.stage).toBe('landed');
  });

  it('an arc whose premise collapsed over the era ABANDONS, and its beat never fires', () => {
    const state = makeState();
    const arc = seedVictoryArc(state);
    const beat = armHeavyBeat(state, arc.id);
    state.world!.activeEvents.delete('poi1');   // the festival ended somewhere in the skipped years

    const digests = settleArcsAcrossSkip(state);
    expect(digests).toHaveLength(1);
    expect(digests[0].stage).toBe('abandoned');
    expect(digests[0].abandonedReason).toMatch(/settlement_thriving/);
    expect(state.staging.get(beat.id)!.status).toBe('expired');   // §7: never fires its blow
  });

  it('a worked arc whose goal stayed unmet remains BUILDING — unfinished, honestly', () => {
    const state = makeState();
    const arc = seedVictoryArc(state);          // festival persists across the closed-form skip
    state.fateArcs.recordPressure({ tick: 1, verb: 'bias_event', args: {}, servedArcs: [arc.id] });
    const digests = settleArcsAcrossSkip(state);
    expect(digests[0].stage).toBe('building');
    expect(digests[0].goals).toEqual([{ predicate: 'settlement_in_crisis', met: false }]);
  });

  it('returns [] when no arc spans the skip, and tolerates partial state', () => {
    expect(settleArcsAcrossSkip(makeState())).toEqual([]);
    expect(settleArcsAcrossSkip({} as GameState)).toEqual([]);
  });

  it('is deterministic: identical construction ⇒ deep-equal digests', () => {
    const run = () => {
      const state = makeState();
      const arc = seedVictoryArc(state);
      state.fateArcs.recordPressure({ tick: 1, verb: 'bias_event', args: {}, servedArcs: [arc.id] });
      state.fateArcs.plantPortent(arc.id, { tick: 2, kind: 'sky', discovered: false, text: 'the sun dimmed at noon' });
      return settleArcsAcrossSkip(state);
    };
    expect(run()).toEqual(run());
  });
});

// ─── the offline era annal: deterministic, honest, numbers preserved ────────────

describe('renderOfflineEraAnnal — the deterministic fallback', () => {
  const calendar = formatCalendarTick(20 * TICKS_PER_YEAR);

  it('carries every skip number faithfully', () => {
    const text = renderOfflineEraAnnal({ summary: summaryOf(20), arcs: [], calendar });
    expect(text).toContain('20 year(s) passed');
    expect(text).toContain('7 died');
    expect(text).toContain('11 were born');
    expect(text).toContain('from 3 to 5');
  });

  it('with no spanning arcs, says so honestly (the null author)', () => {
    const text = renderOfflineEraAnnal({ summary: summaryOf(5), arcs: [], calendar });
    expect(text).toContain('Fate authored nothing in those years');
  });

  it('narrates each disposition: landed / abandoned / unfinished', () => {
    const base: Omit<EraArcDigest, 'stage'> = {
      id: 1, shape: 'victory_that_loses', title: 'The Victory That Loses',
      goals: [{ predicate: 'settlement_in_crisis', met: true }],
      pressures: [{ verb: 'bias_event', count: 2 }],
      portentsPlanted: 1, portentsDiscovered: 1, omens: [],
    };
    const window = (stage: EraArcDigest['stage'], abandonedReason?: string): EraChronicleWindow => ({
      summary: summaryOf(10), arcs: [{ ...base, stage, abandonedReason }], calendar,
    });
    expect(renderOfflineEraAnnal(window('landed'))).toContain('"The Victory That Loses" came to pass, after 2 pressure(s), with 1 omen(s) planted (1 seen)');
    expect(renderOfflineEraAnnal(window('abandoned', 'the moment passed'))).toContain('was abandoned (the moment passed)');
    expect(renderOfflineEraAnnal(window('building'))).toContain('remained unfinished');
  });

  it('is byte-identical for byte-identical input', () => {
    const w: EraChronicleWindow = { summary: summaryOf(20), arcs: [], calendar };
    expect(renderOfflineEraAnnal(w)).toBe(renderOfflineEraAnnal(structuredClone(w)));
  });
});

// ─── the era prompt: register + given facts, nothing invented ───────────────────

describe('buildEraChroniclePrompt', () => {
  it('frames the annalist register with the era addendum and carries the facts', () => {
    const state = makeState();
    const arc = seedVictoryArc(state);
    state.fateArcs.recordPressure({ tick: 1, verb: 'bias_event', args: {}, servedArcs: [arc.id] });
    state.fateArcs.plantPortent(arc.id, { tick: 2, kind: 'sky', discovered: false, text: 'a red comet' });
    const arcs = settleArcsAcrossSkip(state);

    const prompt = buildEraChroniclePrompt({ summary: summaryOf(20), arcs, calendar: formatCalendarTick(20 * TICKS_PER_YEAR) });
    expect(prompt.system).toContain('monastic annalist');
    expect(prompt.system).toContain(ERA_CHRONICLER_ADDENDUM.trim().split('\n')[0]);
    expect(prompt.user).toContain('20 year(s) passed');
    expect(prompt.user).toContain('7 died and 11 were born');
    expect(prompt.user).toContain('numbered 3 before, and 5 after');
    expect(prompt.user).toContain('The design "The Victory That Loses"');
    expect(prompt.user).toContain('bias_event x1');
    expect(prompt.user).toContain('Omens: 1 planted, 0 seen');
    expect(prompt.user).toContain('a red comet');
  });

  it('with no arcs, states the null honestly rather than inviting invention', () => {
    const prompt = buildEraChroniclePrompt({ summary: summaryOf(3), arcs: [], calendar: formatCalendarTick(3 * TICKS_PER_YEAR) });
    expect(prompt.user).toContain('Fate authored nothing in those years');
  });

  it('eraArcFactLine reports goals met/unmet and the no-pressure case', () => {
    const line = eraArcFactLine({
      id: 1, shape: 's', title: 'T', stage: 'seeded',
      goals: [{ predicate: 'settlement_in_crisis', met: false }],
      pressures: [], portentsPlanted: 0, portentsDiscovered: 0, omens: [],
    });
    expect(line).toContain('settlement in crisis (not come true)');
    expect(line).toContain('No hand was laid upon the world');
  });
});

// ─── ChronicleService.generateEra: the surface + the boundary ───────────────────

describe('ChronicleService.generateEra', () => {
  it('offline: pushes ONE era-marked entry with the deterministic annal, read-only over the log', async () => {
    const state = createState();
    const sizeBefore = state.eventLog.size();
    const svc = new ChronicleService({ state });   // no client — offline path
    await svc.generateEra(summaryOf(20), []);

    expect(state.eventLog.size()).toBe(sizeBefore);          // strictly read-only
    expect(svc.entries()).toHaveLength(1);
    const entry = svc.latest()!;
    expect(entry.era).toBe(true);
    expect(entry.offline).toBe(true);
    expect(entry.text).toContain('20 year(s) passed');
    expect(entry.dayIndex).toBe(dayIndexForTick(20 * TICKS_PER_YEAR) - 1);
  });

  it('online: the LLM words it (era-marked, not offline)', async () => {
    const state = createState();
    const svc = new ChronicleService({ state, client: mockClient('In those years the comet burned and the proud were humbled.') });
    await svc.generateEra(summaryOf(20), []);
    const entry = svc.latest()!;
    expect(entry.era).toBe(true);
    expect(entry.offline).toBe(false);
    expect(entry.text).toBe('In those years the comet burned and the proud were humbled.');
  });

  it('falls back to the offline era annal when the LLM call fails', async () => {
    const state = createState();
    const svc = new ChronicleService({ state, client: throwingClient() });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await svc.generateEra(summaryOf(20), []);
    spy.mockRestore();
    expect(svc.latest()!.era).toBe(true);
    expect(svc.latest()!.offline).toBe(true);
    expect(svc.latest()!.text).toContain('20 year(s) passed');
  });

  it('rejects a blank LLM reply at the boundary — never pushes an empty annal', async () => {
    const state = createState();
    const svc = new ChronicleService({ state, client: mockClient('   ') });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await svc.generateEra(summaryOf(20), []);
    spy.mockRestore();
    expect(svc.latest()!.offline).toBe(true);                // honest fallback
    expect(svc.latest()!.text.length).toBeGreaterThan(0);
  });

  it('bumps the daily cursor so the daily path never re-narrates a mid-era day', async () => {
    const state = createState();
    const svc = new ChronicleService({ state });
    const summary = summaryOf(20);
    await svc.generateEra(summary, []);
    expect(svc.entries()).toHaveLength(1);

    // Arrive at the post-skip tick; the daily check must NOT add an entry for
    // a day the era entry already covers.
    state.clock.setNow(summary.toTick);
    await svc.checkAndGenerate();
    expect(svc.entries()).toHaveLength(1);
  });

  it('the era entry rides the chronicle ring with its era flag (snapshot discipline)', async () => {
    const state = createState();
    const svc = new ChronicleService({ state });
    await svc.generateEra(summaryOf(20), []);

    const restored = new ChronicleStore();
    restored.hydrate(state.chronicle!.serialize());
    expect(restored.latest()!.era).toBe(true);
    expect(restored.latest()!.text).toBe(svc.latest()!.text);
  });
});

// ─── end to end: applySkip → settle → era annal, fully deterministic ────────────

describe('F6 end-to-end — a skip with a spanning arc authors its era', () => {
  it('the arc that spanned the skip tells its story in the era annal, identically every run', () => {
    const run = () => {
      const state = makeState();
      const log = new EventLog(state.clock);
      const arc = seedVictoryArc(state);
      state.fateArcs.recordPressure({ tick: 1, verb: 'bias_event', args: {}, servedArcs: [arc.id] });

      const summary = applySkip(state.world!, state.clock, createRng(42), log, 20)!;
      expect(summary.years).toBe(20);
      const digests = settleArcsAcrossSkip(state);
      expect(digests).toHaveLength(1);
      // The festival persists across a closed-form skip (nothing ticks), so the
      // premise holds and the crisis goal stayed unmet: honestly unfinished.
      expect(digests[0].stage).toBe('building');

      return renderOfflineEraAnnal({ summary, arcs: digests, calendar: formatCalendarTick(summary.toTick) });
    };
    const a = run();
    expect(a).toContain('20 year(s) passed');
    expect(a).toContain('"The Victory That Loses" remained unfinished');
    expect(a).toBe(run());                                    // deterministic, same seed
  });
});
