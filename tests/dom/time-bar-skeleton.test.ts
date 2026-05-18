/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { mountTimeBar } from '@/ui/panels/time-bar';

describe('TimeBar skeleton', () => {
  it('mounts and dismounts cleanly', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const bar = mountTimeBar(container, makeFakeDeps());
    expect(container.querySelector('.sg-time-bar')).not.toBeNull();
    bar.dispose();
    expect(container.querySelector('.sg-time-bar')).toBeNull();
  });

  it('mounts the time history strip as the first child, above the main row', () => {
    const c = document.createElement('div');
    const handle = mountTimeBar(c, makeFakeDeps());

    const strip = c.querySelector('.sg-time-history');
    expect(strip).not.toBeNull();

    const root = c.querySelector('.sg-time-bar')!;
    expect(root.firstElementChild?.classList.contains('sg-time-history')).toBe(true);

    handle.dispose();
    expect(c.querySelector('.sg-time-history')).toBeNull();
  });
});

function makeFakeDeps() {
  return {
    timeline: {
      isScrubbed: false,
      currentTick: 0,
      maxTick: 0,
      jumpTo: () => {},
      returnToLive: () => {},
      commit: () => {},
      onAfterLiveTick: () => {},
    },
    scheduler: { setRate: () => {}, getRate: () => 1 },
    eventLog: {
      subscribe: () => () => {},
      since: () => [],
      size: () => 0,
    },
    clock: { now: () => 0 },
    onDismiss: () => {},
  } as unknown as Parameters<typeof mountTimeBar>[1];
}
