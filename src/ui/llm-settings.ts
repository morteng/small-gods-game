/**
 * LLM Settings Panel — configure LLM provider, API keys, and parameters.
 */

export interface LLMSettingsHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  destroy(): void;
}

const STYLE = `
.sg-llm-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.55); z-index: 20;
  display: flex; align-items: center; justify-content: center;
  font: 13px -apple-system, system-ui, sans-serif; color: #e6e6ea;
  pointer-events: auto;
}
.sg-llm-modal {
  width: 400px; max-width: calc(100vw - 32px);
  background: #181820; border: 1px solid #2b2b36; border-radius: 8px;
  padding: 20px 22px; box-shadow: 0 16px 48px rgba(0,0,0,0.6);
  display: flex; flex-direction: column; gap: 14px;
}
.sg-llm-head { display: flex; justify-content: space-between; align-items: baseline; }
.sg-llm-title { font-size: 15px; font-weight: 600; }
.sg-llm-close { all: unset; cursor: pointer; padding: 2px 8px;
  color: rgba(255,255,255,0.55); font-size: 18px; line-height: 1;
  border-radius: 4px; }
.sg-llm-close:hover { background: rgba(255,255,255,0.08); color: #fff; }
.sg-llm-row { display: flex; flex-direction: column; gap: 6px; }
.sg-llm-label { font-size: 11px; color: #9ea0aa; letter-spacing: 0.04em;
  text-transform: uppercase; }
.sg-llm-input { all: unset; background: #0e0e12; border: 1px solid #2b2b36;
  border-radius: 4px; padding: 8px 10px; font: 12px ui-monospace,monospace;
  color: #e6e6ea; }
.sg-llm-input:focus { border-color: #4a4a5a; }
.sg-llm-select { all: unset; background: #0e0e12; border: 1px solid #2b2b36;
  border-radius: 4px; padding: 6px 8px; font: 12px ui-monospace,monospace;
  color: #e6e6ea; cursor: pointer; }
.sg-llm-btn { all: unset; cursor: pointer; padding: 7px 14px; border-radius: 4px;
  font-size: 12px; font-weight: 500; }
.sg-llm-btn.primary { background: #FFD54F; color: #1a1a1f; }
.sg-llm-btn.primary:hover { background: #FFE082; }
.sg-llm-btn.ghost { background: rgba(255,255,255,0.06); color: #e6e6ea; }
.sg-llm-btn.ghost:hover { background: rgba(255,255,255,0.12); }
.sg-llm-status { font-size: 11.5px; padding: 8px 10px; border-radius: 4px;
  font-family: ui-monospace,monospace; display: none; }
.sg-llm-status.ok   { background: rgba(74,222,128,0.10); color: #4ade80; display: block; }
.sg-llm-status.bad  { background: rgba(239,68,68,0.10);  color: #ef4444; display: block; }
.sg-llm-status.info { background: rgba(159,216,255,0.08); color: #9fd8ff; display: block; }
.sg-llm-divider { height: 1px; background: #2b2b36; margin: 4px 0; }
.sg-llm-section { display: none; }
.sg-llm-section.visible { display: flex; flex-direction: column; gap: 10px; }
`;

