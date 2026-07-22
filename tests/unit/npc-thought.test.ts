import { describe, it, expect } from 'vitest';
import { describeThought, type ThoughtInput } from '@/game/npc-thought';
import type { NpcActivity, NpcNeeds, MemoryEntry } from '@/core/types';

const FULL_NEEDS: NpcNeeds = { safety: 0.8, prosperity: 0.8, community: 0.8, meaning: 0.8 };

function needs(partial: Partial<NpcNeeds> = {}): NpcNeeds {
  return { ...FULL_NEEDS, ...partial };
}

const ALL_ACTIVITIES: readonly NpcActivity[] = [
  'sleep', 'work', 'socialize', 'worship', 'idle', 'wander', 'patrol',
];

describe('describeThought', () => {
  it('worship + prayerNeed produces a line about that need', () => {
    const line = describeThought({
      activity: 'worship',
      needs: needs({ prosperity: 0.05 }),
      prayerNeed: 'prosperity',
    });
    expect(line.toLowerCase()).toMatch(/hand|anything|fill|please/);
  });

  it('worship + prayerNeed:safety references safety/shelter, not another need', () => {
    const line = describeThought({
      activity: 'worship',
      needs: needs({ safety: 0.05 }),
      prayerNeed: 'safety',
    });
    expect(line.toLowerCase()).toMatch(/safe|shelter|danger/);
  });

  it('a critically low need drives a distress line even mid-activity', () => {
    const line = describeThought({
      activity: 'work',
      needs: needs({ safety: 0.1 }),
    });
    expect(line.toLowerCase()).toMatch(/danger|harm|safe|luck|sharp/);
  });

  it('critically low need reads differently for high-piety vs high-skepticism', () => {
    const pious = describeThought({
      activity: 'idle',
      needs: needs({ safety: 0.1 }),
      personality: { piety: 0.9, skepticism: 0.1 },
    });
    const skeptic = describeThought({
      activity: 'idle',
      needs: needs({ safety: 0.1 }),
      personality: { piety: 0.1, skepticism: 0.9 },
    });
    const plain = describeThought({
      activity: 'idle',
      needs: needs({ safety: 0.1 }),
    });
    expect(pious).not.toBe(skeptic);
    expect(pious).not.toBe(plain);
    expect(skeptic).not.toBe(plain);
  });

  it('worship plea also differs by register (pious vs plain)', () => {
    const pious = describeThought({
      activity: 'worship',
      needs: needs({ meaning: 0.05 }),
      prayerNeed: 'meaning',
      personality: { piety: 0.9, skepticism: 0.1 },
    });
    const plain = describeThought({
      activity: 'worship',
      needs: needs({ meaning: 0.05 }),
      prayerNeed: 'meaning',
    });
    expect(pious).not.toBe(plain);
  });

  it('a comfortable NPC at work gets an activity-flavored line, not distress', () => {
    const line = describeThought({
      activity: 'work',
      needs: needs(),
      mood: 0.8,
    });
    expect(line.toLowerCase()).not.toMatch(/harm|danger|starv|forsaken|alone/);
    expect(line.toLowerCase()).toMatch(/work|hand/);
  });

  it('low mood colors the activity line without needs being critical', () => {
    const badMood = describeThought({ activity: 'sleep', needs: needs(), mood: 0.1 });
    const goodMood = describeThought({ activity: 'sleep', needs: needs(), mood: 0.9 });
    expect(badMood).not.toBe(goodMood);
  });

  it('a recent, high-salience memory surfaces in the line when present', () => {
    const memories: MemoryEntry[] = [
      { tick: 100, kind: 'miracle', summary: 'a river turned to answer her plea', salience: 0.95 },
    ];
    const line = describeThought({ activity: 'work', needs: needs(), mood: 0.8, memories });
    expect(line).toContain('a river turned to answer her plea');
  });

  it('a low-salience memory does NOT override the activity line', () => {
    const memories: MemoryEntry[] = [
      { tick: 100, kind: 'backfill', summary: 'nothing much happened', salience: 0.05 },
    ];
    const withMem = describeThought({ activity: 'work', needs: needs(), mood: 0.8, memories });
    const withoutMem = describeThought({ activity: 'work', needs: needs(), mood: 0.8 });
    expect(withMem).toBe(withoutMem);
    expect(withMem).not.toContain('nothing much happened');
  });

  it('memory does not override a critical-need distress line (needs still win)', () => {
    const memories: MemoryEntry[] = [
      { tick: 100, kind: 'miracle', summary: 'a landmark deed', salience: 1 },
    ];
    const line = describeThought({ activity: 'idle', needs: needs({ safety: 0.05 }), memories });
    expect(line).not.toContain('a landmark deed');
  });

  it('is deterministic: identical input yields identical output', () => {
    const input: ThoughtInput = {
      activity: 'socialize',
      needs: needs({ community: 0.2 }),
      mood: 0.4,
      personality: { piety: 0.3, skepticism: 0.7 },
      memories: [{ tick: 5, kind: 'whisper', summary: 'a quiet word', salience: 0.6 }],
    };
    const a = describeThought(input);
    const b = describeThought({ ...input, needs: { ...input.needs }, memories: [...(input.memories ?? [])] });
    expect(a).toBe(b);
  });

  it('total function: never returns an empty string across all activities x need vectors', () => {
    const needVectors: NpcNeeds[] = [
      needs(),
      needs({ safety: 0.05 }),
      needs({ prosperity: 0.05 }),
      needs({ community: 0.05 }),
      needs({ meaning: 0.05 }),
      { safety: 0, prosperity: 0, community: 0, meaning: 0 },
    ];
    for (const activity of ALL_ACTIVITIES) {
      for (const nv of needVectors) {
        const line = describeThought({ activity, needs: nv });
        expect(typeof line).toBe('string');
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('reads sensibly with ONLY {activity, needs} — no personality/memories/mood', () => {
    const line = describeThought({ activity: 'wander', needs: needs() });
    expect(typeof line).toBe('string');
    expect(line.trim().length).toBeGreaterThan(0);
  });

  it('never produces a distress line for a comfortable NPC regardless of activity', () => {
    for (const activity of ALL_ACTIVITIES) {
      const line = describeThought({ activity, needs: needs(), mood: 0.5 });
      expect(line.toLowerCase()).not.toMatch(/harm|forsaken|starv/);
    }
  });
});
