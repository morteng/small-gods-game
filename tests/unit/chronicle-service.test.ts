import { describe, it, expect, vi } from 'vitest';
import { createState } from '@/core/state';
import { TICKS_PER_DAY, SOLAR_START_HOUR } from '@/core/calendar';
import { LLMClient, type LLMProvider } from '@/llm/llm-client';
import { ChronicleService, CHRONICLE_RING_CAP } from '@/game/chronicle-service';

// Mirrors the service's private `dayBoundaryTick` — exact integer because
// TICKS_PER_DAY is a multiple of 24 (see core/calendar.ts).
const SOLAR_OFFSET_TICKS = (SOLAR_START_HOUR / 24) * TICKS_PER_DAY;
function dayBoundaryTick(dayIndex: number): number {
  return dayIndex * TICKS_PER_DAY - SOLAR_OFFSET_TICKS;
}

function stateAtDay(dayIndex: number) {
  const state = createState();
  state.clock.setNow(dayBoundaryTick(dayIndex));
  return state;
}

function mockClient(content: string): LLMClient {
  const provider: LLMProvider = {
    isAvailable: () => true,
    name: () => 'mock',
    async generate() { return { content, latencyMs: 0 }; },
  };
  return new LLMClient(provider);
}

function throwingClient(): LLMClient {
  const provider: LLMProvider = {
    isAvailable: () => true,
    name: () => 'mock-fail',
    async generate() { throw new Error('network down'); },
  };
  return new LLMClient(provider);
}

describe('ChronicleService — read-only guard', () => {
  it('never appends to the event log across a generation cycle', async () => {
    const state = stateAtDay(1);
    state.eventLog.append({ type: 'npc_death', npcId: 'n1', lineageId: 'l1', cause: 'plague' });
    const sizeBefore = state.eventLog.size();

    const svc = new ChronicleService({ state, client: mockClient('The plague took one soul.') });
    state.clock.setNow(dayBoundaryTick(2)); // day 1 has now fully completed
    await svc.checkAndGenerate();

    expect(state.eventLog.size()).toBe(sizeBefore); // unchanged — strictly read-only
    expect(svc.latest()?.text).toBe('The plague took one soul.');
  });
});

describe('ChronicleService — cadence', () => {
  it('does not generate on construction, nor before a day has completed', async () => {
    const state = stateAtDay(1);
    const svc = new ChronicleService({ state, client: mockClient('x') });
    await svc.checkAndGenerate(); // still day 1 — nothing completed yet
    expect(svc.latest()).toBeNull();
    expect(svc.entries()).toHaveLength(0);
  });

  it('generates exactly one entry once a day completes', async () => {
    const state = stateAtDay(1);
    const svc = new ChronicleService({ state, client: mockClient('Day one chronicle.') });
    state.clock.setNow(dayBoundaryTick(2));
    await svc.checkAndGenerate();
    expect(svc.entries()).toHaveLength(1);
    expect(svc.latest()?.dayIndex).toBe(1);
  });

  it('cursor advances: repeated calls the same day never re-narrate', async () => {
    const state = stateAtDay(1);
    const svc = new ChronicleService({ state, client: mockClient('once') });
    state.clock.setNow(dayBoundaryTick(2));
    await svc.checkAndGenerate();
    await svc.checkAndGenerate();
    await svc.checkAndGenerate();
    expect(svc.entries()).toHaveLength(1); // still just the one entry
  });

  it('advances day over day, each entry covering only its own day\'s events', async () => {
    const state = stateAtDay(1);
    state.clock.setNow(dayBoundaryTick(1) + 10);
    state.eventLog.append({ type: 'npc_death', npcId: 'day1-npc', lineageId: 'l', cause: 'day-one-cause' });
    const svc = new ChronicleService({ state });

    state.clock.setNow(dayBoundaryTick(2));
    await svc.checkAndGenerate();
    expect(svc.latest()?.text).toContain('day-one-cause');

    state.clock.setNow(dayBoundaryTick(2) + 10);
    state.eventLog.append({ type: 'npc_death', npcId: 'day2-npc', lineageId: 'l', cause: 'day-two-cause' });
    state.clock.setNow(dayBoundaryTick(3));
    await svc.checkAndGenerate();

    expect(svc.entries()).toHaveLength(2);
    expect(svc.latest()?.dayIndex).toBe(2);
    expect(svc.latest()?.text).toContain('day-two-cause');
    expect(svc.latest()?.text).not.toContain('day-one-cause'); // no re-narration of old events
  });

  it('under fast-forward, skips missed days rather than batching them', async () => {
    const state = stateAtDay(1);
    const svc = new ChronicleService({ state }); // offline (no client) — deterministic text

    // A day-2 event that gets skipped over entirely by a big forward jump.
    state.clock.setNow(dayBoundaryTick(2) + 10);
    state.eventLog.append({ type: 'npc_death', npcId: 'skipped-npc', lineageId: 'l', cause: 'never-narrated' });

    // A day-4 event that SHOULD land in the (only) generated entry.
    state.clock.setNow(dayBoundaryTick(4) + 10);
    state.eventLog.append({ type: 'npc_death', npcId: 'kept-npc', lineageId: 'l', cause: 'narrated-cause' });

    // Jump straight to day 5 — days 2/3/4 all completed "at once" (fast-forward).
    state.clock.setNow(dayBoundaryTick(5));
    await svc.checkAndGenerate();

    expect(svc.entries()).toHaveLength(1);       // one entry, not three
    expect(svc.latest()?.dayIndex).toBe(4);      // the MOST RECENT completed day
    expect(svc.latest()?.text).toContain('narrated-cause');
    expect(svc.latest()?.text).not.toContain('never-narrated'); // skipped day dropped, not batched
  });

  it('caps the pending generation at one at a time (single-flight)', async () => {
    const state = stateAtDay(1);
    let resolveGenerate!: (v: { content: string; latencyMs: number }) => void;
    const provider: LLMProvider = {
      isAvailable: () => true,
      name: () => 'slow',
      generate: () => new Promise((resolve) => { resolveGenerate = resolve; }),
    };
    const svc = new ChronicleService({ state, client: new LLMClient(provider) });
    state.clock.setNow(dayBoundaryTick(2));

    const first = svc.checkAndGenerate();
    const second = svc.checkAndGenerate(); // should be a no-op (already in flight)
    resolveGenerate({ content: 'the only entry', latencyMs: 0 });
    await Promise.all([first, second]);

    expect(svc.entries()).toHaveLength(1);
    expect(svc.latest()?.text).toBe('the only entry');
  });

  it('bounds the ring at CHRONICLE_RING_CAP entries', async () => {
    const state = stateAtDay(1);
    const svc = new ChronicleService({ state }); // offline, fast
    for (let d = 1; d <= CHRONICLE_RING_CAP + 5; d++) {
      state.clock.setNow(dayBoundaryTick(d + 1));
      await svc.checkAndGenerate();
    }
    expect(svc.entries().length).toBe(CHRONICLE_RING_CAP);
  });
});

