// tests/unit/hall-view.test.ts
//
// The Hall of the Gods' PROSE (H3). Every line `composeHallView` produces is a
// claim about the sim, so the interesting assertions here are not "does it
// render" — the screen module's own test covers that — but "is it still TRUE".
//
// Two kinds of pin:
//   1. Behaviour: bands, node derivation, refusal ordering, degradation.
//   2. Honesty: the sentences that paraphrase a constant are pinned AGAINST that
//      constant, so moving `DOCTRINE_DEVOTION_BAR` or `CLAIM_CONVICTION_FRACTION`
//      fails here instead of silently turning the hall into a liar.
//
// Plus one renderability guard: this file is outside `src/render/ui/`, so the
// pixel-font coverage test does NOT scan it — prose composed here could name a
// glyph the font has no design for and the only symptom would be a gap on screen.

import { describe, it, expect } from 'vitest';
import {
  composeHallView, massLineFor, intimacyLineFor, reachLineFor, nextHintFor,
  castBlockedFor, tenthsPhrase, FADED_LINE, type HallSpiritFacts,
} from '@/game/hall-view';
import {
  CLAIM_CONVICTION_FRACTION, DOCTRINE_DEVOTION_BAR, type BeliefPowerView,
} from '@/game/game-query';
import { FADE_MASS, CULT_IN, MAJOR_IN } from '@/sim/god-tier';
import { hallRows, type HallView } from '@/render/ui/shell/hall-screen';

const GOD: HallSpiritFacts = {
  name: 'Fooob', beliefMass: 3.7, intimacy: 0.015, tier: 'small', faded: false,
};

function power(over: Partial<BeliefPowerView> = {}): BeliefPowerView {
  return {
    domain: 'storm', label: 'Storm & Lightning', blurb: 'They believe you command the sky.',
    verb: 'call_storm', conviction: 0.6, threshold: 0.5, unlocked: true,
    reach: 5, believers: 12,
    dimensions: { faith: 0.5, understanding: 0.3, devotion: 0.4 },
    tier: 'command',
    ...over,
  };
}

const ALL_IMPLEMENTED = (): boolean => true;
const NONE_IMPLEMENTED = (): boolean => false;

describe('the spirit strip', () => {
  it('says the tier in the hall\'s voice, and keeps the tortoise canon', () => {
    expect(composeHallView({ ...GOD, tier: 'nameless' }, [], ALL_IMPLEMENTED).spirit.tierLine)
      .toBe('NOTHING BUT A NAME');            // VISION §5's "nothing but names"
    expect(composeHallView({ ...GOD, tier: 'small' }, [], ALL_IMPLEMENTED).spirit.tierLine)
      .toBe('A SMALL GOD');
    expect(composeHallView({ ...GOD, tier: 'major' }, [], ALL_IMPLEMENTED).spirit.tierLine)
      .toBe('A MAJOR GOD');
  });

  it('states belief MASS as prose, never as a float', () => {
    // A 10-foot menu showing `3.744` tells the player nothing they can act on.
    for (const mass of [0, 0.5, 3.744, 39, 52, 207, 423]) {
      const line = massLineFor(mass);
      expect(line).not.toMatch(/\d/);
      expect(line.length).toBeGreaterThan(8);
    }
  });

  it('the mass bands sit on god-tier.ts\'s OWN edges, not invented ones', () => {
    // Below the fade line the god is starving — that is the fading story, not
    // merely a small number, and the line has to read that way.
    expect(massLineFor(FADE_MASS - 0.01)).toBe('BELIEF TOO THIN TO HOLD A SHAPE');
    expect(massLineFor(FADE_MASS)).not.toBe(massLineFor(FADE_MASS - 0.01));
    // The two tier edges must each move the sentence.
    expect(massLineFor(CULT_IN)).not.toBe(massLineFor(CULT_IN - 0.01));
    expect(massLineFor(MAJOR_IN)).not.toBe(massLineFor(MAJOR_IN - 0.01));
    // Calibration anchors from god-tier.ts's comment: 6 fickle believers ≈ 3.7,
    // one small settlement ≈ 52, two-to-three settlements ≈ 207.
    expect(massLineFor(3.744)).toBe('BELIEF ENOUGH FOR A HANDFUL OF SOULS');
    expect(massLineFor(52)).toBe('BELIEF ENOUGH FOR ONE SETTLEMENT');
    expect(massLineFor(207)).toBe('BELIEF ENOUGH FOR SEVERAL TOWNS');
  });

  it('a non-finite or negative mass reads as nothing, never as NaN prose', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY * -1, -5]) {
      expect(massLineFor(bad)).toBe('BELIEF TOO THIN TO HOLD A SHAPE');
    }
  });

  it('calls a broad shallow church HOLLOW, not merely unknown', () => {
    // VISION §5: major gods are "broad, powerful, and usually hollow". The
    // number alone cannot distinguish a hollow major from a small god nobody
    // understands, so the tier is consulted for this one line.
    expect(intimacyLineFor(0.01, 'major')).toBe('A WIDE CHURCH THAT DOES NOT KNOW YOU');
    expect(intimacyLineFor(0.01, 'small')).toBe('THEY DO NOT KNOW WHAT THEY PRAY TO');
  });

  it('the intimacy bands are set where the MEASURED intimacies actually land', () => {
    // `intimacy` is a mean of understanding·devotion PRODUCTS, so it lives low:
    // the shipped default world (u .10 / d .15) averages .015.
    const shipped = intimacyLineFor(0.1 * 0.15, 'small');
    const decent = intimacyLineFor(0.3 * 0.4, 'small');
    const deep = intimacyLineFor(0.6 * 0.7, 'small');
    expect(new Set([shipped, decent, deep]).size).toBe(3); // all three distinguishable
  });

  it('a faded god carries the canon line, and an unfaded one carries none', () => {
    const faded = composeHallView({ ...GOD, faded: true }, [power()], ALL_IMPLEMENTED);
    expect(faded.spirit.faded).toBe(true);
    expect(faded.spirit.fadedLine).toBe('ONLY WHISPERS REMAIN');
    expect(FADED_LINE).toBe('ONLY WHISPERS REMAIN');
    expect(composeHallView(GOD, [power()], ALL_IMPLEMENTED).spirit.fadedLine).toBeNull();
  });
});

