import { describe, it, expect } from 'vitest';
import type { AppendedEvent, SimEvent } from '@/core/events';
import type { CalendarTick } from '@/core/calendar';
import {
  buildChroniclePrompt, renderOfflineAnnal, selectChronicleEvents, eventFactLine,
  MAX_CHRONICLE_EVENTS, CHRONICLER_SYSTEM_PROMPT, type ChronicleWindow,
} from '@/llm/chronicle-prompt-builder';

let nextId = 1;
function appended(event: SimEvent, t = 0): AppendedEvent {
  return { id: nextId++, t, event };
}

const CALENDAR: CalendarTick = { year: 2, season: 'autumn', day: 5, dayOfYear: 29 };

describe('eventFactLine', () => {
  it('templates npc_death with the cause, faithfully', () => {
    const line = eventFactLine(appended({ type: 'npc_death', npcId: 'n1', lineageId: 'l1', cause: 'starvation' }));
    expect(line).toContain('starvation');
    expect(line).toContain('died');
  });

  it('templates settlement_begin (weather/social events) with severity', () => {
    const line = eventFactLine(appended({ type: 'settlement_begin', poiId: 'p1', eventType: 'drought', severity: 0.75, durationTicks: 100 }));
    expect(line).toContain('drought');
    expect(line).toContain('0.75');
  });

  it('templates omen (a portent) with its severity', () => {
    const line = eventFactLine(appended({ type: 'omen', spiritId: 'player', poiId: 'p1', severity: 0.5 }));
    expect(line.toLowerCase()).toContain('portent');
  });

  it('templates crossing_upgraded — first build (no from) reads as a fresh log laid', () => {
    const line = eventFactLine(appended({ type: 'crossing_upgraded', crossingId: 'c1', x: 1, y: 2, to: 0, toLabel: 'log' }));
    expect(line).toBe('A log was laid where the way crosses the water.');
  });

  it('templates crossing_upgraded — an upgrade names both tiers', () => {
    const line = eventFactLine(appended({ type: 'crossing_upgraded', crossingId: 'c1', x: 1, y: 2, to: 6, toLabel: 'stone arch', from: 5, fromLabel: 'timber arch' }));
    expect(line).toBe('The crossing was raised from a timber arch to a stone arch.');
  });

  it('falls back to a generic line for an unhandled event type rather than throwing', () => {
    const line = eventFactLine(appended({ type: 'region_realized', region: { x: 0, y: 0, w: 1, h: 1 }, cause: 'miracle' }));
    expect(typeof line).toBe('string');
    expect(line.length).toBeGreaterThan(0);
  });
});

describe('selectChronicleEvents', () => {
  it('returns everything, chronologically, when under the cap', () => {
    const events = [
      appended({ type: 'npc_birth', npcId: 'a', parentIds: [], lineageId: 'l' }, 2),
      appended({ type: 'npc_death', npcId: 'b', lineageId: 'l', cause: 'old_age' }, 1),
    ];
    const selected = selectChronicleEvents(events);
    expect(selected).toHaveLength(2);
    expect(selected[0].t).toBe(1); // chronological order restored
    expect(selected[1].t).toBe(2);
  });

  it('caps at MAX_CHRONICLE_EVENTS, keeping the most salient (deaths over whispers)', () => {
    const events: AppendedEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(appended({ type: 'whisper', spiritId: 'player', npcId: `w${i}` }, i));
    }
    // Bury three deaths in the middle of a flood of routine whispers.
    events.push(appended({ type: 'npc_death', npcId: 'd1', lineageId: 'l', cause: 'plague' }, 10));
    events.push(appended({ type: 'npc_death', npcId: 'd2', lineageId: 'l', cause: 'plague' }, 11));
    events.push(appended({ type: 'npc_death', npcId: 'd3', lineageId: 'l', cause: 'plague' }, 12));

    const selected = selectChronicleEvents(events, MAX_CHRONICLE_EVENTS);
    expect(selected).toHaveLength(MAX_CHRONICLE_EVENTS);
    const deaths = selected.filter((a) => a.event.type === 'npc_death');
    expect(deaths).toHaveLength(3); // higher-weighted deaths always survive the cap
    // Chronological order is restored after ranking.
    for (let i = 1; i < selected.length; i++) expect(selected[i].t).toBeGreaterThanOrEqual(selected[i - 1].t);
  });
});

