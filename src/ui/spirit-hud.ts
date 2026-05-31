/**
 * Spirit HUD — Persistent overlay showing player spirit stats and rival summary.
 * Stays visible during gameplay in the top-left area.
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
.sg-spirit-hud {
  position: absolute;
  top: 60px;
  left: 18px;
  width: 260px;
  background: var(--shade);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  padding: var(--s-3);
  font-family: var(--f-sans);
  font-size: var(--t-small);
  color: var(--ink);
  z-index: 20;
  pointer-events: auto;
  box-shadow: var(--lift-1);
}

.sg-spirit-hud__header {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-bottom: var(--s-3);
}

.sg-spirit-hud__sigil {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--you-soft);
  border: 1px solid var(--you-line);
  border-radius: var(--r-2);
  font-size: 16px;
  font-weight: 700;
  color: var(--you);
}

.sg-spirit-hud__title {
  flex: 1;
}

.sg-spirit-hud__name {
  font-weight: 600;
  font-size: var(--t-base);
  color: var(--ink);
}

.sg-spirit-hud__role {
  font-size: var(--t-micro);
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.sg-spirit-hud__stat-row {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-bottom: var(--s-2);
}

.sg-spirit-hud__stat-label {
  flex: 0 0 60px;
  font-size: var(--t-micro);
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.sg-spirit-hud__stat-value {
  flex: 0 0 50px;
  font-family: var(--f-mono);
  font-size: var(--t-small);
  color: var(--ink-2);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.sg-spirit-hud__meter {
  flex: 1;
  height: 6px;
  background: var(--paper-2);
  border-radius: var(--r-pill);
  overflow: hidden;
}

.sg-spirit-hud__meter-fill {
  height: 100%;
  border-radius: var(--r-pill);
  transition: width 200ms ease;
}

.sg-spirit-hud__meter-fill--power {
  background: linear-gradient(90deg, var(--you), oklch(0.68 0.14 45));
}

.sg-spirit-hud__regen {
  font-size: var(--t-micro);
  color: var(--ink-4);
  margin-left: auto;
  font-family: var(--f-mono);
}

.sg-spirit-hud__divider {
  height: 1px;
  background: var(--line);
  margin: var(--s-3) 0;
}

.sg-spirit-hud__section-title {
  font-size: var(--t-micro);
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: var(--s-2);
}

.sg-spirit-hud__rival-list {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.sg-spirit-hud__rival {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-1) var(--s-2);
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.sg-spirit-hud__rival:hover {
  background: var(--paper);
  border-color: var(--line-2);
}

.sg-spirit-hud__rival--competing {
  border-color: var(--danger-soft);
}

.sg-spirit-hud__rival-sigil {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--danger-soft);
  border: 1px solid oklch(0.52 0.16 30 / 0.4);
  border-radius: var(--r-1);
  font-size: 12px;
  color: var(--danger);
}

.sg-spirit-hud__rival-info {
  flex: 1;
  min-width: 0;
}

.sg-spirit-hud__rival-name {
  font-size: var(--t-small);
  font-weight: 500;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sg-spirit-hud__rival-meta {
  font-size: var(--t-micro);
  color: var(--ink-4);
  font-family: var(--f-mono);
}

.sg-spirit-hud__rival-power {
  font-family: var(--f-mono);
  font-size: var(--t-small);
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}

.sg-spirit-hud__empty {
  font-size: var(--t-small);
  color: var(--ink-4);
  font-style: italic;
  padding: var(--s-2) 0;
  text-align: center;
}
`;

export function createSpiritHud(
  container: HTMLElement,
  opts: SpiritHudOptions = {},
): SpiritHudHandle {
  // Inject styles
  if (!document.querySelector('#sg-spirit-hud-styles')) {
    const style = document.createElement('style');
    style.id = 'sg-spirit-hud-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const hud = document.createElement('div');
  hud.className = 'sg-spirit-hud';

  // Header with player sigil
  const header = document.createElement('div');
  header.className = 'sg-spirit-hud__header';

  const sigil = document.createElement('div');
  sigil.className = 'sg-spirit-hud__sigil';
  sigil.textContent = '✦';
  header.appendChild(sigil);

  const title = document.createElement('div');
  title.className = 'sg-spirit-hud__title';

  const name = document.createElement('div');
  name.className = 'sg-spirit-hud__name';
  name.textContent = 'You';
  title.appendChild(name);

  const role = document.createElement('div');
  role.className = 'sg-spirit-hud__role';
  role.textContent = 'Player Spirit';
  title.appendChild(role);

  header.appendChild(title);
  hud.appendChild(header);

  // Power stat
  const powerRow = document.createElement('div');
  powerRow.className = 'sg-spirit-hud__stat-row';

  const powerLabel = document.createElement('div');
  powerLabel.className = 'sg-spirit-hud__stat-label';
  powerLabel.textContent = 'Power';
  powerRow.appendChild(powerLabel);

  const powerMeter = document.createElement('div');
  powerMeter.className = 'sg-spirit-hud__meter';

  const powerFill = document.createElement('div');
  powerFill.className = 'sg-spirit-hud__meter-fill sg-spirit-hud__meter-fill--power';
  powerMeter.appendChild(powerFill);
  powerRow.appendChild(powerMeter);

  const powerValue = document.createElement('div');
  powerValue.className = 'sg-spirit-hud__stat-value';
  powerRow.appendChild(powerValue);

  const regenBadge = document.createElement('div');
  regenBadge.className = 'sg-spirit-hud__regen';
  powerRow.appendChild(regenBadge);

  hud.appendChild(powerRow);

  // Followers stat
  const followerRow = document.createElement('div');
  followerRow.className = 'sg-spirit-hud__stat-row';

  const followerLabel = document.createElement('div');
  followerLabel.className = 'sg-spirit-hud__stat-label';
  followerLabel.textContent = 'Souls';
  followerRow.appendChild(followerLabel);

  const followerMeter = document.createElement('div');
  followerMeter.className = 'sg-spirit-hud__meter';

  const followerFill = document.createElement('div');
  followerFill.className = 'sg-spirit-hud__meter-fill sg-spirit-hud__meter-fill--power';
  followerMeter.appendChild(followerFill);
  followerRow.appendChild(followerMeter);

  const followerValue = document.createElement('div');
  followerValue.className = 'sg-spirit-hud__stat-value';
  followerRow.appendChild(followerValue);

  hud.appendChild(followerRow);

  // Believer/durable stat row
  const believerRow = document.createElement('div');
  believerRow.className = 'sg-spirit-hud__stat-row';

  const believerLabel = document.createElement('div');
  believerLabel.className = 'sg-spirit-hud__stat-label';
  believerLabel.textContent = 'Believers';
  believerRow.appendChild(believerLabel);

  const believerValue = document.createElement('div');
  believerValue.className = 'sg-spirit-hud__stat-value';
  believerRow.appendChild(believerValue);

  const durableValue = document.createElement('div');
  durableValue.className = 'sg-spirit-hud__regen';
  believerRow.appendChild(durableValue);

  hud.appendChild(believerRow);

  // Divider
  const divider = document.createElement('div');
  divider.className = 'sg-spirit-hud__divider';
  hud.appendChild(divider);

  // Rivals section
  const rivalSection = document.createElement('div');

  const rivalTitle = document.createElement('div');
  rivalTitle.className = 'sg-spirit-hud__section-title';
  rivalTitle.textContent = 'Rival Spirits';
  rivalSection.appendChild(rivalTitle);

  const rivalList = document.createElement('div');
  rivalList.className = 'sg-spirit-hud__rival-list';
  rivalSection.appendChild(rivalList);

  hud.appendChild(rivalSection);

  container.appendChild(hud);

  function formatPower(power: number): string {
    return power.toFixed(0);
  }

  function update(
    player: Spirit,
    rivals: Spirit[],
    totalFollowers: number,
  ): void {
    // Update power
    const maxPower = 100; // Arbitrary scale for display
    const powerPct = Math.min(100, (player.power / maxPower) * 100);
    powerFill.style.width = `${powerPct}%`;
    powerValue.textContent = formatPower(player.power);
    regenBadge.textContent = `+${POWER_REGEN_RATE}/s`;

    // Update followers
    const maxFollowers = 50; // Arbitrary scale
    const followerPct = Math.min(100, (totalFollowers / maxFollowers) * 100);
    followerFill.style.width = `${followerPct}%`;
    followerValue.textContent = String(totalFollowers);

    // Update rivals
    rivalList.innerHTML = '';
    if (rivals.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sg-spirit-hud__empty';
      empty.textContent = 'No rivals yet';
      rivalList.appendChild(empty);
      return;
    }

    for (const rival of rivals) {
      const rivalEl = document.createElement('div');
      rivalEl.className = 'sg-spirit-hud__rival';
      // TODO: Add competing detection
      // if (isCompetingWithPlayer(rival)) rivalEl.classList.add('sg-spirit-hud__rival--competing');

      const rivalSigil = document.createElement('div');
      rivalSigil.className = 'sg-spirit-hud__rival-sigil';
      rivalSigil.textContent = '⚔';
      rivalEl.appendChild(rivalSigil);

      const rivalInfo = document.createElement('div');
      rivalInfo.className = 'sg-spirit-hud__rival-info';

      const rivalName = document.createElement('div');
      rivalName.className = 'sg-spirit-hud__rival-name';
      rivalName.textContent = rival.name || 'Unknown Spirit';
      rivalInfo.appendChild(rivalName);

      const rivalMeta = document.createElement('div');
      rivalMeta.className = 'sg-spirit-hud__rival-meta';
      const strategy = (rival as any).strategy || 'unknown';
      rivalMeta.textContent = strategy;
      rivalInfo.appendChild(rivalMeta);

      rivalEl.appendChild(rivalInfo);

      const rivalPower = document.createElement('div');
      rivalPower.className = 'sg-spirit-hud__rival-power';
      rivalPower.textContent = formatPower(rival.power);
      rivalEl.appendChild(rivalPower);

      rivalEl.addEventListener('click', () => {
        opts.onSelectRival?.(rival.id);
      });

      rivalList.appendChild(rivalEl);
    }
  }

  function setBelieverStats(total: number, durable: number, goal: number): void {
    believerValue.textContent = String(total);
    durableValue.textContent = `Durable ${durable}/${goal}`;
  }

  function show() {
    hud.style.display = 'block';
  }

  function hide() {
    hud.style.display = 'none';
  }

  function isVisible(): boolean {
    return hud.style.display !== 'none';
  }

  return {
    update,
    setBelieverStats,
    show,
    hide,
    isVisible,
    destroy() {
      hud.remove();
    },
  };
}
