import { saveProviderConfig, type ProviderConfig } from '@/llm/provider-factory';

export const ONBOARDED_KEY = 'small-gods-llm-onboarded';

const FAST_MODELS = [
  { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite (recommended)' },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash (cheapest)' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
];
const DEFAULT_CAPABLE = 'anthropic/claude-sonnet-4.6';

export interface WelcomeModalDeps {
  onComplete: (config: ProviderConfig) => void;
}

export interface WelcomeModalHandle {
  destroy(): void;
}

export function createWelcomeModal(container: HTMLElement, deps: WelcomeModalDeps): WelcomeModalHandle {
  const overlay = document.createElement('div');
  overlay.className = 'sg-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'sg-modal';
  overlay.appendChild(modal);

  const title = document.createElement('h2');
  title.className = 'sg-modal__title';
  title.textContent = 'Welcome, small god';
  modal.appendChild(title);

  const body = document.createElement('p');
  body.className = 'sg-modal__body';
  body.textContent = 'Add an OpenRouter key to bring your world to life with living narration — or skip and play with placeholder text.';
  modal.appendChild(body);

  const fields = document.createElement('div');
  fields.className = 'sg-modal__fields';
  modal.appendChild(fields);

  // Key field
  const keyField = document.createElement('div');
  keyField.className = 'sg-field';
  const keyLabel = document.createElement('div');
  keyLabel.className = 'sg-field__label';
  keyLabel.textContent = 'OpenRouter API key';
  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.placeholder = 'sk-or-...';
  keyInput.className = 'sg-input';
  const getKey = document.createElement('a');
  getKey.className = 'sg-link';
  getKey.textContent = 'Get a key ↗';
  getKey.href = 'https://openrouter.ai/keys';
  getKey.target = '_blank';
  getKey.rel = 'noopener noreferrer';
  keyInput.addEventListener('input', () => { keyInput.style.borderColor = ''; });
  keyField.append(keyLabel, keyInput, getKey);
  fields.appendChild(keyField);

  // Model field
  const modelField = document.createElement('div');
  modelField.className = 'sg-field';
  const modelLabel = document.createElement('div');
  modelLabel.className = 'sg-field__label';
  modelLabel.textContent = 'Model';
  const modelSelect = document.createElement('select');
  modelSelect.className = 'sg-select';
  for (const m of FAST_MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    modelSelect.appendChild(opt);
  }
  modelField.append(modelLabel, modelSelect);
  fields.appendChild(modelField);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'sg-modal__actions';
  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'sg-btn sg-btn--ghost';
  skipBtn.textContent = 'Skip — no AI';
  const beginBtn = document.createElement('button');
  beginBtn.type = 'button';
  beginBtn.className = 'sg-btn sg-btn--primary';
  beginBtn.textContent = 'Begin';
  actions.append(skipBtn, beginBtn);
  modal.appendChild(actions);

  function finish(config: ProviderConfig): void {
    saveProviderConfig(config);
    localStorage.setItem(ONBOARDED_KEY, 'true');
    deps.onComplete(config);
    destroy();
  }

  skipBtn.addEventListener('click', () => finish({ type: 'mock' }));

  beginBtn.addEventListener('click', () => {
    const key = keyInput.value.trim();
    if (!key) {
      keyInput.style.borderColor = 'var(--danger)';
      keyInput.focus();
      return;
    }
    finish({
      type: 'openrouter',
      openrouterApiKey: key,
      openrouterModel: modelSelect.value,
      openrouterModelCapable: DEFAULT_CAPABLE,
      maxTokens: 200,
      temperature: 0.7,
    });
  });

  function destroy(): void {
    overlay.remove();
  }

  container.appendChild(overlay);
  return { destroy };
}