describe('buildChroniclePrompt', () => {
  const events: AppendedEvent[] = [
    appended({ type: 'npc_death', npcId: 'n1', lineageId: 'l1', cause: 'starvation' }, 5),
    appended({ type: 'settlement_begin', poiId: 'p1', eventType: 'drought', severity: 0.6, durationTicks: 500 }, 3),
  ];
  const window: ChronicleWindow = { events, calendar: CALENDAR };

  it('carries the register instructions in the system prompt', () => {
    const prompt = buildChroniclePrompt(window);
    expect(prompt.system).toBe(CHRONICLER_SYSTEM_PROMPT);
    expect(prompt.system.toLowerCase()).toContain('portent');
    expect(prompt.system.toLowerCase()).toContain('sin');
    // Attribution constraint: cause is God/sin/portent, never politics.
    expect(prompt.system.toLowerCase()).toContain('never');
  });

  it('templates each event into a terse factual line in the user prompt', () => {
    const prompt = buildChroniclePrompt(window);
    expect(prompt.user).toContain('starvation');
    expect(prompt.user).toContain('drought');
    expect(prompt.user).toContain('0.60');
  });

  it('carries calendar context (year/season/day)', () => {
    const prompt = buildChroniclePrompt(window);
    expect(prompt.user).toContain('2');       // year
    expect(prompt.user).toContain('AUTUMN');  // season (uppercased header)
    expect(prompt.user).toContain('29');      // dayOfYear
  });

  it('contains no free prose from the events themselves — only their structured fields', () => {
    // SimEvent has no prose fields; the user prompt for these two events should
    // consist only of the calendar header + the two templated fact lines + the
    // closing instruction — nothing invented.
    const prompt = buildChroniclePrompt(window);
    const factLines = selectChronicleEvents(events).map((a) => eventFactLine(a));
    for (const line of factLines) expect(prompt.user).toContain(line);
  });

  it('reports an empty-day window honestly', () => {
    const empty = buildChroniclePrompt({ events: [], calendar: CALENDAR });
    expect(empty.user.toLowerCase()).toContain('nothing was recorded');
  });

  it('stays within the ~500-800 token prompt budget even at the event cap', () => {
    const many: AppendedEvent[] = [];
    for (let i = 0; i < MAX_CHRONICLE_EVENTS * 3; i++) {
      many.push(appended({ type: 'npc_death', npcId: `n${i}`, lineageId: 'l', cause: 'plague' }, i));
    }
    const prompt = buildChroniclePrompt({ events: many, calendar: CALENDAR });
    expect(prompt.estimatedTokens).toBeLessThan(900);
  });
});

describe('renderOfflineAnnal (deterministic offline fallback)', () => {
  const events: AppendedEvent[] = [
    appended({ type: 'settlement_begin', poiId: 'p1', eventType: 'drought', severity: 0.6, durationTicks: 500 }, 1),
    appended({ type: 'npc_death', npcId: 'n1', lineageId: 'l1', cause: 'starvation' }, 2),
    appended({ type: 'npc_death', npcId: 'n2', lineageId: 'l1', cause: 'starvation' }, 3),
    appended({ type: 'npc_death', npcId: 'n3', lineageId: 'l1', cause: 'starvation' }, 4),
  ];
  const window: ChronicleWindow = { events, calendar: CALENDAR };

  it('produces a dull, honest templated sentence naming the drought and the dead', () => {
    const text = renderOfflineAnnal(window);
    expect(text).toContain('drought');
    expect(text).toContain('3 died');
  });

  it('is byte-identical for byte-identical input (no Math.random)', () => {
    const a = renderOfflineAnnal(window);
    const b = renderOfflineAnnal({ events: events.slice(), calendar: { ...CALENDAR } });
    expect(a).toBe(b);
  });

  it('is honest about an empty day', () => {
    expect(renderOfflineAnnal({ events: [], calendar: CALENDAR })).toContain('nothing was recorded');
  });
});
