import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';

describe('createState', () => {
  it('starts unpaused', () => {
    const s = createState();
    expect(s.paused).toBe(false);
  });

  it('starts with debug off', () => {
    const s = createState();
    expect(s.debug).toBe(false);
  });

  it('starts with labels visible', () => {
    const s = createState();
    expect(s.showLabels).toBe(true);
  });

  it('starts with POI markers visible', () => {
    const s = createState();
    expect(s.showPoiMarkers).toBe(true);
  });

  it('starts with no pinned NPC', () => {
    const s = createState();
    expect(s.pinnedNpcId).toBeNull();
  });

  it('starts with follow mode off', () => {
    const s = createState();
    expect(s.followNpc).toBe(false);
  });
});
