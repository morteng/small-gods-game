import type { EventLog, AppendedEvent } from '@/core/events';

export interface TimeHistoryDeps {
  eventLog: EventLog;
  timeline: { jumpTo(tick: number): void; readonly currentTick: number };
}

export interface TimeHistoryHandle {
  refresh(): void;
  dispose(): void;
}

const MAX_CHIPS = 50;

type ChipType = 'timeline_commit' | 'whisper' | 'answer_prayer' | 'dream' | 'believer_lost' | 'era_skipped';

interface ChipEntry {
  tick: number;
  type: ChipType;
  el: HTMLElement;
}

/** Icon + short label per surfaced event type. Acts the player takes (Answer,
 *  Deepen) and consequences (a believer lost) appear alongside whispers/commits
 *  so each act visibly lands in the history strip. */
const CHIP_LABELS: Record<ChipType, { icon: string; label: string }> = {
  timeline_commit: { icon: '▼', label: 'commit' },
  whisper:         { icon: '≈', label: 'whisper' },
  answer_prayer:   { icon: '🙏', label: 'answered' },
  dream:           { icon: '🌙', label: 'deepened' },
  believer_lost:   { icon: '✗', label: 'turned away' },
  era_skipped:     { icon: '⏭', label: 'era skipped' },
};

export function mountTimeHistory(container: HTMLElement, deps: TimeHistoryDeps): TimeHistoryHandle {
  const root = document.createElement('div');
  root.className = 'sg-time-history';
  root.setAttribute('role', 'list');
  root.setAttribute('aria-label', 'Time history');
  container.appendChild(root);

  let chips: ChipEntry[] = [];

  function buildChip(ev: AppendedEvent): ChipEntry | null {
    const t = ev.event.type;
    if (!(t in CHIP_LABELS)) return null;
    const { icon, label } = CHIP_LABELS[t as ChipType];
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sg-time-history__chip';
    el.setAttribute('role', 'listitem');
    el.dataset.tick = String(ev.t);
    el.dataset.kind = t;
    if (t === 'era_skipped' && ev.event.type === 'era_skipped') {
      const yrs = ev.event.years;
      el.textContent = `${icon} +${yrs}y`;
      el.title = `era skipped ${yrs} years — committed at tick ${ev.t}`;
    } else {
      el.textContent = icon + ' ' + label + ' ' + ev.t;
      el.title = label + ' at tick ' + ev.t + ' — click to scrub';
    }
    el.addEventListener('click', () => deps.timeline.jumpTo(ev.t));
    return { tick: ev.t, type: t as ChipType, el };
  }

  function appendChip(entry: ChipEntry) {
    chips.push(entry);
    root.appendChild(entry.el);
    while (chips.length > MAX_CHIPS) {
      const dropped = chips.shift()!;
      dropped.el.remove();
    }
  }

  function truncateAfter(parentTick: number) {
    chips = chips.filter(c => {
      if (c.tick > parentTick) {
        c.el.remove();
        return false;
      }
      return true;
    });
  }

  function ingest(ev: AppendedEvent) {
    if (ev.event.type === 'timeline_commit') {
      // Truncate chips that are beyond the commit's parentTick BEFORE appending
      // the commit chip itself, so the commit chip survives.
      truncateAfter(ev.event.parentTick);
    }
    const chip = buildChip(ev);
    if (chip) appendChip(chip);
  }

  // Backfill from existing log (since takes event id, 0 means all events)
  for (const ev of deps.eventLog.since(0)) ingest(ev);
  const unsubscribe = deps.eventLog.subscribe(ingest);

  return {
    refresh() {
      // Future: current-playhead accent. Minimal strip leaves visual playhead
      // highlighting to a follow-up — chips are clickable regardless.
    },
    dispose() {
      unsubscribe();
      root.remove();
    },
  };
}