describe('the pedestals', () => {
  it('reads the ladder off the projection\'s tier — it never re-derives it', () => {
    // One derivation (game-query's `deriveBeliefPowerTier`) is what keeps the
    // hall and MCP agreeing about the same domain.
    const reached = (t: BeliefPowerView['tier']): boolean[] =>
      composeHallView(GOD, [power({ tier: t })], ALL_IMPLEMENTED)
        .pedestals[0].nodes.map((n) => n.reached);
    expect(reached('dormant')).toEqual([false, false, false]);
    expect(reached('claim')).toEqual([true, false, false]);
    expect(reached('command')).toEqual([true, true, false]);
    expect(reached('doctrine')).toEqual([true, true, true]);
  });

  it('an absent tier/dimensions (a pre-H1 row) degrades, never throws', () => {
    const bare: BeliefPowerView = {
      domain: 'flood', label: 'Tempests', blurb: '…', verb: 'summon_storm',
      conviction: 0, threshold: 0.45, unlocked: false, reach: 0, believers: 0,
    };
    const p = composeHallView(GOD, [bare], ALL_IMPLEMENTED).pedestals[0];
    expect(p.tier).toBe('dormant');
    expect(p.dimensions).toEqual({ faith: 0, understanding: 0, devotion: 0 });
    expect(p.nodes.map((n) => n.reached)).toEqual([false, false, false]);
  });

  it('ladders exactly three nodes, in claim → command → doctrine order', () => {
    const p = composeHallView(GOD, [power()], ALL_IMPLEMENTED).pedestals[0];
    expect(p.nodes.map((n) => n.tier)).toEqual(['claim', 'command', 'doctrine']);
  });

  it('gives every node REAL hint prose (a frozen field a polish slice surfaces)', () => {
    // H2 does not draw `hint` yet — which is exactly how it would rot into an
    // empty string nobody noticed until the day it is drawn.
    for (const n of composeHallView(GOD, [power()], ALL_IMPLEMENTED).pedestals[0].nodes) {
      expect(n.hint.length).toBeGreaterThan(12);
      expect(n.label).toBe(n.tier.toUpperCase());
    }
  });

  it('states reach as prose, and admits when nobody believes', () => {
    expect(reachLineFor(12, 5)).toBe('BELIEVED BY 12 — REACH 5');
    expect(reachLineFor(0, 0)).toBe('NO ONE BELIEVES THIS OF YOU YET');
  });

  it('materialize is the clamped conviction/threshold ramp', () => {
    const mat = (conviction: number, threshold: number): number =>
      composeHallView(GOD, [power({ conviction, threshold })], ALL_IMPLEMENTED)
        .pedestals[0].materialize;
    expect(mat(0.25, 0.5)).toBeCloseTo(0.5);
    expect(mat(0.9, 0.5)).toBe(1);      // past the mark: fully solid, never >1
    expect(mat(0, 0.5)).toBe(0);
    expect(mat(0.3, 0)).toBe(0.3);      // a zero threshold must not divide by zero
  });

  it('the ramp walks BACKWARD when belief decays', () => {
    // Conviction is non-monotonic (decay can re-lock a pedestal) and the hall
    // must tolerate the regression rather than latch a high-water mark.
    const hot = composeHallView(GOD, [power({ conviction: 0.5, threshold: 0.5, tier: 'command' })], ALL_IMPLEMENTED);
    const cold = composeHallView(GOD, [power({ conviction: 0.1, threshold: 0.5, tier: 'dormant', unlocked: false })], ALL_IMPLEMENTED);
    expect(cold.pedestals[0].materialize).toBeLessThan(hot.pedestals[0].materialize);
    expect(cold.pedestals[0].nodes[0].reached).toBe(false);
  });
});

