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

  root.appendChild(buildMainRow(deps));

  container.appendChild(root);

  function refresh(): void {
    // No-op in the skeleton; later tasks populate it.
  }

  return {
    refresh,
    dispose() { root.remove(); },
  };
}

function buildMainRow(deps: TimeBarDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sg-time-bar__row sg-time-bar__row--main';

  // Transport.
  const transport = document.createElement('div');
  transport.className = 'sg-time-bar__transport';
  transport.appendChild(makeIconBtn('rewind-to-start', '◄◄', () => deps.timeline.jumpTo(0)));
  transport.appendChild(makeIconBtn('toggle-pause', '▮▮', () => {
    if (deps.scheduler.getRate() === 0) deps.scheduler.setRate(1);
    else deps.scheduler.setRate(0);
  }));
  transport.appendChild(makeIconBtn('jump-to-now', '►|', () => deps.timeline.returnToLive()));
  row.appendChild(transport);

  // Track placeholder (Task 18 fills in glyphs and handle).
  const track = document.createElement('div');
  track.className = 'sg-time-bar__track';
  track.setAttribute('role', 'slider');
  row.appendChild(track);

  // Tick label.
  const tickLabel = document.createElement('div');
  tickLabel.className = 'sg-time-bar__label';
  tickLabel.textContent = `${deps.timeline.currentTick} / ${deps.timeline.maxTick}`;
  row.appendChild(tickLabel);

  // Speed buttons.
  const speed = document.createElement('div');
  speed.className = 'sg-time-bar__speed';
  speed.setAttribute('role', 'radiogroup');
  for (const rate of [1, 2, 4, 8] as const) {
    const b = document.createElement('button');
    b.dataset.rate = String(rate);
    b.textContent = `${rate}×`;
    b.className = 'sg-time-bar__speed-btn';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(deps.scheduler.getRate() === rate));
    b.addEventListener('click', () => {
      deps.scheduler.setRate(rate);
      refreshSpeedAria();
    });
    speed.appendChild(b);
  }
  row.appendChild(speed);

  // Dismiss.
  const dismiss = document.createElement('button');
  dismiss.className = 'sg-time-bar__dismiss';
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.addEventListener('click', () => deps.onDismiss());
  row.appendChild(dismiss);

  function refreshSpeedAria(): void {
    const current = deps.scheduler.getRate();
    speed.querySelectorAll('button').forEach(b => {
      b.setAttribute('aria-checked', String(Number(b.dataset.rate) === current));
    });
  }

  return row;
}

function makeIconBtn(action: string, glyph: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.dataset.action = action;
  b.className = 'sg-icon-btn';
  b.textContent = glyph;
  b.addEventListener('click', onClick);
  return b;
}
