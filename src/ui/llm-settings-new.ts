/**
 * Simplified LLM Settings — supports Mock, OpenAI, and OpenRouter.
 */

import type { ProviderType, ProviderConfig } from '@/llm/provider-factory';
import { saveProviderConfig, loadProviderConfig, getProviderDisplayName } from '@/llm/provider-factory';

export interface LLMSettingsHandle {
  element: HTMLElement;
  getConfig(): Record<string, unknown>;
  destroy(): void;
}

const OPENROUTER_MODELS = [
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash (Recommended)' },
  { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
];

const OPENROUTER_CAPABLE_MODELS = [
  { id: 'deepseek/deepseek-v4', name: 'DeepSeek V4 (Recommended)' },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro (large context)' },
];

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

  // ─── Model Select (for OpenRouter) ───────────────────
  const modelRow = document.createElement('div');
  modelRow.id = 'sg-llm-model-row';
  modelRow.className = 'sg-field';

  const modelLabel = document.createElement('div');
  modelLabel.className = 'sg-field__label';
  modelLabel.textContent = 'Model';
  modelRow.appendChild(modelLabel);

  const modelSelect = document.createElement('select');
  modelSelect.id = 'sg-llm-model-select';
  modelSelect.className = 'sg-select';

  for (const m of OPENROUTER_MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    if (m.id === saved.openrouterModel) opt.selected = true;
    modelSelect.appendChild(opt);
  }

  const customModelOpt = document.createElement('option');
  customModelOpt.value = '__custom__';
  customModelOpt.textContent = 'Custom model ID…';
  modelSelect.appendChild(customModelOpt);

  modelRow.appendChild(modelSelect);

  const modelCustom = document.createElement('input');
  modelCustom.id = 'sg-llm-model-custom';
  modelCustom.type = 'text';
  modelCustom.placeholder = 'provider/model-id';
  modelCustom.className = 'sg-input';
  modelCustom.style.display = 'none';
  // Pre-fill custom if the saved model isn't in the curated list.
  if (saved.openrouterModel && !OPENROUTER_MODELS.some(m => m.id === saved.openrouterModel)) {
    modelSelect.value = '__custom__';
    modelCustom.value = saved.openrouterModel;
    modelCustom.style.display = '';
  }
  modelSelect.addEventListener('change', () => {
    modelCustom.style.display = modelSelect.value === '__custom__' ? '' : 'none';
  });
  modelRow.appendChild(modelCustom);

  container.appendChild(modelRow);

  // ─── Capable Model Select (for OpenRouter, key moments) ───
  const capableRow = document.createElement('div');
  capableRow.id = 'sg-llm-capable-row';
  capableRow.className = 'sg-field';

  const capableLabel = document.createElement('div');
  capableLabel.className = 'sg-field__label';
  capableLabel.textContent = 'Capable model (key moments)';
  capableRow.appendChild(capableLabel);

  const capableSelect = document.createElement('select');
  capableSelect.id = 'sg-llm-capable-select';
  capableSelect.className = 'sg-select';
  for (const m of OPENROUTER_CAPABLE_MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    if (m.id === saved.openrouterModelCapable) opt.selected = true;
    capableSelect.appendChild(opt);
  }
  capableRow.appendChild(capableSelect);
  container.appendChild(capableRow);

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
    (modelRow as HTMLElement).style.display = showModel ? '' : 'none';
    (capableRow as HTMLElement).style.display = showModel ? '' : 'none';

    keyInput.placeholder = p === 'openai' ? 'sk-...' : 'sk-or-...';
  }

  providerSelect.addEventListener('change', () => {
    // Reset any key error styling on provider change
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

    // Blank-key guard: non-mock providers require an API key
    if (type !== 'mock' && !keyInput.value.trim()) {
      keyInput.style.borderColor = 'var(--danger)';
      keyInput.focus();
      status.className = 'sg-form-status sg-form-status--err';
      status.textContent = 'An API key is required for this provider.';
      status.style.display = 'block';
      return;
    }

    // Reset any previous error styling on the key input
    keyInput.style.borderColor = '';

    const config: Record<string, unknown> = {
      type,
      maxTokens: parseInt(tokensInput.value) || 200,
      temperature: parseFloat(tempInput.value) || 0.7,
    };

    if (type === 'openai') {
      config.openaiApiKey = keyInput.value;
      config.openaiModel = modelSelect.value;
    } else if (type === 'openrouter') {
      config.openrouterApiKey = keyInput.value;
      config.openrouterModel = modelSelect.value === '__custom__'
        ? (modelCustom.value.trim() || OPENROUTER_MODELS[0].id)
        : modelSelect.value;
      config.openrouterModelCapable = capableSelect.value;
    }

    saveProviderConfig(config as any);
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
          model: type === 'openai'
            ? 'gpt-3.5-turbo'
            : (modelSelect.value === '__custom__'
                ? (modelCustom.value.trim() || OPENROUTER_MODELS[0].id)
                : modelSelect.value),
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
      return loadProviderConfig() as any;
    },
    destroy() {
      container.remove();
    },
  };
}
