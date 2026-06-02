/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { mountTimeHistory } from '@/ui/panels/time-history';

describe('time-history era_skipped chip', () => {
  it('renders a chip for an era_skipped event', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const container = document.createElement('div');
    mountTimeHistory(container, {
      eventLog: log,
      timeline: { jumpTo() {}, currentTick: 0 },
    });
    log.append({
      type: 'era_skipped', fromTick: 0, toTick: 23040, years: 25,
      deaths: 4, births: 6, believersBefore: 8, believersAfter: 9,
    });
    const chip = container.querySelector('[data-kind="era_skipped"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('25');
  });
});
