/**
 * Need DIRECTION reaches belief — VISION §9 row 11 (scaling plan S2b.2).
 *
 * Before this round `tickNpcEntity` read only `computeMood()`, the scalar mean
 * of the four needs: comfort decay above 0.6, desperation boost below 0.4. So a
 * pressure that drained `prosperity` while supplying `safety` in equal measure
 * left the mean untouched and was a **literal no-op on faith** — the engine
 * could not tell one kind of suffering from another, contradicting tenet 1
 * ("belief is born from need").
 *
 * Now both terms key on the WORST need (`lowestNeed`): desperation fires when
 * ANY need collapses, comfort decay only when EVERY need is met. `computeMood`
 * is untouched — it stays the mood/UI scalar (`p.mood`, presentation, probes).
 */
import { describe, it, expect } from 'vitest';
import { tickNpcEntity, computeMood, lowestNeed } from '@/sim/npc-sim';
import { prayerSubject } from '@/sim/systems/npc-activity-system';
import { initNpcProps } from '@/world/npc-helpers';
import type { Entity, NpcNeeds, NpcProperties } from '@/core/types';

function npc(needs: NpcNeeds, opts: { piety?: number; devotion?: number; faith?: number } = {}): Entity {
  const p = initNpcProps('t', 'farmer', 7);
  p.personality.skepticism = 0;               // isolate from baseline decay
  p.personality.piety = opts.piety ?? 1;
  p.activity = 'idle';                        // no abandonment decay
  p.needs = { ...needs };
  p.beliefs['player'] = { faith: opts.faith ?? 0.5, understanding: 0, devotion: opts.devotion ?? 0 };
  return { id: 't', kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
}
function faith(e: Entity): number {
  return (e.properties as unknown as NpcProperties).beliefs.player.faith;
}

describe('lowestNeed', () => {
  it('returns the worst need and its axis', () => {
    expect(lowestNeed({ safety: 0.8, prosperity: 0.1, community: 0.5, meaning: 0.4 }))
      .toEqual({ need: 'prosperity', value: 0.1 });
  });

  it('breaks ties in the same fixed order prayerSubject uses', () => {
    // safety before prosperity before community before meaning.
    const needs: NpcNeeds = { safety: 0.1, prosperity: 0.1, community: 0.1, meaning: 0.1 };
    expect(lowestNeed(needs).need).toBe('safety');
    expect(prayerSubject(needs)).toBe('safety');
  });

  it('agrees with prayerSubject about WHICH need is worst', () => {
    // The desperation signal and the plea must not point at different griefs.
    const needs: NpcNeeds = { safety: 0.9, prosperity: 0.05, community: 0.9, meaning: 0.9 };
    expect(lowestNeed(needs).need).toBe('prosperity');
    expect(prayerSubject(needs)).toBe('prosperity');
  });
});

describe('the VISION row-11 case: a no-op pressure now moves faith', () => {
  // Same scalar mean (0.5), opposite directions. Under the old mean-only code
  // BOTH of these were identical to the engine and faith did not move at all.
  const balanced: NpcNeeds = { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 };
  const drained: NpcNeeds  = { safety: 0.9, prosperity: 0.1, community: 0.5, meaning: 0.5 };

  it('the two states are indistinguishable to computeMood (the old signal)', () => {
    expect(computeMood(balanced)).toBeCloseTo(computeMood(drained), 10);
  });

  it('draining prosperity while supplying safety RAISES faith (desperation)', () => {
    const flat = npc(balanced);
    const bent = npc(drained);
    tickNpcEntity(flat);
    tickNpcEntity(bent);
    // skepticism 0 + no need past a threshold ⇒ the balanced mortal is a no-op.
    expect(faith(flat)).toBe(0.5);
    // prosperity 0.1 < 0.4 ⇒ desperation (0.4−0.1)/0.4 = 0.75 × piety 1 × 0.001.
    expect(faith(bent)).toBeCloseTo(0.5 + 0.00075, 6);
    expect(faith(bent)).toBeGreaterThan(faith(flat));
  });
});

describe('desperation keys on the worst need', () => {
  it('one collapsing axis is enough, however well-served the rest are', () => {
    const e = npc({ safety: 1, prosperity: 1, community: 1, meaning: 0 });
    tickNpcEntity(e);
    // Mean is 0.75 — the old code read that as comfort and DECAYED faith here.
    expect(faith(e)).toBeGreaterThan(0.5);
  });

  it('scales with how far the worst need has fallen', () => {
    const mild = npc({ safety: 0.5, prosperity: 0.3, community: 0.5, meaning: 0.5 });
    const dire = npc({ safety: 0.5, prosperity: 0.0, community: 0.5, meaning: 0.5 });
    tickNpcEntity(mild);
    tickNpcEntity(dire);
    expect(faith(dire) - 0.5).toBeGreaterThan(faith(mild) - 0.5);
  });

  it('does not fire when every need is above the threshold', () => {
    const e = npc({ safety: 0.45, prosperity: 0.45, community: 0.45, meaning: 0.45 });
    tickNpcEntity(e);
    expect(faith(e)).toBe(0.5);
  });
});

describe('comfort decay keys on ALL needs met', () => {
  it('erodes faith when every need is comfortable', () => {
    const e = npc({ safety: 0.9, prosperity: 0.9, community: 0.9, meaning: 0.9 });
    tickNpcEntity(e);
    expect(faith(e)).toBeLessThan(0.5);
  });

  it('one unmet need suspends secularization even at a comfortable mean', () => {
    // Mean 0.7 — over the old 0.6 comfort threshold, so the old code decayed
    // faith. A mortal whose prosperity is collapsing is not secularizing.
    const e = npc({ safety: 1, prosperity: 0.2, community: 0.8, meaning: 0.8 }, { piety: 0 });
    expect(computeMood((e.properties as unknown as NpcProperties).needs)).toBeCloseTo(0.7, 10);
    tickNpcEntity(e);
    expect(faith(e)).toBe(0.5); // piety 0 ⇒ no desperation boost either: exactly flat
  });

  it('scales with the worst need, not the mean', () => {
    const evenly = npc({ safety: 0.8, prosperity: 0.8, community: 0.8, meaning: 0.8 });
    const lopsided = npc({ safety: 1, prosperity: 1, community: 1, meaning: 0.65 });
    // Same-ish means (0.8 vs 0.9125) but the lopsided one is barely comfortable.
    tickNpcEntity(evenly);
    tickNpcEntity(lopsided);
    expect(0.5 - faith(evenly)).toBeGreaterThan(0.5 - faith(lopsided));
  });
});
