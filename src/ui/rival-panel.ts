/**
 * Rival Spirit Panel — shows detailed info about a rival spirit.
 * Includes personality, strategy, power, followers, and recent actions.
 */

import type { RivalSpirit, RivalPersonality, RivalAction } from '@/sim/rival-spirit';
import type { NpcSimState } from '@/core/types';

const STYLE = `
.sg-rival-panel {
  position: absolute;
  top: 60px;
  right: 18px;
  width: 300px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--r-4);
  box-shadow: var(--lift-2);
  font-family: var(--f-sans);
  font-size: var(--t-small);
  color: var(--ink);
  z-index: 25;
  pointer-events: auto;
  animation: sg-fade-up 200ms ease-out;
}

.sg-rival-panel__header {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-4);
  border-bottom: 1px solid var(--line);
}

.sg-rival-panel__sigil {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--danger-soft);
  border: 1px solid oklch(0.52 0.16 30 / 0.4);
  border-radius: var(--r-3);
  font-size: 20px;
  color: var(--danger);
}

.sg-rival-panel__title {
  flex: 1;
  min-width: 0;
}

.sg-rival-panel__name {
  font-weight: 600;
  font-size: var(--t-md);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sg-rival-panel__subtitle {
  font-size: var(--t-micro);
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.sg-rival-panel__close {
  all: unset;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--r-2);
  color: var(--ink-3);
  font-size: 18px;
  line-height: 1;
}

.sg-rival-panel__close:hover {
  background: var(--paper-2);
  color: var(--ink);
}

.sg-rival-panel__section {
  padding: var(--s-4);
  border-bottom: 1px solid var(--line);
}

.sg-rival-panel__section:last-child {
  border-bottom: none;
}

.sg-rival-panel__section-title {
  font-size: var(--t-micro);
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: var(--s-2);
}

.sg-rival-panel__stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-2);
}

.sg-rival-panel__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sg-rival-panel__stat-label {
  font-size: var(--t-micro);
  color: var(--ink-4);
}

.sg-rival-panel__stat-value {
  font-family: var(--f-mono);
  font-size: var(--t-base);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.sg-rival-panel__personality {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.sg-rival-panel__trait {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.sg-rival-panel__trait-label {
  flex: 0 0 85px;
  font-size: var(--t-micro);
  color: var(--ink-3);
}

.sg-rival-panel__trait-bar {
  flex: 1;
  height: 4px;
  background: var(--paper-2);
  border-radius: var(--r-pill);
  overflow: hidden;
}

.sg-rival-panel__trait-fill {
  height: 100%;
  border-radius: var(--r-pill);
  background: var(--danger);
  transition: width 200ms ease;
}

.sg-rival-panel__strategy {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  padding: 4px 10px;
  background: var(--danger-soft);
  border: 1px solid oklch(0.52 0.16 30 / 0.4);
  border-radius: var(--r-pill);
  font-size: var(--t-small);
  color: var(--danger);
  font-weight: 500;
}

.sg-rival-panel__action-list {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.sg-rival-panel__action {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-2);
  background: var(--paper-2);
  border-radius: var(--r-2);
  font-size: var(--t-small);
}

.sg-rival-panel__action-type {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: var(--r-pill);
  font-size: var(--t-micro);
  font-weight: 500;
  background: var(--shade);
  color: var(--ink-2);
}

.sg-rival-panel__action-target {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
}

.sg-rival-panel__action-cost {
  font-family: var(--f-mono);
  font-size: var(--t-micro);
  color: var(--ink-4);
}

.sg-rival-panel__competition {
  padding: var(--s-3);
  background: oklch(0.52 0.16 30 / 0.08);
  border: 1px solid oklch(0.52 0.16 30 / 0.3);
  border-radius: var(--r-2);
}

.sg-rival-panel__competition-title {
  font-size: var(--t-small);
  font-weight: 600;
  color: var(--danger);
  margin-bottom: var(--s-2);
}

.sg-rival-panel__competition-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sg-rival-panel__competition-item {
  font-size: var(--t-micro);
  color: var(--ink-2);
}

.sg-rival-panel__empty {
  font-size: var(--t-small);
  color: var(--ink-4);
  font-style: italic;
  padding: var(--s-2) 0;
}
`;

export interface RivalPanelOptions {
  onClose?: () => void;
  onTargetNpc?: (npcId: string) => void;
}

export interface RivalPanelHandle {
  element: HTMLElement;
  update(rival: RivalSpirit, competingNpcs: NpcSimState[]): void;
  show(): void;
  hide(): void;
  isVisible(): boolean;
  destroy(): void;
}

function getStrategyLabel(strategy: string): string {
  const labels: Record<string, string> = {
    expand: 'Expand',
    defend: 'Defend',
    undermine: 'Undermine',
    coexist: 'Coexist',
  };
  return labels[strategy] || strategy;
}

