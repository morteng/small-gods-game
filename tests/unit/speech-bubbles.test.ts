import { describe, it, expect } from 'vitest';
import {
  SpeechBubbleStore, buildSpeechBubbles, describeEncounterLine, encounterSeed,
  bubbleAlpha, BUBBLE_TTL_MS, BUBBLE_FADE_MS, MAX_BUBBLES,
  type EncounterLineInput,
} from '@/game/affordance/speech-bubbles';
import type { Camera, NpcNeeds, NpcPersonality } from '@/core/types';

const CAM: Camera = { x: 0, y: 0, zoom: 1 } as Camera;
const VIEW = { w: 800, h: 600 };
const FULL_NEEDS: NpcNeeds = { safety: 0.9, prosperity: 0.9, community: 0.9, meaning: 0.9 };
const MILD: NpcPersonality = { assertiveness: 0.3, skepticism: 0.5, piety: 0.5, sociability: 0.5 };

function lineInput(over: Partial<EncounterLineInput> = {}): EncounterLineInput {
  return { warm: true, relType: 'friend', personality: MILD, needs: FULL_NEEDS, partnerName: 'Bram', seed: 1, ...over };
}

describe('SpeechBubbleStore', () => {
  it('spawns a line, keeps it until TTL, then prunes it', () => {
    const s = new SpeechBubbleStore();
    s.spawn('a', 'Hello', 1000);
    s.prune(1000 + BUBBLE_TTL_MS - 1);
    expect(s.active().length).toBe(1);
    s.prune(1000 + BUBBLE_TTL_MS + 1);
    expect(s.active().length).toBe(0);
  });

  it('one bubble per speaker — a new line replaces the old', () => {
    const s = new SpeechBubbleStore();
    s.spawn('a', 'first', 1000);
    s.spawn('a', 'second', 1500);
    expect(s.active().length).toBe(1);
    expect(s.active()[0].text).toBe('second');
  });

  it('retext swaps a live bubble in place, keeping its lifetime', () => {
    const s = new SpeechBubbleStore();
    s.spawn('a', 'base line', 1000);
    // Replaces only if the current text still matches `from`, and only in-window.
    expect(s.retext('a', 'base line', 'reworded', 1500)).toBe(true);
    expect(s.active()[0].text).toBe('reworded');
    // bornMs unchanged → still expires at the ORIGINAL TTL, not reset to 1500.
    s.prune(1000 + BUBBLE_TTL_MS + 1);
    expect(s.active().length).toBe(0);
  });

  it('retext refuses when the line has changed or the bubble expired (no clobber / no ghost)', () => {
    const s = new SpeechBubbleStore();
    s.spawn('a', 'base line', 1000);
    // A newer line was spoken → a late garnish of the old line must not overwrite.
    s.spawn('a', 'newer line', 1200);
    expect(s.retext('a', 'base line', 'reworded', 1300)).toBe(false);
    expect(s.active()[0].text).toBe('newer line');
    // And once faded, retext resurrects nothing.
    expect(s.retext('a', 'newer line', 'reworded', 1200 + BUBBLE_TTL_MS + 1)).toBe(false);
  });

  it('caps at MAX_BUBBLES, dropping the oldest', () => {
    const s = new SpeechBubbleStore();
    for (let i = 0; i < MAX_BUBBLES + 3; i++) s.spawn(`npc${i}`, `l${i}`, 1000 + i);
    expect(s.active().length).toBe(MAX_BUBBLES);
    // the earliest speakers were evicted
    expect(s.active().some(b => b.npcId === 'npc0')).toBe(false);
    expect(s.active().some(b => b.npcId === `npc${MAX_BUBBLES + 2}`)).toBe(true);
  });
});

describe('bubbleAlpha', () => {
  it('is 0 at birth and death, ramps in and out', () => {
    expect(bubbleAlpha(0)).toBe(0);
    expect(bubbleAlpha(BUBBLE_TTL_MS)).toBe(0);
    expect(bubbleAlpha(BUBBLE_FADE_MS / 2)).toBeCloseTo(0.5, 2);
    expect(bubbleAlpha(BUBBLE_FADE_MS)).toBeCloseTo(1, 5);           // fully in
    expect(bubbleAlpha(BUBBLE_TTL_MS / 2)).toBe(1);                  // steady mid-life
    expect(bubbleAlpha(BUBBLE_TTL_MS - BUBBLE_FADE_MS / 2)).toBeCloseTo(0.5, 2); // fading out
  });
});

describe('buildSpeechBubbles', () => {
  it('projects live speaker positions and prunes as it builds', () => {
    const s = new SpeechBubbleStore();
    s.spawn('a', 'Hi', 1000);
    const pos = new Map([['a', { x: 10, y: 10 }]]);
    const views = buildSpeechBubbles(s, 1200, id => pos.get(id) ?? null, CAM, 1, VIEW);
    expect(views.length).toBe(1);
    expect(views[0].npcId).toBe('a');
    expect(Number.isFinite(views[0].x)).toBe(true);
    expect(views[0].alpha).toBeGreaterThan(0);

    // Past TTL → build returns nothing AND the store is pruned.
    const gone = buildSpeechBubbles(s, 1000 + BUBBLE_TTL_MS + 1, id => pos.get(id) ?? null, CAM, 1, VIEW);
    expect(gone.length).toBe(0);
    expect(s.active().length).toBe(0);
  });

  it('skips a speaker with no live position (a despawned extra)', () => {
    const s = new SpeechBubbleStore();
    s.spawn('ghost', 'Hi', 1000);
    const views = buildSpeechBubbles(s, 1100, () => null, CAM, 1, VIEW);
    expect(views.length).toBe(0);
  });
});

describe('describeEncounterLine', () => {
  it('is deterministic for a given input', () => {
    const a = describeEncounterLine(lineInput({ seed: 42 }));
    const b = describeEncounterLine(lineInput({ seed: 42 }));
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('a friction meeting is a barb, sharper when the speaker is assertive', () => {
    const soft = describeEncounterLine(lineInput({ warm: false, relType: 'rival', personality: { ...MILD, assertiveness: 0.2 } }));
    const hard = describeEncounterLine(lineInput({ warm: false, relType: 'rival', personality: { ...MILD, assertiveness: 0.9 } }));
    // Different tone tables → the hard barb reads as more confrontational; at
    // minimum they draw from disjoint sets (assert by a known hard-only phrase).
    expect(hard).toMatch(/way|nerve|face/i);
    expect(soft).not.toBe(hard);
  });

  it('a grinding need colours the small talk', () => {
    const line = describeEncounterLine(lineInput({ needs: { ...FULL_NEEDS, prosperity: 0.1 } }));
    expect(line).toMatch(/harvest|coin|season/i);
  });

  it('falls back to a warm greeting keyed to the tie when all is well', () => {
    const lover = describeEncounterLine(lineInput({ relType: 'lover', needs: FULL_NEEDS }));
    expect(lover).toMatch(/you|heart|walk/i);
  });
});

describe('encounterSeed', () => {
  it('is stable per (a,b,tick) and varies across meetings', () => {
    expect(encounterSeed('npc_1', 'npc_2', 100)).toBe(encounterSeed('npc_1', 'npc_2', 100));
    expect(encounterSeed('npc_1', 'npc_2', 100)).not.toBe(encounterSeed('npc_1', 'npc_2', 200));
    expect(encounterSeed('npc_1', 'npc_2', 100)).not.toBe(encounterSeed('npc_3', 'npc_2', 100));
  });
});
