import { describe, it, expect } from 'vitest';
import {
  scriptedPlay, validatePack, StoryRunner, Scope, selectStorylet, eligibleStorylets,
  evalExpr, DumbDirector,
} from '@/story';
import type { StoryPack, Director, StoryHost } from '@/story';
import { createRng } from '@/core/rng';
import { droughtOmenPack } from '@/story/samples/the-drought-omen';

function captureHost(): { host: StoryHost; verbs: string[] } {
  const verbs: string[] = [];
  return { host: { dispatch: (e) => verbs.push(e.verb) }, verbs };
}

describe('storylet sample pack', () => {
  it('validates clean', () => {
    expect(validatePack(droughtOmenPack)).toEqual([]);
  });

  it('plays no-key with the dumb director and only fallbacks (no AI required)', () => {
    const tx = scriptedPlay(droughtOmenPack, { seed: 7, choices: [0] });
    expect(tx.lines.length).toBeGreaterThan(0);
    expect(tx.visited).toContain('parched-prayer');
    expect(tx.visited).toContain('the-answer');
    // last meaningful effect of the omen branch
    expect(tx.effects.map((e) => e.verb)).toContain('omen');
    expect(tx.effects.map((e) => e.verb)).toContain('grant_belief');
  });

  it('is deterministic: same seed + choices ⇒ identical transcript', () => {
    const a = scriptedPlay(droughtOmenPack, { seed: 42, choices: [0] });
    const b = scriptedPlay(droughtOmenPack, { seed: 42, choices: [0] });
    expect(b.lines).toEqual(a.lines);
    expect(b.effects).toEqual(a.effects);
    expect(b.visited).toEqual(a.visited);
  });

  it('a different seed can change pick/chance text but not control flow', () => {
    const a = scriptedPlay(droughtOmenPack, { seed: 1, choices: [0] });
    const b = scriptedPlay(droughtOmenPack, { seed: 2, choices: [0] });
    expect(b.visited).toEqual(a.visited);
    expect(b.effects.map((e) => e.verb)).toEqual(a.effects.map((e) => e.verb));
  });

  it('branches: the silent choice ends early and sends no effect', () => {
    const { host, verbs } = captureHost();
    const tx = scriptedPlay(droughtOmenPack, { seed: 3, choices: [2], host });
    expect(tx.visited).toEqual(['parched-prayer']); // never reaches the-answer
    expect(verbs).toEqual([]);
  });

  it('the dream choice routes whisper, the omen choice routes omen', () => {
    const omen = scriptedPlay(droughtOmenPack, { seed: 3, choices: [0] });
    const dream = scriptedPlay(droughtOmenPack, { seed: 3, choices: [1] });
    expect(omen.effects.map((e) => e.verb)).toContain('omen');
    expect(dream.effects.map((e) => e.verb)).toContain('whisper');
  });

  it('$interpolation substitutes scope fields', () => {
    const tx = scriptedPlay(droughtOmenPack, { seed: 5, choices: [0] });
    expect(tx.lines.some((l) => l.text.includes('Brother Nhumrod'))).toBe(true);
    expect(tx.lines.every((l) => !l.text.includes('$elder'))).toBe(true);
  });
});

describe('guarded choices', () => {
  it('hides options whose `when` is false', () => {
    const pack: StoryPack = {
      id: 'p', version: 1, state: { gold: 0 },
      storylets: [{
        id: 's', body: [{
          t: 'choice', options: [
            { text: 'always', body: [{ t: 'end' }] },
            { text: 'rich only', when: { op: '>', l: { var: 'gold' }, r: 10 }, body: [{ t: 'end' }] },
          ],
        }],
      }],
    };
    const tx = scriptedPlay(pack, { startId: 's', choices: [0] });
    expect(tx.decisions[0].options.map((o) => o.text)).toEqual(['always']);
  });
});

describe('AI-optional enrichment', () => {
  const pack: StoryPack = {
    id: 'p', version: 1,
    storylets: [{
      id: 's', body: [
        { t: 'say', who: null, text: { fallback: 'FALLBACK', enrich: { slotId: 'x' } } },
        { t: 'end' },
      ],
    }],
  };

  it('dumb director uses the fallback', () => {
    const tx = scriptedPlay(pack, { startId: 's' });
    expect(tx.lines[0].text).toBe('FALLBACK');
  });

  it('a director can rewrite the slot, but is never required', () => {
    const director: Director = { enrich: (h) => (h.slotId === 'x' ? 'REWRITTEN' : undefined) };
    const tx = scriptedPlay(pack, { startId: 's', director });
    expect(tx.lines[0].text).toBe('REWRITTEN');
  });
});

