/**
 * Unified Settings Panel — merges PixelLab, LLM, and game settings.
 * Uses tabs to organize different setting categories.
 */

import type { ProviderConfig } from '@/llm/provider-factory';
import { clearApiKey, fetchBalance, saveApiKey, loadApiKey } from '@/services/pixellab';
import { createLLMSettings, type LLMSettingsHandle } from './llm-settings-new';

export interface SettingsOptions {
  onClose?: () => void;
  onLLMConfigChange?: (config: ProviderConfig) => void;
  onGameSettingChange?: (key: string, value: unknown) => void;
}

export interface SettingsHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  updateLLMConfig(config: ProviderConfig): void;
  updateGameSetting(key: string, value: unknown): void;
  destroy(): void;
}

const STYLE = `
.sg-settings-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 13px -apple-system, system-ui, sans-serif;
  color: #e6e6ea;
  pointer-events: auto;
  animation: sg-fade-in 200ms ease-out;
}

@keyframes sg-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.sg-settings-modal {
  width: 520px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--r-4);
  box-shadow: var(--lift-2);
  animation: sg-scale-in 200ms ease-out;
}

@keyframes sg-scale-in {
  from { opacity: 0; transform: scale(0.97) translateY(4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.sg-settings-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: var(--s-4) var(--s-5);
  border-bottom: 1px solid var(--line);
}

.sg-settings-title {
  font-size: var(--t-md);
  font-weight: 600;
  color: var(--ink);
}

.sg-settings-close {
  all: unset;
  cursor: pointer;
  padding: 2px 8px;
  color: var(--ink-3);
  font-size: 18px;
  line-height: 1;
  border-radius: var(--r-2);
}

.sg-settings-close:hover {
  background: var(--paper-2);
  color: var(--ink);
}

.sg-settings-tabs {
  display: flex;
  gap: 2px;
  padding: var(--s-3) var(--s-5) 0;
  border-bottom: 1px solid var(--line);
}

.sg-settings-tab {
  all: unset;
  cursor: pointer;
  padding: var(--s-2) var(--s-3);
  font-size: var(--t-small);
  color: var(--ink-3);
  border-bottom: 2px solid transparent;
  transition: color 120ms ease, border-color 120ms ease;
}

.sg-settings-tab:hover {
  color: var(--ink-2);
}

.sg-settings-tab--active {
  color: var(--you);
  border-bottom-color: var(--you);
}

.sg-settings-content {
  padding: var(--s-4) var(--s-5);
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.sg-settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}
`;

export function createSettingsPanel(
  container: HTMLElement,
  opts: SettingsOptions = {},
): SettingsHandle {
  // Inject styles
  if (!document.querySelector('#sg-settings-styles')) {
    const style = document.createElement('style');
    style.id = 'sg-settings-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'sg-settings-overlay sg-modal-overlay';
  overlay.style.display = 'none';

  const modal = document.createElement('div');
  modal.className = 'sg-settings-modal sg-modal';

  // Header
  const header = document.createElement('div');
  header.className = 'sg-settings-header';

  const title = document.createElement('div');
  title.className = 'sg-settings-title';
  title.textContent = 'Settings';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sg-settings-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    hide();
    opts.onClose?.();
  });
  header.appendChild(closeBtn);

  modal.appendChild(header);

  // Tabs
  const tabs = document.createElement('div');
  tabs.className = 'sg-settings-tabs';

  const tabIds = ['game', 'llm', 'pixellab'] as const;
  const tabLabels = ['Game', 'LLM', 'PixelLab'];
  const tabElements: HTMLButtonElement[] = [];

  function switchTab(tabId: string): void {
    // Update tab buttons
    for (const tabBtn of tabElements) {
      tabBtn.classList.toggle('sg-settings-tab--active', tabBtn.dataset.tab === tabId);
    }

    // Update visible section
    const sections = content.querySelectorAll('[data-tab]');
    for (const section of sections) {
      (section as HTMLElement).style.display =
        (section as HTMLElement).dataset.tab === tabId ? 'flex' : 'none';
    }
  }

  for (let i = 0; i < tabIds.length; i++) {
    const tabBtn = document.createElement('button');
    tabBtn.className = 'sg-settings-tab';
    tabBtn.textContent = tabLabels[i];
    tabBtn.dataset.tab = tabIds[i];
    tabBtn.addEventListener('click', () => switchTab(tabIds[i]));
    tabs.appendChild(tabBtn);
    tabElements.push(tabBtn);
  }

  modal.appendChild(tabs);

  // Content area
  const content = document.createElement('div');
  content.className = 'sg-settings-content';

  // ── Game Tab ─────────────────────────────────
  const gameSection = createGameSettings(opts);
  gameSection.style.display = 'flex';
  gameSection.dataset.tab = 'game';
  content.appendChild(gameSection);

  // ── LLM Tab (uses new settings component) ──────
  const llmTab = document.createElement('div');
  llmTab.style.display = 'none';
  llmTab.dataset.tab = 'llm';

  const llmSettings = createLLMSettings({ onSave: (c) => opts.onLLMConfigChange?.(c) });
  llmTab.appendChild(llmSettings.element);
  content.appendChild(llmTab);

  // ── PixelLab Tab ───────────────────────────────
  const pixellabSection = createPixelLabSettings(opts);
  pixellabSection.style.display = 'none';
  pixellabSection.dataset.tab = 'pixellab';
  content.appendChild(pixellabSection);

  modal.appendChild(content);
  overlay.appendChild(modal);
  container.appendChild(overlay);

  // Show LLM tab by default (for demo)
  tabElements[1]!.classList.add('sg-settings-tab--active');
  llmTab.style.display = 'flex';

  function show(): void {
    overlay.style.display = 'flex';
  }

  function hide(): void {
    overlay.style.display = 'none';
  }

  function toggle(): void {
    if (overlay.style.display === 'none') {
      show();
    } else {
      hide();
    }
  }

  function isVisible(): boolean {
    return overlay.style.display !== 'none';
  }

  // Click outside to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      hide();
      opts.onClose?.();
    }
  });

  return {
    show,
    hide,
    toggle,
    isVisible,
    updateLLMConfig(_config: ProviderConfig) {
      // Update LLM config fields
    },
    updateGameSetting(_key: string, _value: unknown): void {
      // Update game setting
    },
    destroy() {
      overlay.remove();
    },
  };
}

