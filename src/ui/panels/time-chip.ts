// src/ui/panels/time-chip.ts
import type { SimClock } from '@/core/clock';
import { calendarLabel } from '@/core/calendar';

export interface TimeChipOptions {
  clock: SimClock;
  getRate: () => number;
  isPaused: () => boolean;
  onClick: () => void;
}

export interface TimeChipHandle {
  refresh(): void;
  dispose(): void;
}

export function mountTimeChip(host: HTMLElement, opts: TimeChipOptions): TimeChipHandle {
  const btn = document.createElement('button');
  btn.className = 'sg-time-chip sg-chip';
  btn.style.pointerEvents = 'auto';
  btn.setAttribute('aria-label', 'Toggle time bar');
  btn.addEventListener('click', opts.onClick);

  const icon = document.createElement('span');
  icon.className = 'sg-time-chip__icon';
  icon.textContent = '◷';
  btn.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'sg-time-chip__label';
  btn.appendChild(label);

  const badge = document.createElement('span');
  badge.className = 'sg-time-chip__rate';
  btn.appendChild(badge);

  host.appendChild(btn);

  function refresh(): void {
    label.textContent = ' ' + calendarLabel(opts.clock.now()) + ' ';
    if (opts.isPaused()) {
      badge.textContent = 'paused';
      btn.classList.add('sg-time-chip--paused');
    } else {
      badge.textContent = `${opts.getRate()}×`;
      btn.classList.remove('sg-time-chip--paused');
    }
  }
  refresh();
  return {
    refresh,
    dispose() { btn.remove(); },
  };
}
