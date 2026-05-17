import type { TimelineController } from '@/core/timeline';
import type { Scheduler } from '@/core/scheduler';
import type { EventLog } from '@/core/events';
import type { SimClock } from '@/core/clock';

export interface TimeBarDeps {
  timeline: TimelineController;
  scheduler: Scheduler;
  eventLog: EventLog;
  clock: SimClock;
  onDismiss(): void;
}

export interface TimeBarHandle {
  refresh(): void;
  dispose(): void;
}

export function mountTimeBar(container: HTMLElement, deps: TimeBarDeps): TimeBarHandle {
  const root = document.createElement('div');
  root.className = 'sg-time-bar sg-fade-up';
  root.style.cssText = [
    'position:absolute', 'left:18px', 'right:18px', 'bottom:18px',
    'z-index:25', 'pointer-events:auto',
  ].join(';');
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Timeline');

  const mainRow = document.createElement('div');
  mainRow.className = 'sg-time-bar__row sg-time-bar__row--main';
  root.appendChild(mainRow);

  container.appendChild(root);

  function refresh(): void {
    // No-op in the skeleton; later tasks populate it.
  }

  return {
    refresh,
    dispose() { root.remove(); },
  };
}
