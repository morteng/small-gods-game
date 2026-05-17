/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { mountTimeBar } from '@/ui/panels/time-bar';

function makeDeps() {
  return {
    timeline: {
      isScrubbed: false,
      currentTick: 600,
      maxTick: 1200,
      jumpTo: vi.fn(),
      returnToLive: vi.fn(),
      commit: vi.fn(),
      onAfterLiveTick: () => {},
    },
    scheduler: { setRate: vi.fn(), getRate: () => 1 },
    eventLog: { subscribe: () => () => {}, since: () => [], size: () => 0 },
    clock: { now: () => 600 },
    onDismiss: vi.fn(),
  } as unknown as Parameters<typeof mountTimeBar>[1];
}

describe('TimeBar scrub track', () => {
  it('renders a track with a handle positioned at currentTick / maxTick', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mountTimeBar(container, makeDeps());
    const handle = container.querySelector('.sg-time-bar__handle') as HTMLElement;
    expect(handle).not.toBeNull();
    expect(handle.style.left).toBe('50%');
  });

  it('clicking the track at 25% calls timeline.jumpTo(0.25 * maxTick)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const deps = makeDeps();
    mountTimeBar(container, deps);
    const track = container.querySelector('.sg-time-bar__track') as HTMLElement;
    track.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 32, width: 400, height: 32, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    track.dispatchEvent(new MouseEvent('click', { clientX: 100, bubbles: true }));
    expect(deps.timeline.jumpTo).toHaveBeenCalledWith(300);
  });
});
