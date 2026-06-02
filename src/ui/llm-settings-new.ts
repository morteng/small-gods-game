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
  { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite (Recommended)' },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash (cheapest)' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
];

const OPENROUTER_CAPABLE_MODELS = [
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6 (Recommended)' },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro (cheap)' },
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
  providerRow.style.display = 'flex';
  providerRow.style.flexDirection = 'column';
  providerRow.style.gap = '4px';

  const providerLabel = document.createElement('div');
  providerLabel.textContent = 'Provider';
  providerLabel.style.fontSize = '12px';
  providerLabel.style.color = 'var(--ink-2)';
  providerRow.appendChild(providerLabel);

  const providerSelect = document.createElement('select');
  providerSelect.style.cssText = `
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    padding: 6px 8px;
    font: 13px var(--f-mono);
    color: var(--ink);
    cursor: pointer;
  `;

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

  // ─── Model Select (for OpenRouter) ───────────────────
  const modelRow = document.createElement('div');
  modelRow.id = 'sg-llm-model-row';
  modelRow.style.display = 'flex';
  modelRow.style.flexDirection = 'column';
  modelRow.style.gap = '4px';

  const modelLabel = document.createElement('div');
  modelLabel.textContent = 'Model';
  modelLabel.style.fontSize = '12px';
  modelLabel.style.color = 'var(--ink-2)';
  modelRow.appendChild(modelLabel);

  const modelSelect = document.createElement('select');
  modelSelect.id = 'sg-llm-model-select';
  modelSelect.style.cssText = `
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    padding: 6px 8px;
    font: 13px var(--f-mono);
    color: var(--ink);
    cursor: pointer;
  `;

  for (const m of OPENROUTER_MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    if (m.id === saved.openrouterModel) opt.selected = true;
    modelSelect.appendChild(opt);
  }
  modelRow.appendChild(modelSelect);
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

  // ─── API Key Input ────────────────────────────────────
  const keyRow = document.createElement('div');
  keyRow.id = 'sg-llm-key-row';
  keyRow.style.display = 'flex';
  keyRow.style.flexDirection = 'column';
  keyRow.style.gap = '4px';

  const keyLabel = document.createElement('div');
  keyLabel.textContent = 'API Key';
  keyLabel.style.fontSize = '12px';
  keyLabel.style.color = 'var(--ink-2)';
  keyRow.appendChild(keyLabel);

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.placeholder = provider === 'openai' ? 'sk-...' : 'sk-or-...';
  keyInput.value = saved.openrouterApiKey || saved.openaiApiKey || '';
  keyInput.style.cssText = `
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    padding: 6px 8px;
    font: 13px var(--f-mono);
    color: var(--ink);
  `;
  keyRow.appendChild(keyInput);
  container.appendChild(keyRow);

  // ─── Max Tokens ──────────────────────────────────────
  const tokensRow = document.createElement('div');
  tokensRow.style.display = 'flex';
  tokensRow.style.flexDirection = 'column';
  tokensRow.style.gap = '4px';

  const tokensLabel = document.createElement('div');
  tokensLabel.textContent = 'Max Tokens';
  tokensLabel.style.fontSize = '12px';
  tokensLabel.style.color = 'var(--ink-2)';
  tokensRow.appendChild(tokensLabel);

  const tokensInput = document.createElement('input');
  tokensInput.type = 'number';
  tokensInput.value = String(saved.maxTokens || 200);
  tokensInput.min = '50';
  tokensInput.max = '4000';
  tokensInput.style.cssText = `
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    padding: 6px 8px;
    font: 13px var(--f-mono);
    color: var(--ink);
  `;
  tokensRow.appendChild(tokensInput);
  container.appendChild(tokensRow);

  // ─── Temperature ──────────────────────────────────────
  const tempRow = document.createElement('div');
  tempRow.style.display = 'flex';
  tempRow.style.flexDirection = 'column';
  tempRow.style.gap = '4px';

  const tempLabel = document.createElement('div');
  tempLabel.textContent = 'Temperature (0-2)';
  tempLabel.style.fontSize = '12px';
  tempLabel.style.color = 'var(--ink-2)';
  tempRow.appendChild(tempLabel);

  const tempInput = document.createElement('input');
  tempInput.type = 'number';
  tempInput.value = String(saved.temperature ?? 0.7);
  tempInput.min = '0';
  tempInput.max = '2';
  tempInput.step = '0.1';
  tempInput.style.cssText = `
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    padding: 6px 8px;
    font: 13px var(--f-mono);
    color: var(--ink);
  `;
  tempRow.appendChild(tempInput);
  container.appendChild(tempRow);

  // ─── Status ───────────────────────────────────────────
  const status = document.createElement('div');
  status.style.cssText = `
    font-size: 11px;
    padding: 6px 8px;
    border-radius: var(--r-2);
    font-family: var(--f-mono);
    display: none;
  `;
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

  providerSelect.addEventListener('change', updateVisibility);
  updateVisibility();

  // ─── Save Button ──────────────────────────────────────
  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  actions.style.paddingTop = '12px';
  actions.style.borderTop = '1px solid var(--line)';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = `
    background: var(--you);
    color: white;
    border: none;
    border-radius: var(--r-2);
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  `;
  saveBtn.addEventListener('click', () => {
    const type = providerSelect.value as ProviderType;
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
      config.openrouterModel = modelSelect.value;
      config.openrouterModelCapable = capableSelect.value;
    }

    saveProviderConfig(config as any);
    opts.onSave?.(config as unknown as ProviderConfig);
    status.textContent = 'Settings saved!';
    status.style.cssText += `
      display: block;
      background: oklch(0.55 0.13 85 / 0.15);
      color: var(--faith);
    `;
  });
  actions.appendChild(saveBtn);

  const testBtn = document.createElement('button');
  testBtn.textContent = 'Test';
  testBtn.style.cssText = `
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    padding: 6px 12px;
    font-size: 13px;
    color: var(--ink-2);
    cursor: pointer;
  `;
  testBtn.addEventListener('click', async () => {
    const type = providerSelect.value as ProviderType;
    if (type === 'mock') {
      status.textContent = 'Mock provider active — no API key needed.';
      status.style.cssText += `
        display: block;
        background: oklch(0.55 0.09 225 / 0.12);
        color: var(--time);
      `;
      return;
    }

    status.textContent = 'Testing...';
    status.style.cssText += `
      display: block;
      background: oklch(0.55 0.09 225 / 0.12);
      color: var(--time);
    `;

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
          model: type === 'openai' ? 'gpt-3.5-turbo' : modelSelect.value,
          messages: [{ role: 'user', content: 'Say "test"' }],
          max_tokens: 10,
        }),
      });

      if (resp.ok) {
        status.textContent = 'Connection successful!';
        status.style.cssText += `
          display: block;
          background: oklch(0.55 0.13 85 / 0.15);
          color: var(--faith);
        `;
      } else {
        const err = await resp.text();
        status.textContent = `Error: ${resp.status} ${err.substring(0, 100)}`;
        status.style.cssText += `
          display: block;
          background: oklch(0.52 0.16 30 / 0.15);
          color: var(--danger);
        `;
      }
    } catch (err) {
      status.textContent = `Error: ${(err as Error).message}`;
      status.style.cssText += `
        display: block;
        background: oklch(0.52 0.16 30 / 0.15);
        color: var(--danger);
      `;
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