function createGameSettings(opts: SettingsOptions): HTMLElement {
  const section = document.createElement('div');
  section.className = 'sg-settings-section';

  // Labels toggle
  section.appendChild(createToggleRow('Show Labels', 'showLabels', true, opts));

  // POI markers toggle
  section.appendChild(createToggleRow('Show POI Markers', 'showPoiMarkers', true, opts));

  // Debug mode toggle
  section.appendChild(createToggleRow('Debug Mode', 'debug', false, opts));

  // Dev mode toggle
  section.appendChild(createToggleRow('Developer Mode', 'devMode', false, opts));

  return section;
}

function createPixelLabSettings(opts: SettingsOptions): HTMLElement {
  const section = document.createElement('div');
  section.className = 'sg-settings-section';

  // API Key
  const keyRow = document.createElement('div');
  keyRow.className = 'sg-settings-row';

  const keyLabel = document.createElement('div');
  keyLabel.className = 'sg-settings-label';
  keyLabel.textContent = 'PixelLab API Key';
  keyRow.appendChild(keyLabel);

  const keyInput = document.createElement('input');
  keyInput.className = 'sg-settings-input';
  keyInput.type = 'password';
  keyInput.placeholder = 'e.g. 684533a5-f005-…';
  keyRow.appendChild(keyInput);

  // Load saved key
  const saved = loadApiKey();
  if (saved) keyInput.value = saved;

  section.appendChild(keyRow);

  // Status
  const status = document.createElement('div');
  status.className = 'sg-settings-status';
  section.appendChild(status);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'sg-settings-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'sg-settings-btn sg-settings-btn--primary';
  saveBtn.textContent = 'Save & Verify';
  saveBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) {
      status.textContent = 'Please enter a key.';
      status.className = 'sg-settings-status sg-settings-status--visible sg-settings-status--bad';
      return;
    }
    status.textContent = 'Verifying...';
    status.className = 'sg-settings-status sg-settings-status--visible sg-settings-status--info';
    try {
      const bal = await fetchBalance(key);
      saveApiKey(key);
      status.textContent = `Valid! ${bal.generationsRemaining}/${bal.generationsTotal} free gens remaining.`;
      status.className = 'sg-settings-status sg-settings-status--visible sg-settings-status--ok';
    } catch (err) {
      status.textContent = `Invalid: ${(err as Error).message}`;
      status.className = 'sg-settings-status sg-settings-status--visible sg-settings-status--bad';
    }
  });
  actions.appendChild(saveBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'sg-settings-btn sg-settings-btn--ghost';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    keyInput.value = '';
    clearApiKey();
    status.textContent = 'Key cleared.';
    status.className = 'sg-settings-status sg-settings-status--visible sg-settings-status--info';
  });
  actions.appendChild(clearBtn);

  section.appendChild(actions);

  return section;
}

function createToggleRow(
  label: string,
  key: string,
  defaultValue: boolean,
  opts: SettingsOptions,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sg-settings-toggle';

  const checkbox = document.createElement('input');
  checkbox.className = 'sg-settings-checkbox';
  checkbox.type = 'checkbox';
  checkbox.checked = defaultValue;
  checkbox.addEventListener('change', () => {
    opts.onGameSettingChange?.(key, checkbox.checked);
  });

  const labelEl = document.createElement('div');
  labelEl.className = 'sg-settings-toggle-label';
  labelEl.textContent = label;
  labelEl.addEventListener('click', () => {
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change'));
  });

  row.appendChild(checkbox);
  row.appendChild(labelEl);

  return row;
}
