/**
 * Spend chip — a subtle bottom-left readout of real USD spent on the LLM.
 * Shown only for the OpenRouter provider (the path with real cost data); the
 * caller toggles visibility via setVisible. Click expands a small popover with
 * all-time spend and call / cache-hit counts.
 */

import type { CostTracker, SpendSnapshot } from '@/llm/cost-tracker';

export interface SpendChipHandle {
  setVisible(visible: boolean): void;
  destroy(): void;
}

const STYLE = `
.sg-spend {
  position: absolute; left: 12px; bottom: 12px; z-index: 40;
  font-family: var(--f-sans, system-ui, sans-serif); font-size: var(--t-tiny, 11px);
  color: var(--ink-3); background: var(--paper, #fff); border: 1px solid var(--line);
  border-radius: var(--r-pill, 999px); padding: 5px 10px; cursor: pointer;
  font-variant-numeric: tabular-nums; box-shadow: var(--lift-1, 0 1px 2px rgba(0,0,0,0.1));
  user-select: none; white-space: nowrap;
}
.sg-spend:hover { color: var(--ink-2); border-color: var(--line-2); }
.sg-spend__pop {
  position: absolute; left: 0; bottom: calc(100% + 6px);
  background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-2, 6px);
  padding: 8px 10px; box-shadow: var(--lift-2); color: var(--ink-2);
  display: none; flex-direction: column; gap: 3px; min-width: 150px;
}
.sg-spend.is-open .sg-spend__pop { display: flex; }
.sg-spend__pop-row { display: flex; justify-content: space-between; gap: 12px; }
.sg-spend__pop-row span:last-child { color: var(--ink); }
`;

function fmt(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function injectStyle(): void {
  if (document.querySelector('#sg-spend-styles')) return;
  const el = document.createElement('style');
  el.id = 'sg-spend-styles';
  el.textContent = STYLE;
  document.head.appendChild(el);
}

export function mountSpendChip(host: HTMLElement, tracker: CostTracker): SpendChipHandle {
  injectStyle();

  const chip = document.createElement('div');
  chip.className = 'sg-spend';

  const label = document.createElement('span');
  chip.appendChild(label);

  const pop = document.createElement('div');
  pop.className = 'sg-spend__pop';
  chip.appendChild(pop);

  function popRow(k: string, v: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sg-spend__pop-row';
    const a = document.createElement('span'); a.textContent = k;
    const b = document.createElement('span'); b.textContent = v;
    row.append(a, b);
    return row;
  }

  function render(s: SpendSnapshot): void {
    label.textContent = `${fmt(s.sessionUsd)} session · ${fmt(s.monthUsd)} month`;
    while (pop.firstChild) pop.removeChild(pop.firstChild);
    pop.append(
      popRow('This session', fmt(s.sessionUsd)),
      popRow('This month', fmt(s.monthUsd)),
      popRow('All time', fmt(s.allTimeUsd)),
      popRow('Calls', String(s.calls)),
      popRow('Cached (free)', String(s.cacheHits)),
    );
  }

  render(tracker.snapshot());
  const unsub = tracker.subscribe(render);

  chip.addEventListener('click', () => chip.classList.toggle('is-open'));

  host.appendChild(chip);

  return {
    setVisible(visible: boolean): void { chip.style.display = visible ? '' : 'none'; },
    destroy(): void { unsub(); chip.remove(); },
  };
}
