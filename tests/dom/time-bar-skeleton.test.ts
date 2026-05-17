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