describe('what would ripen this next — the line most able to lie', () => {
  it('paraphrases the CLAIM bar, which is still half the unlock mark', () => {
    // The dormant hint says "halfway to the mark". If this constant moves, that
    // sentence becomes false — so pin the constant the prose was written against.
    expect(CLAIM_CONVICTION_FRACTION).toBe(0.5);
    expect(nextHintFor('dormant', true)).toContain('HALFWAY TO THE MARK');
  });

  it('paraphrases the DOCTRINE devotion bar FROM the constant', () => {
    expect(nextHintFor('command', true)).toContain(tenthsPhrase(DOCTRINE_DEVOTION_BAR));
    expect(tenthsPhrase(DOCTRINE_DEVOTION_BAR)).toBe('SIX IN TEN');
    expect(tenthsPhrase(0.5)).toBe('HALF');
    expect(tenthsPhrase(1)).toBe('ALL OF IT');
    expect(tenthsPhrase(Number.NaN)).toBe('NOTHING');
  });

  it('does NOT send the player to farm belief for an unimplemented verb', () => {
    // `unlocked` fuses "believed enough" with "the verb exists", so a CLAIM-tier
    // stub would otherwise be told conviction is what it is missing.
    expect(nextHintFor('claim', true)).toContain('CONVICTION PAST THE MARK');
    expect(nextHintFor('claim', false)).toContain('NOT YET IN THE WORLD');
    expect(nextHintFor('claim', false)).not.toContain('CONVICTION PAST');
  });

  it('invents no fourth rung once all three are reached', () => {
    expect(nextHintFor('doctrine', true)).toContain('ALL THREE REACHED');
  });
});

describe('the CAST refusal', () => {
  it('reports the most TOTAL truth first', () => {
    // A faded god cannot cast anything, so that outranks "this domain is not
    // ripe"; an unimplemented verb outranks "not yet believed" because belief is
    // not what is missing.
    expect(castBlockedFor(true, true, true)).toBe(FADED_LINE);
    expect(castBlockedFor(true, false, false)).toBe(FADED_LINE);
    expect(castBlockedFor(false, false, false)).toBe('THIS POWER IS NOT YET IN THE WORLD');
    expect(castBlockedFor(false, true, false)).toBe('NOT YET BELIEVED OF YOU');
    expect(castBlockedFor(false, true, true)).toBeNull();
  });

  it('a faded god\'s hall offers no castable row at all', () => {
    const view = composeHallView({ ...GOD, faded: true }, [power(), power({ domain: 'flood' })], ALL_IMPLEMENTED);
    const casts = hallRows(view).filter((r) => r.action.kind === 'cast');
    expect(casts).toHaveLength(2);
    for (const r of casts) {
      expect(r.enabled).toBe(false);
      expect(r.reason).toBe(FADED_LINE);
    }
    // SELECT stays open — a silenced god may still look at what it lost.
    expect(hallRows(view).filter((r) => r.action.kind === 'select').every((r) => r.enabled)).toBe(true);
  });

  it('an unimplemented verb is refused even at full conviction', () => {
    const view = composeHallView(GOD, [power({ unlocked: false, tier: 'claim' })], NONE_IMPLEMENTED);
    expect(view.pedestals[0].castBlocked).toBe('THIS POWER IS NOT YET IN THE WORLD');
  });
});