function getActionLabel(type: string): string {
  const labels: Record<string, string> = {
    whisper: 'Whisper',
    omen: 'Omen',
    miracle: 'Miracle',
    curse: 'Curse',
    proselytize: 'Proselytize',
    discredit: 'Discredit',
  };
  return labels[type] || type;
}

export function createRivalPanel(
  container: HTMLElement,
  opts: RivalPanelOptions = {},
): RivalPanelHandle {
  // Inject styles
  if (!document.querySelector('#sg-rival-panel-styles')) {
    const style = document.createElement('style');
    style.id = 'sg-rival-panel-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const panel = document.createElement('div');
  panel.className = 'sg-rival-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'sg-rival-panel__header';

  const sigil = document.createElement('div');
  sigil.className = 'sg-rival-panel__sigil';
  sigil.textContent = '⚔';
  header.appendChild(sigil);

  const title = document.createElement('div');
  title.className = 'sg-rival-panel__title';

  const name = document.createElement('div');
  name.className = 'sg-rival-panel__name';
  title.appendChild(name);

  const subtitle = document.createElement('div');
  subtitle.className = 'sg-rival-panel__subtitle';
  subtitle.textContent = 'Rival Spirit';
  title.appendChild(subtitle);

  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sg-rival-panel__close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => opts.onClose?.());
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // Stats section
  const statsSection = document.createElement('div');
  statsSection.className = 'sg-rival-panel__section';

  const statsTitle = document.createElement('div');
  statsTitle.className = 'sg-rival-panel__section-title';
  statsTitle.textContent = 'Vitals';
  statsSection.appendChild(statsTitle);

  const statsGrid = document.createElement('div');
  statsGrid.className = 'sg-rival-panel__stat-grid';

  // Power
  const powerStat = createStatElement('Power', '--');
  statsGrid.appendChild(powerStat);

  // Followers
  const followerStat = createStatElement('Followers', '--');
  statsGrid.appendChild(followerStat);

  // Settlements
  const settlementStat = createStatElement('Settlements', '--');
  statsGrid.appendChild(settlementStat);

  // Actions taken
  const actionsStat = createStatElement('Actions', '--');
  statsGrid.appendChild(actionsStat);

  statsSection.appendChild(statsGrid);
  panel.appendChild(statsSection);

  // Personality section
  const personalitySection = document.createElement('div');
  personalitySection.className = 'sg-rival-panel__section';

  const personalityTitle = document.createElement('div');
  personalityTitle.className = 'sg-rival-panel__section-title';
  personalityTitle.textContent = 'Personality';
  personalitySection.appendChild(personalityTitle);

  const personalityContainer = document.createElement('div');
  personalityContainer.className = 'sg-rival-panel__personality';
  personalitySection.appendChild(personalityContainer);

  panel.appendChild(personalitySection);

  // Strategy section
  const strategySection = document.createElement('div');
  strategySection.className = 'sg-rival-panel__section';

  const strategyTitle = document.createElement('div');
  strategyTitle.className = 'sg-rival-panel__section-title';
  strategyTitle.textContent = 'Strategy';
  strategySection.appendChild(strategyTitle);

  const strategyBadge = document.createElement('div');
  strategyBadge.className = 'sg-rival-panel__strategy';
  strategySection.appendChild(strategyBadge);

  panel.appendChild(strategySection);

  // Recent actions section
  const actionsSection = document.createElement('div');
  actionsSection.className = 'sg-rival-panel__section';

  const actionsTitle = document.createElement('div');
  actionsTitle.className = 'sg-rival-panel__section-title';
  actionsTitle.textContent = 'Recent Actions';
  actionsSection.appendChild(actionsTitle);

  const actionList = document.createElement('div');
  actionList.className = 'sg-rival-panel__action-list';
  actionsSection.appendChild(actionList);

  panel.appendChild(actionsSection);

  // Competition section
  const competitionSection = document.createElement('div');
  competitionSection.className = 'sg-rival-panel__section';

  const competitionTitle = document.createElement('div');
  competitionTitle.className = 'sg-rival-panel__section-title';
  competitionTitle.textContent = 'Competition';
  competitionSection.appendChild(competitionTitle);

  const competitionDiv = document.createElement('div');
  competitionDiv.className = 'sg-rival-panel__competition';

  const competitionLabel = document.createElement('div');
  competitionLabel.className = 'sg-rival-panel__competition-title';
  competitionLabel.textContent = 'Competing for:';
  competitionDiv.appendChild(competitionLabel);

  const competitionList = document.createElement('div');
  competitionList.className = 'sg-rival-panel__competition-list';
  competitionDiv.appendChild(competitionList);

  competitionSection.appendChild(competitionDiv);
  panel.appendChild(competitionSection);

  container.appendChild(panel);

  function createStatElement(label: string, value: string): HTMLElement {
    const stat = document.createElement('div');
    stat.className = 'sg-rival-panel__stat';

    const labelEl = document.createElement('div');
    labelEl.className = 'sg-rival-panel__stat-label';
    labelEl.textContent = label;
    stat.appendChild(labelEl);

    const valueEl = document.createElement('div');
    valueEl.className = 'sg-rival-panel__stat-value';
    valueEl.textContent = value;
    stat.appendChild(valueEl);

    return stat;
  }

  function updateStat(stat: HTMLElement, value: string): void {
    const valueEl = stat.querySelector('.sg-rival-panel__stat-value') as HTMLElement;
    if (valueEl) valueEl.textContent = value;
  }

  function createTraitBar(label: string, value: number): HTMLElement {
    const trait = document.createElement('div');
    trait.className = 'sg-rival-panel__trait';

    const labelEl = document.createElement('div');
    labelEl.className = 'sg-rival-panel__trait-label';
    labelEl.textContent = label;
    trait.appendChild(labelEl);

    const bar = document.createElement('div');
    bar.className = 'sg-rival-panel__trait-bar';

    const fill = document.createElement('div');
    fill.className = 'sg-rival-panel__trait-fill';
    fill.style.width = `${value * 100}%`;
    bar.appendChild(fill);

    trait.appendChild(bar);
    return trait;
  }

  function update(
    rival: RivalSpirit,
    competingNpcs: NpcSimState[],
  ): void {
    // Update name
    name.textContent = rival.name;
    if (rival.title) {
      subtitle.textContent = rival.title;
    }

    // Update stats
    const statElements = statsGrid.querySelectorAll('.sg-rival-panel__stat');
    if (statElements[0]) updateStat(statElements[0] as HTMLElement, String(rival.power));
    if (statElements[1]) updateStat(statElements[1] as HTMLElement, String(rival.followers.length));
    if (statElements[2]) updateStat(statElements[2] as HTMLElement, String(rival.settlements.length));
    if (statElements[3]) updateStat(statElements[3] as HTMLElement, String(rival.actionHistory?.length || 0));

    // Update personality
    personalityContainer.innerHTML = '';
    const p = rival.personality;
    if (p) {
      personalityContainer.appendChild(createTraitBar('Aggression', p.aggression));
      personalityContainer.appendChild(createTraitBar('Subtlety', p.subtlety));
      personalityContainer.appendChild(createTraitBar('Territoriality', p.territoriality));
      personalityContainer.appendChild(createTraitBar('Assertiveness', p.assertiveness));
      personalityContainer.appendChild(createTraitBar('Jealousy', p.jealousy));
    }

    // Update strategy
    strategyBadge.textContent = getStrategyLabel(rival.strategy);

    // Update recent actions
    actionList.innerHTML = '';
    const recentActions = rival.actionHistory?.slice(-5).reverse() || [];
    if (recentActions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sg-rival-panel__empty';
      empty.textContent = 'No actions yet';
      actionList.appendChild(empty);
    } else {
      for (const action of recentActions) {
        const actionEl = document.createElement('div');
        actionEl.className = 'sg-rival-panel__action';

        const typeBadge = document.createElement('div');
        typeBadge.className = 'sg-rival-panel__action-type';
        typeBadge.textContent = getActionLabel(action.type);
        actionEl.appendChild(typeBadge);

        const target = document.createElement('div');
        target.className = 'sg-rival-panel__action-target';
        target.textContent = action.targetNpcId || action.targetSettlementId || action.targetSpiritId || 'unknown';
        if (action.targetNpcId) {
          target.style.cursor = 'pointer';
          target.addEventListener('click', () => {
            if (action.targetNpcId) opts.onTargetNpc?.(action.targetNpcId);
          });
        }
        actionEl.appendChild(target);

        const cost = document.createElement('div');
        cost.className = 'sg-rival-panel__action-cost';
        cost.textContent = `${action.powerCost || 0}p`;
        actionEl.appendChild(cost);

        actionList.appendChild(actionEl);
      }
    }

    // Update competition
    competitionList.innerHTML = '';
    if (competingNpcs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sg-rival-panel__competition-item';
      empty.textContent = 'No direct competition';
      competitionList.appendChild(empty);
    } else {
      for (const npc of competingNpcs.slice(0, 5)) {
        const item = document.createElement('div');
        item.className = 'sg-rival-panel__competition-item';
        item.textContent = `${npc.name} (${npc.role})`;
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
          opts.onTargetNpc?.(npc.npcId);
        });
        competitionList.appendChild(item);
      }
    }
  }

  function show() {
    panel.style.display = 'block';
  }
  
  function hide() {
    panel.style.display = 'none';
  }
  
  function isVisible(): boolean {
    return panel.style.display !== 'none';
  }
  
  return {
    element: panel,
    update,
    show,
    hide,
    isVisible,
    destroy() {
      panel.remove();
    },
  };
}


