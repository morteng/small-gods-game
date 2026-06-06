/**
 * Simplified LLM Settings — supports Mock, OpenAI, and OpenRouter.
 *
 * Model selection uses the OpenRouter-style {@link openModelPicker} browser:
 * a Verified allowlist for players, the full live catalog for anyone who flips
 * to "All". The two model fields are buttons that open the picker.
 */

import type { ProviderType, ProviderConfig } from '@/llm/provider-factory';
import { saveProviderConfig, loadProviderConfig, getProviderDisplayName } from '@/llm/provider-factory';
import {
  VERIFIED_CHAT_MODELS,
  VERIFIED_CAPABLE_MODELS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CAPABLE_MODEL,
  type CuratedModel,
} from '@/llm/openrouter-catalog';
import { openModelPicker } from './model-picker';

const AUTO_MODEL: CuratedModel = { id: 'openrouter/auto', name: 'Auto (cost/quality router)' };

export interface LLMSettingsHandle {
  element: HTMLElement;
  getConfig(): Record<string, unknown>;
  destroy(): void;
}

/** Human label for a model id: its curated name if known, else the raw id. */
function modelLabel(id: string, verified: readonly CuratedModel[]): string {
  return verified.find(m => m.id === id)?.name ?? id;
}

export function createLLMSettings(
  opts: { onSave?: (config: ProviderConfig) => void } = {},
): LLMSettingsHandle {
  const container = document.createElement('div');
  container.className = 'sg-llm-settings';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '12px';

  const saved = loadProviderConfig();
  const provider: ProviderType = saved.type || 'mock';

  // Mutable selection state, edited via the picker, read on Save.
  let chatModelId = saved.openrouterModel || DEFAULT_CHAT_MODEL;
  let capableModelId = saved.openrouterModelCapable || DEFAULT_CAPABLE_MODEL;
  // Auto-router cost↔quality (0 = most capable, 10 = cheapest); 7 = OpenRouter's default lean-cheap.
  let chatTradeoff = saved.openrouterCostQualityTradeoff ?? 7;
  let capableTradeoff = saved.openrouterCostQualityTradeoffCapable ?? 7;
  let cacheEnabled = saved.cacheEnabled !== false; // default on

  // ─── Provider Select ───────────────────────────────────
  const providerRow = document.createElement('div');
  providerRow.className = 'sg-field';

  const providerLabel = document.createElement('div');
  providerLabel.className = 'sg-field__label';
  providerLabel.textContent = 'Provider';
  providerRow.appendChild(providerLabel);

  const providerSelect = document.createElement('select');
  providerSelect.className = 'sg-select';

  const providers: ProviderType[] = ['mock', 'openai', 'openrouter'];
  for (const p of providers) {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = getProviderDisplayName(p);
    if (p === provider) opt.selected = true;
    providerSelect.appendChild(opt);
  }
  providerRow.appendChild(providerSelect);
  container.appendChild(providerRow);

  // ─── API Key Input ────────────────────────────────────
  const keyRow = document.createElement('div');
  keyRow.id = 'sg-llm-key-row';
  keyRow.className = 'sg-field';

  const keyLabel = document.createElement('div');
  keyLabel.className = 'sg-field__label';
  keyLabel.textContent = 'API Key';
  keyRow.appendChild(keyLabel);

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.className = 'sg-input';
  keyInput.placeholder = provider === 'openai' ? 'sk-...' : 'sk-or-...';
  keyInput.value = saved.openrouterApiKey || saved.openaiApiKey || '';
  keyRow.appendChild(keyInput);
  container.appendChild(keyRow);

  // ─── Model field (button → picker) ────────────────────
  function createModelField(
    id: string,
    labelText: string,
    verified: readonly CuratedModel[],
    getCurrent: () => string,
    onPick: (id: string) => void,
  ): { row: HTMLElement; refresh: () => void } {
    const row = document.createElement('div');
    row.id = id;
    row.className = 'sg-field';

    const label = document.createElement('div');
    label.className = 'sg-field__label';
    label.textContent = labelText;
    row.appendChild(label);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sg-btn sg-model-field';
    btn.style.justifyContent = 'space-between';
    btn.style.width = '100%';

    const nameSpan = document.createElement('span');
    const caret = document.createElement('span');
    caret.textContent = '⌄';
    caret.style.opacity = '0.6';
    btn.append(nameSpan, caret);

    const refresh = (): void => {
      nameSpan.textContent = modelLabel(getCurrent(), verified);
    };
    refresh();

    btn.addEventListener('click', () => {
      const mount = (container.closest('.sg-settings-overlay') as HTMLElement)
        ?? (container.closest('.sg-modal-overlay') as HTMLElement)
        ?? container;
      openModelPicker({
        mount,
        verified,
        current: getCurrent(),
        apiKey: keyInput.value.trim() || undefined,
        title: labelText,
        onPick: (picked) => { onPick(picked); refresh(); },
      });
    });
    row.appendChild(btn);
    return { row, refresh };
  }

  const chatField = createModelField(
    'sg-llm-model-row', 'Model', [AUTO_MODEL, ...VERIFIED_CHAT_MODELS],
    () => chatModelId, (id) => { chatModelId = id; updateAutoRows(); },
  );
  container.appendChild(chatField.row);

  const capableField = createModelField(
    'sg-llm-capable-row', 'Capable model (key moments)', [AUTO_MODEL, ...VERIFIED_CAPABLE_MODELS],
    () => capableModelId, (id) => { capableModelId = id; updateAutoRows(); },
  );
  container.appendChild(capableField.row);

  // ─── Auto-router tradeoff sliders (shown only when a tier uses openrouter/auto) ──
  function createTradeoffRow(
    labelText: string, get: () => number, set: (v: number) => void,
  ): { row: HTMLElement } {
    const row = document.createElement('div');
    row.className = 'sg-field';
    const label = document.createElement('div');
    label.className = 'sg-field__label';
    const valueText = document.createElement('span');
    const setLabel = (v: number) => { valueText.textContent = ` — ${v === 0 ? 'most capable' : v >= 10 ? 'cheapest' : String(v)}`; };
    label.textContent = labelText;
    label.appendChild(valueText);
    row.appendChild(label);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0'; slider.max = '10'; slider.step = '1';
    slider.value = String(get());
    slider.className = 'sg-input';
    setLabel(get());
    slider.addEventListener('input', () => { const v = parseInt(slider.value, 10); set(v); setLabel(v); });
    row.appendChild(slider);
    return { row };
  }

  const chatTradeoffRow = createTradeoffRow('Cost ↔ quality (Model)', () => chatTradeoff, (v) => { chatTradeoff = v; });
  const capableTradeoffRow = createTradeoffRow('Cost ↔ quality (Capable)', () => capableTradeoff, (v) => { capableTradeoff = v; });
  container.appendChild(chatTradeoffRow.row);
  container.appendChild(capableTradeoffRow.row);
  chatTradeoffRow.row.style.display = 'none';
  capableTradeoffRow.row.style.display = 'none';

  function updateAutoRows(): void {
    const showModels = providerSelect.value === 'openrouter';
    chatTradeoffRow.row.style.display = (showModels && chatModelId === AUTO_MODEL.id) ? '' : 'none';
    capableTradeoffRow.row.style.display = (showModels && capableModelId === AUTO_MODEL.id) ? '' : 'none';
  }

  // ─── Max Tokens ──────────────────────────────────────
  const tokensRow = document.createElement('div');
  tokensRow.className = 'sg-field';

  const tokensLabel = document.createElement('div');
  tokensLabel.className = 'sg-field__label';
  tokensLabel.textContent = 'Max Tokens';
  tokensRow.appendChild(tokensLabel);

  const tokensInput = document.createElement('input');
  tokensInput.type = 'number';
  tokensInput.value = String(saved.maxTokens || 200);
  tokensInput.min = '50';
  tokensInput.max = '4000';
  tokensInput.className = 'sg-input';
  tokensRow.appendChild(tokensInput);

  // ─── Temperature ──────────────────────────────────────
  const tempRow = document.createElement('div');
  tempRow.className = 'sg-field';

  const tempLabel = document.createElement('div');
  tempLabel.className = 'sg-field__label';
  tempLabel.textContent = 'Temperature (0-2)';
  tempRow.appendChild(tempLabel);

  const tempInput = document.createElement('input');
  tempInput.type = 'number';
  tempInput.value = String(saved.temperature ?? 0.7);
  tempInput.min = '0';
  tempInput.max = '2';
  tempInput.step = '0.1';
  tempInput.className = 'sg-input';
  tempRow.appendChild(tempInput);

  // ─── Advanced disclosure ──────────────────────────────
  const advanced = document.createElement('details');
  advanced.className = 'sg-advanced';
  const advSummary = document.createElement('summary');
  advSummary.textContent = 'Advanced';
  advanced.appendChild(advSummary);
  advanced.appendChild(tokensRow);
  advanced.appendChild(tempRow);

  const cacheRow = document.createElement('label');
  cacheRow.className = 'sg-field';
  cacheRow.style.flexDirection = 'row';
  cacheRow.style.alignItems = 'center';
  cacheRow.style.gap = '8px';
  const cacheCheckbox = document.createElement('input');
  cacheCheckbox.type = 'checkbox';
  cacheCheckbox.checked = cacheEnabled;
  cacheCheckbox.addEventListener('change', () => { cacheEnabled = cacheCheckbox.checked; });
  const cacheLabel = document.createElement('span');
  cacheLabel.className = 'sg-field__label';
  cacheLabel.textContent = 'Response caching (free repeats of identical requests)';
  cacheRow.append(cacheCheckbox, cacheLabel);
  advanced.appendChild(cacheRow);

  container.appendChild(advanced);

  // ─── Status ───────────────────────────────────────────
  const status = document.createElement('div');
  status.className = 'sg-form-status';
  status.style.display = 'none';
  container.appendChild(status);

  // ─── Toggle visibility based on provider ─────────────
  function updateVisibility(): void {
    const p = providerSelect.value as ProviderType;
    const showKey = p !== 'mock';
    const showModel = p === 'openrouter';

    (keyRow as HTMLElement).style.display = showKey ? '' : 'none';
    chatField.row.style.display = showModel ? '' : 'none';
    capableField.row.style.display = showModel ? '' : 'none';

    keyInput.placeholder = p === 'openai' ? 'sk-...' : 'sk-or-...';
    updateAutoRows();
  }

  providerSelect.addEventListener('change', () => {
    keyInput.style.borderColor = '';
    updateVisibility();
  });
  updateVisibility();

  // ─── Actions ──────────────────────────────────────────
  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  actions.style.paddingTop = '12px';
  actions.style.borderTop = '1px solid var(--line)';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.className = 'sg-btn sg-btn--primary';
  saveBtn.addEventListener('click', () => {
    const type = providerSelect.value as ProviderType;

    if (type !== 'mock' && !keyInput.value.trim()) {
      keyInput.style.borderColor = 'var(--danger)';
      keyInput.focus();
      status.className = 'sg-form-status sg-form-status--err';
      status.textContent = 'An API key is required for this provider.';
      status.style.display = 'block';
      return;
    }

    keyInput.style.borderColor = '';

    const config: Record<string, unknown> = {
      type,
      maxTokens: parseInt(tokensInput.value) || 200,
      temperature: parseFloat(tempInput.value) || 0.7,
    };

    if (type === 'openai') {
      config.openaiApiKey = keyInput.value;
      config.openaiModel = chatModelId;
    } else if (type === 'openrouter') {
      config.openrouterApiKey = keyInput.value;
      config.openrouterModel = chatModelId;
      config.openrouterModelCapable = capableModelId;
      config.openrouterCostQualityTradeoff = chatTradeoff;
      config.openrouterCostQualityTradeoffCapable = capableTradeoff;
      config.cacheEnabled = cacheEnabled;
    }

    saveProviderConfig(config as unknown as ProviderConfig);
    opts.onSave?.(config as unknown as ProviderConfig);
    status.className = 'sg-form-status sg-form-status--ok';
    status.textContent = 'Settings saved!';
    status.style.display = 'block';
  });
  actions.appendChild(saveBtn);

  const testBtn = document.createElement('button');
  testBtn.textContent = 'Test';
  testBtn.className = 'sg-btn sg-btn--ghost';
  testBtn.addEventListener('click', async () => {
    const type = providerSelect.value as ProviderType;
    if (type === 'mock') {
      status.className = 'sg-form-status sg-form-status--info';
      status.textContent = 'Mock provider active — no API key needed.';
      status.style.display = 'block';
      return;
    }

    status.className = 'sg-form-status sg-form-status--info';
    status.textContent = 'Testing...';
    status.style.display = 'block';

    try {
      const apiKey = keyInput.value;
      const url = type === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions';

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: type === 'openai' ? 'gpt-3.5-turbo' : chatModelId,
          messages: [{ role: 'user', content: 'Say "test"' }],
          max_tokens: 10,
        }),
      });

      if (resp.ok) {
        status.className = 'sg-form-status sg-form-status--ok';
        status.textContent = 'Connection successful!';
        status.style.display = 'block';
      } else {
        const err = await resp.text();
        status.className = 'sg-form-status sg-form-status--err';
        status.textContent = `Error: ${resp.status} ${err.substring(0, 100)}`;
        status.style.display = 'block';
      }
    } catch (err) {
      status.className = 'sg-form-status sg-form-status--err';
      status.textContent = `Error: ${(err as Error).message}`;
      status.style.display = 'block';
    }
  });
  actions.appendChild(testBtn);
  container.appendChild(actions);

  return {
    element: container,
    getConfig(): Record<string, unknown> {
      return loadProviderConfig() as unknown as Record<string, unknown>;
    },
    destroy() {
      container.remove();
    },
  };
}