describe('reservoir selection', () => {
  const pack: StoryPack = {
    id: 'p', version: 1, state: { war: false, peace: true },
    storylets: [
      { id: 'low', priority: 1, body: [{ t: 'end' }] },
      { id: 'high', priority: 9, when: [{ var: 'peace' }], body: [{ t: 'end' }] },
      { id: 'wartime', when: [{ var: 'war' }], body: [{ t: 'end' }] },
      { id: 'once-only', priority: 20, once: true, when: [{ var: 'peace' }], body: [{ t: 'end' }] },
    ],
  };

  it('filters by precondition and picks highest priority', () => {
    const scope = new Scope(undefined, pack.state);
    const rng = createRng(1);
    const chosen = selectStorylet(pack, scope, rng, new Set());
    expect(chosen!.id).toBe('once-only'); // priority 20 wins
    // wartime is gated out by its precondition
    expect(eligibleStorylets(pack, scope, rng, new Set()).map((s) => s.id)).not.toContain('wartime');
  });

  it('respects `once` via the seen set', () => {
    const scope = new Scope(undefined, pack.state);
    const rng = createRng(1);
    // once it has fired, once-only drops out and the next-highest wins
    const chosen = selectStorylet(pack, scope, rng, new Set(['once-only']));
    expect(chosen!.id).toBe('high');
  });

  it('returns null when the reservoir is dry', () => {
    const dry: StoryPack = { id: 'd', version: 1, storylets: [
      { id: 'a', when: [false], body: [{ t: 'end' }] },
    ] };
    expect(selectStorylet(dry, new Scope(), createRng(1), new Set())).toBeNull();
  });
});

describe('expression evaluation', () => {
  const scope = new Scope(undefined, { a: 3, b: 5, name: 'Om' });
  const rng = createRng(1);
  it('arithmetic + comparison + logic', () => {
    expect(evalExpr({ op: '+', l: { var: 'a' }, r: { var: 'b' } }, scope, rng)).toBe(8);
    expect(evalExpr({ op: '<', l: { var: 'a' }, r: { var: 'b' } }, scope, rng)).toBe(true);
    expect(evalExpr({ op: '&&', l: true, r: { not: false } }, scope, rng)).toBe(true);
    expect(evalExpr({ op: '==', l: { var: 'name' }, r: 'Om' }, scope, rng)).toBe(true);
  });
  it('chance is seeded and bounded', () => {
    const r = createRng(99);
    const results = Array.from({ length: 20 }, () => evalExpr({ chance: 2 }, scope, r));
    expect(results.every((x) => x === true || x === false)).toBe(true);
    // chance(1) is always true
    expect(evalExpr({ chance: 1 }, scope, createRng(5))).toBe(true);
  });
});

describe('validator (the UGC contract)', () => {
  it('catches dup ids, missing goto targets, empty choices, missing fallback', () => {
    const bad: StoryPack = {
      id: 'bad', version: 1,
      storylets: [
        { id: 'dup', body: [{ t: 'goto', storylet: 'nowhere' }] },
        { id: 'dup', body: [{ t: 'choice', options: [] }] },
        { id: 'slot', body: [{ t: 'say', who: null, text: { fallback: '', enrich: { slotId: 'z' } } }] },
      ],
    };
    const errs = validatePack(bad);
    expect(errs.some((e) => /duplicate storylet id/.test(e))).toBe(true);
    expect(errs.some((e) => /goto unknown target/.test(e))).toBe(true);
    expect(errs.some((e) => /choice with no options/.test(e))).toBe(true);
    expect(errs.some((e) => /no fallback/.test(e))).toBe(true);
  });

  it('enforces the capability allowlist when provided', () => {
    const pack: StoryPack = {
      id: 'p', version: 1,
      storylets: [{ id: 's', body: [{ t: 'do', effect: { verb: 'rm_rf' } }, { t: 'end' }] }],
    };
    expect(validatePack(pack, { allowedVerbs: new Set(['omen']) })
      .some((e) => /not in capability allowlist/.test(e))).toBe(true);
    expect(validatePack(pack, { allowedVerbs: new Set(['rm_rf']) })).toEqual([]);
  });

  it('flags version mismatch', () => {
    const pack: StoryPack = { id: 'p', version: 999, storylets: [{ id: 's', body: [{ t: 'end' }] }] };
    expect(validatePack(pack).some((e) => /version/.test(e))).toBe(true);
  });
});

describe('runner safety', () => {
  it('guards against goto loops', () => {
    const loop: StoryPack = {
      id: 'loop', version: 1,
      storylets: [
        { id: 'a', body: [{ t: 'goto', storylet: 'b' }] },
        { id: 'b', body: [{ t: 'goto', storylet: 'a' }] },
      ],
    };
    expect(() => scriptedPlay(loop, { startId: 'a', maxSteps: 500 })).toThrow(/goto cycle|stalled|exceeded/);
  });

  it('host reads fall through for fields the scope does not own', () => {
    const host: StoryHost = { read: (p) => (p === 'world.year' ? 12 : undefined), dispatch() {} };
    const scope = new Scope(host, {});
    expect(scope.get('world.year')).toBe(12);
    const pack: StoryPack = {
      id: 'p', version: 1,
      storylets: [{ id: 's', when: [{ op: '>', l: { var: 'world.year' }, r: 10 }], body: [{ t: 'end' }] }],
    };
    const r = new StoryRunner(pack, scope, createRng(1), new DumbDirector());
    expect(selectStorylet(pack, scope, createRng(1), r.seen)).not.toBeNull();
  });
});
