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
});
