import { describe, it, expect } from 'vitest';
import { validateUiSpec, UISPEC_BUDGETS, type UiSpec, type UiSpecBlock } from '@/story/uispec';
import type { Command } from '@/sim/command/types';

const CMD: Command = { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'n1' }, seq: 0 };

function longStr(n: number): string {
  return 'x'.repeat(n);
}

describe('validateUiSpec — no-scroll budgets', () => {
  it('passes a within-budget spec through unchanged (modulo optional fields)', () => {
    const spec: UiSpec = {
      title: 'Whisper to Ada',
      body: [
        { kind: 'npcLine', who: 'Ada', text: 'I am afraid.' },
        { kind: 'paragraph', text: 'Their thoughts lie open.' },
        { kind: 'divider' },
        { kind: 'beliefBar', label: 'Faith', value: 0.6 },
      ],
      choices: [{ text: 'Soothe', command: CMD, hint: 'eases it' }],
      musicCue: 'tender',
    };
    expect(validateUiSpec(spec)).toEqual(spec);
  });

  it('truncates an over-long title, block text, choice text and hint', () => {
    const v = validateUiSpec({
      title: longStr(200),
      body: [{ kind: 'paragraph', text: longStr(500) }],
      choices: [{ text: longStr(200), command: CMD, hint: longStr(200) }],
    });
    expect(v.title.length).toBe(UISPEC_BUDGETS.title);
    expect((v.body[0] as { text: string }).text.length).toBe(UISPEC_BUDGETS.blockChars);
    expect(v.choices[0].text.length).toBe(UISPEC_BUDGETS.choiceChars);
    expect(v.choices[0].hint!.length).toBe(UISPEC_BUDGETS.hintChars);
  });

  it('drops excess blocks and choices beyond the budget', () => {
    const body: UiSpecBlock[] = Array.from({ length: 20 }, () => ({ kind: 'divider' as const }));
    const choices = Array.from({ length: 12 }, (_, i) => ({ text: `c${i}`, command: CMD }));
    const v = validateUiSpec({ title: 't', body, choices });
    expect(v.body).toHaveLength(UISPEC_BUDGETS.blocks);
    expect(v.choices).toHaveLength(UISPEC_BUDGETS.choices);
  });

  it('clamps a playerLine block text to the block-char budget', () => {
    const v = validateUiSpec({
      title: 't',
      body: [{ kind: 'playerLine', text: longStr(500) }],
      choices: [],
    });
    expect(v.body[0].kind).toBe('playerLine');
    expect((v.body[0] as { text: string }).text.length).toBe(UISPEC_BUDGETS.blockChars);
  });

  it('clamps belief-bar values into 0–1', () => {
    const v = validateUiSpec({
      title: 't',
      body: [
        { kind: 'beliefBar', label: 'hi', value: 4 },
        { kind: 'beliefBar', label: 'lo', value: -2 },
      ],
      choices: [],
    });
    expect((v.body[0] as { value: number }).value).toBe(1);
    expect((v.body[1] as { value: number }).value).toBe(0);
  });

  it('is total — never throws, and a choiceless card is valid', () => {
    const v = validateUiSpec({ title: '', body: [], choices: [] });
    expect(v.body).toEqual([]);
    expect(v.choices).toEqual([]);
  });

  it('clamps a wordCloud: token count, per-token chars, weight range, bad tone', () => {
    const tokens = Array.from({ length: 40 }, (_, i) => ({ text: `w${i}`, weight: 0.5, tone: 'need' as const }));
    tokens.push({ text: longStr(80), weight: 5, tone: 'need' });
    tokens.push({ text: 'weird', weight: -1, tone: 'bogus' as unknown as 'need' });
    const v = validateUiSpec({ title: 't', body: [{ kind: 'wordCloud', tokens }], choices: [] });
    const cloud = v.body[0] as { kind: 'wordCloud'; tokens: { text: string; weight: number; tone: string }[] };
    expect(cloud.kind).toBe('wordCloud');
    expect(cloud.tokens.length).toBe(UISPEC_BUDGETS.cloudTokens);
    for (const t of cloud.tokens) {
      expect(t.text.length).toBeLessThanOrEqual(UISPEC_BUDGETS.cloudTokenChars);
      expect(t.weight).toBeGreaterThanOrEqual(0);
      expect(t.weight).toBeLessThanOrEqual(1);
    }
  });

  it('drops empty-text cloud tokens and falls a bad tone back to memory', () => {
    const v = validateUiSpec({
      title: 't',
      body: [{ kind: 'wordCloud', tokens: [
        { text: '', weight: 0.5, tone: 'need' },
        { text: 'keep', weight: 0.5, tone: 'zzz' as unknown as 'need' },
      ] }],
      choices: [],
    });
    const cloud = v.body[0] as { tokens: { text: string; tone: string }[] };
    expect(cloud.tokens.map(t => t.text)).toEqual(['keep']);
    expect(cloud.tokens[0].tone).toBe('memory');
  });
});
