import { describe, it, expect, vi } from 'vitest';
import { OverlayDispatcher, type OverlayHitArea } from '@/ui/overlay-dispatcher';

describe('OverlayDispatcher', () => {
  it('dispatches a hit area to the registered handler', () => {
    const d = new OverlayDispatcher();
    const handler = vi.fn(() => true);
    d.register('whisper', handler);
    const area: OverlayHitArea = { x: 0, y: 0, w: 10, h: 10, action: 'whisper', payload: { npcId: 'n1' }, active: true };
    expect(d.tryDispatch(5, 5, [area])).toBe(true);
    expect(handler).toHaveBeenCalledWith({ npcId: 'n1' });
  });

  it('returns false if no hit area contains the click', () => {
    const d = new OverlayDispatcher();
    d.register('whisper', () => true);
    const area: OverlayHitArea = { x: 0, y: 0, w: 10, h: 10, action: 'whisper', payload: null, active: true };
    expect(d.tryDispatch(50, 50, [area])).toBe(false);
  });

  it('skips inactive areas', () => {
    const d = new OverlayDispatcher();
    const handler = vi.fn(() => true);
    d.register('whisper', handler);
    const area: OverlayHitArea = { x: 0, y: 0, w: 10, h: 10, action: 'whisper', payload: null, active: false };
    d.tryDispatch(5, 5, [area]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores actions with no handler registered', () => {
    const d = new OverlayDispatcher();
    const area: OverlayHitArea = { x: 0, y: 0, w: 10, h: 10, action: 'omen', payload: null, active: true };
    expect(() => d.tryDispatch(5, 5, [area])).not.toThrow();
  });
});
