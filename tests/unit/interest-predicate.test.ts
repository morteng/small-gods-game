import { describe, it, expect } from 'vitest';
import { isStorySignificant, isInterestingEvent, describeInterest } from '@/game/interest-predicate';
import type { SimEvent } from '@/core/events';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';

describe('interest-predicate — story significance (shared with Fate)', () => {
  it('matches exactly the beats Fate wakes on', () => {
    expect(isStorySignificant({ type: 'thread_opened', threadId: 1, shapeId: 's' as never, subject: {} as never })).toBe(true);
    expect(isStorySignificant({ type: 'thread_resolved', threadId: 1, status: 'resolved' })).toBe(true);
    expect(isStorySignificant({ type: 'thread_advanced', threadId: 1, phase: 'p', weight: 'climax' })).toBe(true);
    expect(isStorySignificant({ type: 'thread_advanced', threadId: 1, phase: 'p', weight: 'beat' as never })).toBe(false);
    expect(isStorySignificant({ type: 'place_flooded', poiId: 'p', name: 'N', depthM: 1, coverage: 1 })).toBe(true);
    expect(isStorySignificant({ type: 'site_born', siteId: 's', kind: 'k', name: 'N', x: 0, y: 0, depthM: 1, cells: 1 })).toBe(true);
    // A plain sim event is NOT story-significant.
    expect(isStorySignificant({ type: 'whisper', spiritId: PLAYER_SPIRIT_ID, npcId: 'n' })).toBe(false);
  });
});

describe('interest-predicate — seek filter', () => {
  it('accepts the salience-band events the inbox surfaces', () => {
    const yes: SimEvent[] = [
      { type: 'answer_prayer', spiritId: 'rival-1', npcId: 'n' },      // rival claim
      { type: 'beat_fired', beatId: 'b' as never, subject: {} as never },
      { type: 'settlement_begin', poiId: 'p', eventType: 'drought' as never, severity: 1, durationTicks: 1 },
      { type: 'settlement_end', poiId: 'p', eventType: 'drought' as never },
      { type: 'settlement_grown', poiId: 'p', entityId: 'e', preset: 'x', lotId: 'l' },
      { type: 'settlement_upgraded', poiId: 'p', entityId: 'e', from: 'a', to: 'b', lotId: 'l' },
      { type: 'npc_death', npcId: 'n', lineageId: 'n', cause: 'age' },
      { type: 'npc_birth', npcId: 'n', parentIds: [], lineageId: 'n' },
      { type: 'power_depleted', spiritId: PLAYER_SPIRIT_ID },
      { type: 'summon_storm', spiritId: PLAYER_SPIRIT_ID, poiId: 'p', depthM: 1, cells: 1 },
      { type: 'smite', spiritId: PLAYER_SPIRIT_ID, witnesses: 3 },
      { type: 'miracle', spiritId: PLAYER_SPIRIT_ID, poiId: 'p', needType: 'safety', amount: 1 },
      { type: 'crossing_upgraded', crossingId: 'c1', x: 0, y: 0, to: 0, toLabel: 'log' },
      { type: 'road_adopted', edgeId: 'e1', x: 0, y: 0, lengthT: 10 },
    ];
    for (const ev of yes) expect(isInterestingEvent(ev), ev.type).toBe(true);
  });

  it("the player's OWN answered prayer is not a seek trigger; a rival's is", () => {
    expect(isInterestingEvent({ type: 'answer_prayer', spiritId: PLAYER_SPIRIT_ID, npcId: 'n' })).toBe(false);
    expect(isInterestingEvent({ type: 'answer_prayer', spiritId: 'rival-2', npcId: 'n' })).toBe(true);
  });

  it('ignores low-signal sim noise', () => {
    const no: SimEvent[] = [
      { type: 'whisper', spiritId: PLAYER_SPIRIT_ID, npcId: 'n' },
      { type: 'npc_spawn', npcId: 'n', role: 'farmer' as never, poiId: 'p' },
      { type: 'region_realized', region: {} as never, cause: 'belief_spread' },
      { type: 'system_error', system: 's', message: 'm' },
      // Tidings band — fires every few game-seconds live; a seek would land
      // instantly if these counted (measured in the R9 integration smoke).
      { type: 'belief_cross', npcId: 'n', spiritId: PLAYER_SPIRIT_ID, kind: 'high', faith: 0.9 },
      { type: 'mood_cross', npcId: 'n', kind: 'low', mood: 0.1 },
    ];
    for (const ev of no) expect(isInterestingEvent(ev), ev.type).toBe(false);
  });

  it('describeInterest ranks a rival claim above a plain prayer and gives a label', () => {
    const rival = describeInterest({ type: 'answer_prayer', spiritId: 'rival-1', npcId: 'n' });
    const own = describeInterest({ type: 'answer_prayer', spiritId: PLAYER_SPIRIT_ID, npcId: 'n' });
    expect(rival.rank).toBeGreaterThan(own.rank);
    expect(rival.label.length).toBeGreaterThan(0);
    expect(describeInterest({ type: 'smite', spiritId: PLAYER_SPIRIT_ID, witnesses: 1 }).label).toMatch(/lightning/i);
  });

  it('describeInterest ranks a stone arch above a mid-ladder crossing above the founding log', () => {
    const stoneArch = describeInterest({ type: 'crossing_upgraded', crossingId: 'c1', x: 0, y: 0, to: 6, toLabel: 'stone arch', from: 5, fromLabel: 'timber arch' });
    const midLadder = describeInterest({ type: 'crossing_upgraded', crossingId: 'c1', x: 0, y: 0, to: 3, toLabel: 'plank walk', from: 2, fromLabel: 'log + rail' });
    const firstLog = describeInterest({ type: 'crossing_upgraded', crossingId: 'c1', x: 0, y: 0, to: 0, toLabel: 'log' });
    expect(stoneArch).toEqual({ rank: 47, label: 'A stone bridge rose over the water' });
    expect(midLadder).toEqual({ rank: 44, label: 'A river crossing was built up' });
    expect(firstLog).toEqual({ rank: 44, label: 'A log was laid over the water' });
  });

  it('describeInterest ranks a road_adopted beat between a generic crossing build and a stone arch', () => {
    const adopted = describeInterest({ type: 'road_adopted', edgeId: 'e1', x: 0, y: 0, lengthT: 10 });
    expect(adopted).toEqual({ rank: 45, label: 'A well-worn trail became a road' });
    expect(adopted.rank).toBeGreaterThan(describeInterest({ type: 'crossing_upgraded', crossingId: 'c1', x: 0, y: 0, to: 0, toLabel: 'log' }).rank);
    expect(adopted.rank).toBeLessThan(describeInterest({ type: 'crossing_upgraded', crossingId: 'c1', x: 0, y: 0, to: 6, toLabel: 'stone arch', from: 5, fromLabel: 'timber arch' }).rank);
  });
});
