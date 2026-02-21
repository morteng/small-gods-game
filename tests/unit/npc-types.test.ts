import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';

describe('GameState.npcs', () => {
  it('initialises with empty npcs array', () => {
    const state = createState();
    expect(state.npcs).toEqual([]);
  });
});
