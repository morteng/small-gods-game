import { describe, it, expect } from 'vitest';
import {
  GarnishThrottle, buildGarnishPrompt, sanitizeGarnish,
  GARNISH_MAX_CHARS, GARNISH_MIN_INTERVAL_MS,
  type GarnishInput,
} from '@/game/affordance/bubble-garnish';

function input(over: Partial<GarnishInput> = {}): GarnishInput {
  return {
    speakerName: 'Bram', role: 'farmer', warm: true, relType: 'friend',
    partnerName: 'Cora', worry: null, baseLine: 'Well met, friend!', ...over,
  };
}

describe('GarnishThrottle', () => {
  it('allows a first call, then blocks a second inside the rate window / while in flight', () => {
    const t = new GarnishThrottle();
    expect(t.canGarnish(0)).toBe(true);
    t.begin(0);
    // In flight → blocked even at a much later time.
    expect(t.canGarnish(10_000)).toBe(false);
    t.end(0.0001);
    // Freed, but the rate interval hasn't elapsed since begin(0).
    expect(t.canGarnish(GARNISH_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(t.canGarnish(GARNISH_MIN_INTERVAL_MS)).toBe(true);
  });

  it('stops dead once the session USD cap is reached', () => {
    const t = new GarnishThrottle(0.01, 0); // tiny cap, no rate limit
    expect(t.canGarnish(0)).toBe(true);
    t.begin(0); t.end(0.02); // one pricey call blows the cap
    expect(t.spent).toBeCloseTo(0.02, 6);
    expect(t.canGarnish(1000)).toBe(false);
  });

  it('banks only positive costs; a failed call (end(0)) does not move spend', () => {
    const t = new GarnishThrottle(1, 0);
    t.begin(0); t.end(0);
    expect(t.spent).toBe(0);
    expect(t.canGarnish(0)).toBe(true);
  });

  it('a single in-flight lock prevents overlapping calls', () => {
    const t = new GarnishThrottle(1, 0);
    t.begin(0);
    expect(t.canGarnish(0)).toBe(false); // locked until end()
    t.end(0);
    expect(t.canGarnish(0)).toBe(true);
  });
});

describe('buildGarnishPrompt', () => {
  it('carries the seed line, speaker, partner, and tie into the user prompt', () => {
    const { system, user } = buildGarnishPrompt(input({ baseLine: 'Fine weather, eh?' }));
    expect(system).toMatch(/ASCII/);
    expect(system).toContain(String(GARNISH_MAX_CHARS));
    expect(user).toContain('Bram');
    expect(user).toContain('Cora');
    expect(user).toContain('friend');
    expect(user).toContain('Fine weather, eh?');
  });

  it('injects a worry hint when the speaker has a grinding need, and a mood swing for friction', () => {
    const worried = buildGarnishPrompt(input({ worry: 'prosperity' })).user;
    expect(worried).toMatch(/money is tight/i);
    const barbed = buildGarnishPrompt(input({ warm: false, relType: 'rival' })).user;
    expect(barbed).toMatch(/prickly/i);
  });
});

describe('sanitizeGarnish', () => {
  const FALLBACK = 'Well met, friend!';

  it('passes a clean short line through unchanged', () => {
    expect(sanitizeGarnish('Fine day for the fields.', FALLBACK)).toBe('Fine day for the fields.');
  });

  it('takes only the first non-empty line and strips wrapping quotes', () => {
    expect(sanitizeGarnish('"Good to see you."\n\n(they smile)', FALLBACK)).toBe('Good to see you.');
  });

  it('normalises curly quotes / em-dashes to ASCII rather than dropping them', () => {
    // The UI pixel font renders curly quotes / em-dashes as blanks.
    const out = sanitizeGarnish('It’s a hard road — mind yourself', FALLBACK);
    expect(out).toMatch(/^It's a hard road - mind/);
    expect(/[^\x20-\x7E]/.test(out)).toBe(false);
  });

  it('drops stray non-ASCII glyphs (emoji, accents)', () => {
    const out = sanitizeGarnish('Bonne journée 🙂 friend', FALLBACK);
    expect(/[^\x20-\x7E]/.test(out)).toBe(false);
    expect(out).toContain('friend');
  });

  it('clamps an over-long line on a word boundary and tidies trailing punctuation', () => {
    const long = 'The harvest looks thin this year and the roads are full of thieves besides';
    const out = sanitizeGarnish(long, FALLBACK);
    expect(out.length).toBeLessThanOrEqual(GARNISH_MAX_CHARS);
    expect(out).not.toMatch(/[\s,;:-]$/);
  });

  it('falls back when the reply is empty or becomes empty after filtering', () => {
    expect(sanitizeGarnish('', FALLBACK)).toBe(FALLBACK);
    expect(sanitizeGarnish('🙂🙂', FALLBACK)).toBe(FALLBACK); // all-emoji → nothing left
  });
});