describe('ChronicleService — offline fallback', () => {
  it('runs the deterministic offline template when no client is configured', async () => {
    const state = stateAtDay(1);
    state.clock.setNow(dayBoundaryTick(1) + 10);
    state.eventLog.append({ type: 'settlement_begin', poiId: 'p1', eventType: 'drought', severity: 0.5, durationTicks: 10 });
    const svc = new ChronicleService({ state }); // client omitted
    state.clock.setNow(dayBoundaryTick(2));
    await svc.checkAndGenerate();
    expect(svc.latest()?.offline).toBe(true);
    expect(svc.latest()?.text).toContain('drought');
  });

  it('is byte-identical across two identically-seeded runs', async () => {
    const build = async () => {
      const state = stateAtDay(1);
      state.clock.setNow(dayBoundaryTick(1) + 10);
      state.eventLog.append({ type: 'npc_death', npcId: 'x', lineageId: 'l', cause: 'plague' });
      state.eventLog.append({ type: 'npc_death', npcId: 'y', lineageId: 'l', cause: 'plague' });
      const svc = new ChronicleService({ state });
      state.clock.setNow(dayBoundaryTick(2));
      await svc.checkAndGenerate();
      return svc.latest()!.text;
    };
    const [a, b] = await Promise.all([build(), build()]);
    expect(a).toBe(b);
  });

  it('falls back to the offline annal when the configured LLM call fails', async () => {
    const state = stateAtDay(1);
    state.clock.setNow(dayBoundaryTick(1) + 10);
    state.eventLog.append({ type: 'npc_death', npcId: 'x', lineageId: 'l', cause: 'plague' });
    const svc = new ChronicleService({ state, client: throwingClient() });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.clock.setNow(dayBoundaryTick(2));
    await svc.checkAndGenerate();
    spy.mockRestore();

    expect(svc.latest()?.offline).toBe(true);
    expect(svc.latest()?.text).toContain('died');
  });

  it('setClient swaps the live tier without losing prior entries', async () => {
    const state = stateAtDay(1);
    const svc = new ChronicleService({ state }); // offline
    state.clock.setNow(dayBoundaryTick(2));
    await svc.checkAndGenerate();
    expect(svc.latest()?.offline).toBe(true);

    svc.setClient(mockClient('now narrated by an LLM'));
    state.eventLog.append({ type: 'npc_birth', npcId: 'z', parentIds: [], lineageId: 'l' });
    state.clock.setNow(dayBoundaryTick(3));
    await svc.checkAndGenerate();

    expect(svc.entries()).toHaveLength(2);
    expect(svc.latest()?.offline).toBe(false);
    expect(svc.latest()?.text).toBe('now narrated by an LLM');
  });
});