export function createLLMSettingsPanel(container: HTMLElement): LLMSettingsHandle {
  // Inject styles
  if (!document.querySelector('#sg-llm-styles')) {
    const style = document.createElement('style');
    style.id = 'sg-llm-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'sg-llm-overlay';
  overlay.style.display = 'none';

  const modal = document.createElement('div');
  modal.className = 'sg-llm-modal';

  // Header
  const head = document.createElement('div');
  head.className = 'sg-llm-head';
  const title = document.createElement('div');
  title.className = 'sg-llm-title';
  title.textContent = 'LLM Configuration';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'sg-llm-close';
  closeBtn.textContent = '×';
  head.appendChild(title);
  head.appendChild(closeBtn);
  modal.appendChild(head);

  // Provider select
  const providerRow = document.createElement('div');
  providerRow.className = 'sg-llm-row';
  const providerLabel = document.createElement('div');
  providerLabel.className = 'sg-llm-label';
  providerLabel.textContent = 'Provider';
  const providerSelect = document.createElement('select');
  providerSelect.className = 'sg-llm-select';
  for (const opt of ['mock', 'openai', 'anthropic']) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
    providerSelect.appendChild(o);
  }
  providerRow.appendChild(providerLabel);
  providerRow.appendChild(providerSelect);
  modal.appendChild(providerRow);

  // OpenAI section
  const openaiSection = document.createElement('div');
  openaiSection.className = 'sg-llm-section';
  
  const apiKeyRow = document.createElement('div');
  apiKeyRow.className = 'sg-llm-row';
  const apiKeyLabel = document.createElement('div');
  apiKeyLabel.className = 'sg-llm-label';
  apiKeyLabel.textContent = 'OpenAI API Key';
  const apiKeyInput = document.createElement('input');
  apiKeyInput.className = 'sg-llm-input';
  apiKeyInput.type = 'password';
  apiKeyInput.placeholder = 'sk-...';
  apiKeyRow.appendChild(apiKeyLabel);
  apiKeyRow.appendChild(apiKeyInput);
  openaiSection.appendChild(apiKeyRow);

  const modelRow = document.createElement('div');
  modelRow.className = 'sg-llm-row';
  const modelLabel = document.createElement('div');
  modelLabel.className = 'sg-llm-label';
  modelLabel.textContent = 'Model';
  const modelInput = document.createElement('input');
  modelInput.className = 'sg-llm-input';
  modelInput.placeholder = 'gpt-3.5-turbo (default)';
  modelRow.appendChild(modelLabel);
  modelRow.appendChild(modelInput);
  openaiSection.appendChild(modelRow);

  modal.appendChild(openaiSection);

  // Settings section
  modal.appendChild(document.createElement('div')).className = 'sg-llm-divider';

  const maxTokensRow = document.createElement('div');
  maxTokensRow.className = 'sg-llm-row';
  const maxTokensLabel = document.createElement('div');
  maxTokensLabel.className = 'sg-llm-label';
  maxTokensLabel.textContent = 'Max Tokens';
  const maxTokensInput = document.createElement('input');
  maxTokensInput.className = 'sg-llm-input';
  maxTokensInput.type = 'number';
  maxTokensInput.value = '200';
  maxTokensInput.min = '50';
  maxTokensInput.max = '1000';
  maxTokensRow.appendChild(maxTokensLabel);
  maxTokensRow.appendChild(maxTokensInput);
  modal.appendChild(maxTokensRow);

  const tempRow = document.createElement('div');
  tempRow.className = 'sg-llm-row';
  const tempLabel = document.createElement('div');
  tempLabel.className = 'sg-llm-label';
  tempLabel.textContent = 'Temperature (0-2)';
  const tempInput = document.createElement('input');
  tempInput.className = 'sg-llm-input';
  tempInput.type = 'number';
  tempInput.value = '0.7';
  tempInput.min = '0';
  tempInput.max = '2';
  tempInput.step = '0.1';
  tempRow.appendChild(tempLabel);
  tempRow.appendChild(tempInput);
  modal.appendChild(tempRow);

  // Status
  const status = document.createElement('div');
  status.className = 'sg-llm-status';
  modal.appendChild(status);

  // Actions
  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'sg-llm-btn primary';
  saveBtn.textContent = 'Save';
  const testBtn = document.createElement('button');
  testBtn.className = 'sg-llm-btn ghost';
  testBtn.textContent = 'Test Connection';
  actions.appendChild(saveBtn);
  actions.appendChild(testBtn);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  container.appendChild(overlay);

  // Load saved config
  const loadConfig = () => {
    try {
      const raw = localStorage.getItem('small-gods-llm-config');
      if (raw) {
        const cfg = JSON.parse(raw);
        providerSelect.value = cfg.provider || 'mock';
        if (cfg.openai) {
          apiKeyInput.value = cfg.openai.apiKey || '';
          modelInput.value = cfg.openai.model || '';
        }
        maxTokensInput.value = cfg.maxTokens || 200;
        tempInput.value = cfg.temperature || 0.7;
      }
    } catch {
      // ignore
    }
    updateSections();
  };

  const saveConfig = () => {
    const cfg: Record<string, unknown> = {
      provider: providerSelect.value,
      maxTokens: parseInt(maxTokensInput.value) || 200,
      temperature: parseFloat(tempInput.value) || 0.7,
      enabled: true,
    };
    if (providerSelect.value === 'openai') {
      cfg.openai = {
        apiKey: apiKeyInput.value,
        model: modelInput.value || undefined,
      };
    }
    localStorage.setItem('small-gods-llm-config', JSON.stringify(cfg));
    status.className = 'sg-llm-status ok';
    status.textContent = 'Settings saved!';
  };

  const testConnection = async () => {
    status.className = 'sg-llm-status info';
    status.textContent = 'Testing...';
    
    // Simple test - just check if key is present for non-mock
    if (providerSelect.value === 'openai' && !apiKeyInput.value) {
      status.className = 'sg-llm-status bad';
      status.textContent = 'Please enter an API key first.';
      return;
    }
    
    // Mock always works
    if (providerSelect.value === 'mock') {
      status.className = 'sg-llm-status ok';
      status.textContent = 'Mock provider active — no API key needed.';
      return;
    }

    status.className = 'sg-llm-status ok';
    status.textContent = 'Configuration saved. Test with real LLM call during gameplay.';
  };

  const updateSections = () => {
    openaiSection.classList.toggle('visible', providerSelect.value === 'openai');
  };

  // Event listeners
  closeBtn.addEventListener('click', () => hide());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });
  providerSelect.addEventListener('change', updateSections);
  saveBtn.addEventListener('click', saveConfig);
  testBtn.addEventListener('click', testConnection);

  // Load initial config
  loadConfig();

  function show(): void {
    overlay.style.display = 'flex';
  }

  function hide(): void {
    overlay.style.display = 'none';
  }

  const handle: LLMSettingsHandle = {
    show,
    hide,
    toggle(): void {
      if (overlay.style.display === 'none') show();
      else hide();
    },
    isVisible(): boolean {
      return overlay.style.display !== 'none';
    },
    destroy(): void {
      overlay.remove();
    },
  };

  return handle;
}
