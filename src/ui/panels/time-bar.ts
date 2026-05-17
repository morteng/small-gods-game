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
    const main = root.querySelector('.sg-time-bar__row--main') as HTMLElement & { __positionHandle?: () => void };
    main.__positionHandle?.();
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

  // Track with scrub handle (Task 18).
  const track = document.createElement('div');
  track.className = 'sg-time-bar__track';
  track.setAttribute('role', 'slider');
  track.setAttribute('tabindex', '0');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(deps.timeline.maxTick));
  track.setAttribute('aria-valuenow', String(deps.timeline.currentTick));

  const line = document.createElement('div');
  line.className = 'sg-time-bar__line';
  track.appendChild(line);

  const handle = document.createElement('div');
  handle.className = 'sg-time-bar__handle';
  track.appendChild(handle);

  const TYPE_TO_GLYPH: Record<string, { type: string; color: string }> = {
    whisper:         { type: 'whisper',     color: 'var(--w-dusk)' },
    belief_cross:    { type: 'beliefRise',  color: 'var(--w-sun)'  },
    region_realized: { type: 'realize',     color: 'var(--time)'   },
    spirit_manifest: { type: 'rival',       color: 'var(--danger)' },
    mood_cross:      { type: 'mood',        color: 'var(--ink-3)'  },
  };

  function renderGlyphs(): void {
    track.querySelectorAll('.sg-time-bar__glyph').forEach(el => el.remove());
    const max = Math.max(1, deps.timeline.maxTick);
    for (const a of deps.eventLog.since(0)) {
      const meta = TYPE_TO_GLYPH[a.event.type];
      if (!meta) continue;
      const el = document.createElement('div');
      el.className = 'sg-time-bar__glyph';
      el.dataset.glyphType = meta.type;
      el.style.left = `${(a.t / max) * 100}%`;
      el.style.color = meta.color;
      el.title = `tick ${a.t} · ${meta.type}`;
      track.appendChild(el);
    }
  }

  renderGlyphs();
  deps.eventLog.subscribe(() => renderGlyphs());

  const positionHandle = (): void => {
    const max = Math.max(1, deps.timeline.maxTick);
    const pct = Math.min(100, Math.max(0, (deps.timeline.currentTick / max) * 100));
    handle.style.left = `${pct}%`;
  };
  positionHandle();

  const tickFromClientX = (clientX: number): number => {
    const rect = track.getBoundingClientRect();
    const rel = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(rel * deps.timeline.maxTick);
  };

  track.addEventListener('click', (e) => {
    deps.timeline.jumpTo(tickFromClientX((e as MouseEvent).clientX));
  });

  let dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.setPointerCapture?.(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    deps.timeline.jumpTo(tickFromClientX(e.clientX));
  });
  handle.addEventListener('pointerup', (e) => {
    dragging = false;
    handle.releasePointerCapture?.(e.pointerId);
  });

  track.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 50 : 1;
    if (e.key === 'ArrowLeft')  deps.timeline.jumpTo(Math.max(0, deps.timeline.currentTick - step));
    if (e.key === 'ArrowRight') deps.timeline.jumpTo(Math.min(deps.timeline.maxTick, deps.timeline.currentTick + step));
    if (e.key === 'Home')       deps.timeline.jumpTo(0);
    if (e.key === 'End')        deps.timeline.jumpTo(deps.timeline.maxTick);
  });

  // Tag the row with a refresh hook so the bar's outer refresh() can call positionHandle.
  (row as HTMLElement & { __positionHandle?: () => void }).__positionHandle = positionHandle;

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