describe('the honest empty states', () => {
  it('with pedestals but no belief, says so out loud', () => {
    const view = composeHallView(GOD, [power({ conviction: 0, unlocked: false, tier: 'dormant', believers: 0, reach: 0 })], ALL_IMPLEMENTED);
    expect(view.emptyLine).toBe('NO ONE BELIEVES ANY OF THIS OF YOU YET');
    expect(view.pedestals).toHaveLength(1); // the pedestal still STANDS
  });

  it('with no domains at all, refuses to imply there are some', () => {
    expect(composeHallView(GOD, [], ALL_IMPLEMENTED).emptyLine).toBe('NO POWERS ARE BELIEVED OF YOU');
  });

  it('with any belief at all, shows no caption', () => {
    expect(composeHallView(GOD, [power()], ALL_IMPLEMENTED).emptyLine).toBeNull();
  });
});

describe('renderability + the view contract', () => {
  /** Every string the view carries, flattened. */
  function prose(view: HallView): string[] {
    const out = [
      view.spirit.name, view.spirit.tierLine, view.spirit.massLine,
      view.spirit.intimacyLine, view.spirit.fadedLine ?? '', view.emptyLine ?? '',
    ];
    for (const p of view.pedestals) {
      out.push(p.label, p.blurb, p.reachLine, p.nextHint, p.castBlocked ?? '');
      for (const n of p.nodes) out.push(n.label, n.hint);
    }
    return out;
  }

  it('uses only glyphs the pixel font has (ASCII plus the em dash)', () => {
    // This file lives outside `src/render/ui/`, so `ui-pixel-font.test.ts` does
    // NOT scan it — an exotic dash here would just leave a gap on screen. `—` is
    // in the font's `G` table; nothing else non-ASCII is allowed through.
    const views = [
      composeHallView(GOD, [power(), power({ domain: 'flood', tier: 'dormant', unlocked: false })], ALL_IMPLEMENTED),
      composeHallView({ ...GOD, faded: true, tier: 'nameless', beliefMass: 0 }, [power()], NONE_IMPLEMENTED),
      composeHallView({ ...GOD, tier: 'major', beliefMass: 400, intimacy: 0.9 }, [], ALL_IMPLEMENTED),
    ];
    for (const v of views) {
      for (const s of prose(v)) {
        const bad = [...s.toUpperCase()].filter((ch) => !/[ -~—]/.test(ch));
        expect(bad, `unrenderable glyph(s) in "${s}": ${bad.join(' ')}`).toEqual([]);
      }
    }
  });

  it('stays JSON-serializable (views cross the MCP/bus seam)', () => {
    const view = composeHallView(GOD, [power()], ALL_IMPLEMENTED);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it('keeps every bar inside 0..1 even when handed nonsense', () => {
    const view = composeHallView(
      { ...GOD, intimacy: 4 },
      [power({ conviction: 9, threshold: -1, dimensions: { faith: 2, understanding: -1, devotion: 0.5 } })],
      ALL_IMPLEMENTED,
    );
    const p = view.pedestals[0];
    for (const v of [view.spirit.intimacy, p.conviction, p.threshold, p.materialize,
      p.dimensions.faith, p.dimensions.understanding, p.dimensions.devotion]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('carries the verb + domain through untouched — they are the command API', () => {
    const p = composeHallView(GOD, [power()], ALL_IMPLEMENTED).pedestals[0];
    expect(p.domain).toBe('storm');
    expect(p.verb).toBe('call_storm');
    expect(hallRows(composeHallView(GOD, [power()], ALL_IMPLEMENTED)).map((r) => r.id))
      .toEqual(['hall.select.storm', 'hall.cast.storm', 'hall.back']);
  });
});
