import { describe, it, expect } from 'vitest';
import { signResponse, SIGN_RESPONSE_FLOOR } from '@/sim/npc-sim';

describe('signResponse', () => {
  it('floors at understanding=0', () => {
    expect(signResponse(0)).toBeCloseTo(0.5, 5);
    expect(SIGN_RESPONSE_FLOOR).toBe(0.5);
  });

  it('reaches 1.0 at understanding=1', () => {
    expect(signResponse(1)).toBeCloseTo(1.0, 5);
  });

  it('is linear in between', () => {
    expect(signResponse(0.2)).toBeCloseTo(0.6, 5);
    expect(signResponse(0.5)).toBeCloseTo(0.75, 5);
  });

  it('clamps out-of-range input', () => {
    expect(signResponse(-1)).toBeCloseTo(0.5, 5);
    expect(signResponse(2)).toBeCloseTo(1.0, 5);
  });
});
