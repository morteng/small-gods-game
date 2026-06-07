/**
 * Spirit status strip — a compact horizontal bar pinned to the top-centre that
 * carries the player's own readout (power, souls, believers) and, when they
 * exist, clickable rival chips. Replaces the old 260px left-hand "you" card.
 *
 * The handle API is unchanged (update / setBelieverStats / show / hide /
 * isVisible / destroy) so the frame loop and game coordinator need no edits.
 * Everything is token-driven, so it re-skins with the active `.sg-theme-*`.
 */

import type { SpiritId, Spirit } from '@/core/spirit';
import { POWER_REGEN_RATE } from '@/sim/spirit-system';

export interface SpiritHudOptions {
  onSelectRival?: (rivalId: SpiritId) => void;
}

export interface SpiritHudHandle {
  update(player: Spirit, rivals: Spirit[], totalFollowers: number): void;
  setBelieverStats(total: number, durable: number, goal: number): void;
  show(): void;
  hide(): void;
  isVisible(): boolean;
  destroy(): void;
}

const STYLE = `
.sg-statbar {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: stretch;
  gap: var(--s-3);
  padding: 8px 12px;
  background: var(--shade);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  box-shadow: var(--lift-2);
  font-family: var(--f-sans);
  color: var(--ink);
  z-index: 20;
  pointer-events: auto;
  max-width: calc(100% - 36px);
}

.sg-statbar__sigil {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px;
  background: var(--you-soft);
  border: 1px solid var(--you-line);
  border-radius: var(--r-pill);
  color: var(--you);
  font-size: 18px; font-weight: 700;
  cursor: default;
}

.sg-statbar__stat {
  display: flex; align-items: center; gap: var(--s-2);
  padding: 0 var(--s-2);
  cursor: default;
}
.sg-statbar__stat + .sg-statbar__stat,
.sg-statbar__rivals { border-left: 1px solid var(--line); }

.sg-statbar__icon { font-size: var(--t-md); line-height: 1; opacity: 0.9; }
.sg-statbar__val {
  font-family: var(--f-mono);
  font-size: var(--t-md);
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  min-width: 1.5em; text-align: right;
}
.sg-statbar__sub {
  font-family: var(--f-mono);
  font-size: var(--t-tiny);
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.sg-statbar__meter {
  width: 56px; height: 6px;
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.sg-statbar__meter-fill {
  height: 100%; border-radius: var(--r-pill);
  background: linear-gradient(90deg, var(--you), oklch(0.72 0.14 70));
  transition: width 200ms ease;
}
.sg-statbar__meter-fill--life { background: linear-gradient(90deg, var(--w-leaf), var(--w-grass)); }

.sg-statbar__rivals { display: flex; align-items: center; gap: var(--s-2); padding-left: var(--s-3); }
.sg-statbar__rivals-label {
  font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--ink-3);
}
.sg-statbar__rival {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px;
  background: var(--danger-soft);
  border: 1px solid oklch(0.52 0.16 30 / 0.4);
  border-radius: var(--r-pill);
  color: var(--danger);
  font-size: var(--t-small); font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, transform 80ms ease;
}
.sg-statbar__rival:hover { background: var(--danger-soft); filter: brightness(1.15); }
.sg-statbar__rival:active { transform: translateY(1px); }
.sg-statbar__rival-power { font-family: var(--f-mono); font-variant-numeric: tabular-nums; }
`;

const POWER_SCALE = 100; // display fullness reference
const SOULS_SCALE = 50;

