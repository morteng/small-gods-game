import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { TICKS_PER_DAY, SOLAR_START_HOUR } from '@/core/calendar';
import { LLMClient, type LLMProvider } from '@/llm/llm-client';
import { ChronicleService } from '@/game/chronicle-service';

/**
 * An annal is PROSE, never a JSON envelope.
 *
 * `generateNpcBackfill` is shared transport: it also carries the NPC-backfill
 * JSON contract, and its offline mock answers
 * `{"narration": "The scene continues uneventfully."}`. The chronicle wrote
 * `res.content` straight into `ChronicleEntry.text`, so with no LLM configured the
 * WebGPU loading screen and the ANNALS panel both displayed literal JSON — seen in
 * a live GPU pass, 2026-07-25.
 *
 * The rule: a JSON body is REJECTED, and the deterministic offline annal (real
 * prose composed from the day's actual events) is used instead.
 */

const SOLAR_OFFSET_TICKS = (SOLAR_START_HOUR / 24) * TICKS_PER_DAY;
function dayBoundaryTick(dayIndex: number): number {
  return dayIndex * TICKS_PER_DAY - SOLAR_OFFSET_TICKS;
}
function stateAtDay(dayIndex: number) {
  const state = createState();
  state.clock.setNow(dayBoundaryTick(dayIndex));
  return state;
}
function clientReturning(content: string): LLMClient {
  const provider: LLMProvider = {
    isAvailable: () => true,
    name: () => 'mock',
    async generate() { return { content, latencyMs: 0 }; },
  };
  return new LLMClient(provider);
}

/** Generate one entry and return its text + whether it fell back to offline.
 *  The clock must advance AFTER construction: the constructor anchors its cursor
 *  to "today", so a day has to complete before there is anything to narrate. */
async function entryFrom(content: string): Promise<{ text: string; offline: boolean }> {
  const state = stateAtDay(1);
  const svc = new ChronicleService({ state, client: clientReturning(content) });
  state.clock.setNow(dayBoundaryTick(2));
  await svc.checkAndGenerate();
  const latest = svc.latest();
  expect(latest).not.toBeNull();
  return { text: latest!.text, offline: latest!.offline };
}

describe('chronicle annals are prose, never JSON', () => {
  it('REJECTS the offline mock envelope and falls back to the offline annal', async () => {
    // The exact string src/llm/llm-client.ts returns with no provider configured.
    const { text, offline } = await entryFrom('{"narration": "The scene continues uneventfully."}');
    expect(text).not.toContain('narration');
    expect(text).not.toContain('{');
    expect(offline).toBe(true);
    expect(text.length).toBeGreaterThan(0);
  });

  it('rejects any JSON object or array body', async () => {
    for (const body of [
      '{"text": "A quiet day."}',
      '{"annal":"x","extra":1}',
      '["one","two"]',
      '  {"narration":"padded"}  ',
    ]) {
      const { text, offline } = await entryFrom(body);
      expect(offline, `body ${body} should have fallen back`).toBe(true);
      expect(text).not.toContain('{');
      expect(text).not.toContain('[');
    }
  });

  it('rejects a body that merely LOOKS like JSON but is malformed', async () => {
    // A truncated response is not prose either — it would render as visible junk.
    const { offline } = await entryFrom('{"narration": "cut off mid');
    expect(offline).toBe(true);
  });

  it('rejects an empty or whitespace-only body', async () => {
    expect((await entryFrom('')).offline).toBe(true);
    expect((await entryFrom('   \n  ')).offline).toBe(true);
  });

  it('ACCEPTS real prose unchanged, including prose containing braces', async () => {
    const prose = 'The river rose in the night, and the millers cursed the small god of eaves.';
    const got = await entryFrom(prose);
    expect(got.text).toBe(prose);
    expect(got.offline).toBe(false);
  });

  it('accepts prose that happens to mention a brace mid-sentence', async () => {
    // The guard only parses bodies that START like JSON, so ordinary prose with a
    // stray brace is not misread as an envelope.
    const prose = 'The scribe wrote a { in the margin, and the abbot struck it out.';
    const got = await entryFrom(prose);
    expect(got.text).toBe(prose);
    expect(got.offline).toBe(false);
  });

  it('trims surrounding whitespace from accepted prose', async () => {
    const got = await entryFrom('  A dry week.  ');
    expect(got.text).toBe('A dry week.');
  });
});