export function createSpiritHud(
  container: HTMLElement,
  opts: SpiritHudOptions = {},
): SpiritHudHandle {
  if (!document.querySelector('#sg-spirit-hud-styles')) {
    const style = document.createElement('style');
    style.id = 'sg-spirit-hud-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const bar = document.createElement('div');
  bar.className = 'sg-statbar';

  // ── Sigil ──
  const sigil = document.createElement('div');
  sigil.className = 'sg-statbar__sigil';
  sigil.textContent = '✦';
  sigil.title = 'You — a small god cultivating belief among mortals.';
  bar.appendChild(sigil);

  // ── Stat cell factory ──
  function makeStat(
    icon: string,
    tip: string,
    withMeter: 'power' | 'life' | null,
  ): { cell: HTMLDivElement; val: HTMLSpanElement; sub: HTMLSpanElement; fill: HTMLDivElement | null } {
    const cell = document.createElement('div');
    cell.className = 'sg-statbar__stat';
    cell.title = tip;

    const ic = document.createElement('span');
    ic.className = 'sg-statbar__icon';
    ic.textContent = icon;

    const val = document.createElement('span');
    val.className = 'sg-statbar__val';

    cell.append(ic, val);

    let fill: HTMLDivElement | null = null;
    if (withMeter) {
      const meter = document.createElement('div');
      meter.className = 'sg-statbar__meter';
      fill = document.createElement('div');
      fill.className = `sg-statbar__meter-fill${withMeter === 'life' ? ' sg-statbar__meter-fill--life' : ''}`;
      meter.appendChild(fill);
      cell.appendChild(meter);
    }

    const sub = document.createElement('span');
    sub.className = 'sg-statbar__sub';
    cell.appendChild(sub);

    return { cell, val, sub, fill };
  }

  const power = makeStat('⚡', 'Divine power — spent on whispers, omens, dreams and miracles. Regenerates from your followers’ belief.', 'power');
  const souls = makeStat('☉', 'Souls aware of you — mortals whose faith in you has risen above a flicker.', 'life');
  const believers = makeStat('✝', 'Believers — total who hold faith in you, and how many are durable toward your goal.', null);
  bar.append(power.cell, souls.cell, believers.cell);

  // ── Rivals cluster (only shown when rivals exist) ──
  const rivals = document.createElement('div');
  rivals.className = 'sg-statbar__rivals';
  rivals.style.display = 'none';
  const rivalsLabel = document.createElement('span');
  rivalsLabel.className = 'sg-statbar__rivals-label';
  rivalsLabel.textContent = 'Rivals';
  const rivalsList = document.createElement('div');
  rivalsList.style.display = 'flex';
  rivalsList.style.gap = 'var(--s-2)';
  rivals.append(rivalsLabel, rivalsList);
  bar.appendChild(rivals);

  container.appendChild(bar);

  function formatPower(p: number): string { return p.toFixed(0); }

  function update(player: Spirit, rivalSpirits: Spirit[], totalFollowers: number): void {
    power.val.textContent = formatPower(player.power);
    if (power.fill) power.fill.style.width = `${Math.min(100, (player.power / POWER_SCALE) * 100)}%`;
    power.sub.textContent = `+${POWER_REGEN_RATE}/s`;

    souls.val.textContent = String(totalFollowers);
    if (souls.fill) souls.fill.style.width = `${Math.min(100, (totalFollowers / SOULS_SCALE) * 100)}%`;

    if (rivalSpirits.length === 0) {
      rivals.style.display = 'none';
      rivalsList.innerHTML = '';
      return;
    }
    rivals.style.display = 'flex';
    rivalsList.innerHTML = '';
    for (const rival of rivalSpirits) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'sg-statbar__rival';
      const strategy = (rival as unknown as { strategy?: string }).strategy ?? 'unknown';
      const rname = rival.name || 'Unknown Spirit';
      chip.title = `${rname} — rival spirit (${strategy}), power ${formatPower(rival.power)}. Click to inspect.`;
      const nm = document.createElement('span');
      nm.textContent = `⚔ ${rname}`;
      const pw = document.createElement('span');
      pw.className = 'sg-statbar__rival-power';
      pw.textContent = formatPower(rival.power);
      chip.append(nm, pw);
      chip.addEventListener('click', () => opts.onSelectRival?.(rival.id));
      rivalsList.appendChild(chip);
    }
  }

  function setBelieverStats(total: number, durable: number, goal: number): void {
    believers.val.textContent = String(total);
    believers.sub.textContent = `${durable}/${goal} durable`;
    believers.cell.title = `Believers — ${total} hold faith in you; ${durable} of ${goal} are durable toward your goal.`;
  }

  return {
    update,
    setBelieverStats,
    show() { bar.style.display = 'flex'; },
    hide() { bar.style.display = 'none'; },
    isVisible() { return bar.style.display !== 'none'; },
    destroy() { bar.remove(); },
  };
}
