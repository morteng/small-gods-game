import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLLMSettings } from '@/ui/llm-settings-new';
import { VERIFIED_CHAT_MODELS, clearCatalogCache } from '@/llm/openrouter-catalog';

beforeEach(() => {
  localStorage.clear();
  clearCatalogCache();
  // The picker fetches the live catalog; keep tests offline so it falls back to
  // the verified list (and never hits the network).
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});
afterEach(() => { vi.unstubAllGlobals(); clearCatalogCache(); });

function selectProvider(el: HTMLElement, value: string) {
  const sel = el.querySelector('select') as HTMLSelectElement;
  sel.value = value;
  sel.dispatchEvent(new Event('change'));
}

describe('createLLMSettings', () => {
  it('fires onSave with the chosen OpenRouter config when Save is clicked', () => {
    const onSave = vi.fn();
    const handle = createLLMSettings({ onSave });
    document.body.appendChild(handle.element);

    selectProvider(handle.element, 'openrouter');
    const key = handle.element.querySelector('input[type="password"]') as HTMLInputElement;
    key.value = 'sk-or-xyz';

    const saveBtn = [...handle.element.querySelectorAll('button')]
      .find(b => b.textContent === 'Save') as HTMLButtonElement;
    saveBtn.click();

    expect(onSave).toHaveBeenCalledTimes(1);
    const cfg = onSave.mock.calls[0][0];
    expect(cfg.type).toBe('openrouter');
    expect(cfg.openrouterApiKey).toBe('sk-or-xyz');
    expect(cfg.openrouterModelCapable).toBeTruthy();
    handle.destroy();
  });

  it('persists openrouterModelCapable to localStorage on Save', () => {
    const handle = createLLMSettings();
    document.body.appendChild(handle.element);
    selectProvider(handle.element, 'openrouter');
    (handle.element.querySelector('input[type="password"]') as HTMLInputElement).value = 'sk-or-1';
    ([...handle.element.querySelectorAll('button')].find(b => b.textContent === 'Save') as HTMLButtonElement).click();
    const saved = JSON.parse(localStorage.getItem('small-gods-llm-provider')!);
    expect(saved.openrouterModelCapable).toBeTruthy();
    handle.destroy();
  });
});

describe('createLLMSettings — model picker + advanced', () => {
  it('opens the model picker and saves the chosen model', () => {
    const onSave = vi.fn();
    const handle = createLLMSettings({ onSave });
    document.body.appendChild(handle.element);
    selectProvider(handle.element, 'openrouter');
    (handle.element.querySelector('input[type="password"]') as HTMLInputElement).value = 'sk-or-2';

    // Open the picker via the Model field button.
    const modelBtn = handle.element.querySelector('#sg-llm-model-row .sg-model-field') as HTMLButtonElement;
    modelBtn.click();

    // Offline → verified fallback rows render: AUTO_MODEL first, then verified models.
    const rows = handle.element.querySelectorAll('.sg-mp__row');
    expect(rows.length).toBe(VERIFIED_CHAT_MODELS.length + 1); // +1 for AUTO_MODEL

    (rows[2] as HTMLElement).click(); // select the 2nd verified model (index 0 = AUTO, 1 = first verified, 2 = second verified)
    (handle.element.querySelector('.sg-mp__select') as HTMLButtonElement).click(); // "Use this model"

    ([...handle.element.querySelectorAll('button')].find(b => b.textContent === 'Save') as HTMLButtonElement).click();
    expect(onSave.mock.calls[0][0].openrouterModel).toBe(VERIFIED_CHAT_MODELS[1].id);
    handle.destroy();
  });

  it('renders max-tokens and temperature inside a closed Advanced disclosure', () => {
    const handle = createLLMSettings();
    document.body.appendChild(handle.element);
    const adv = handle.element.querySelector('details.sg-advanced') as HTMLDetailsElement;
    expect(adv).toBeTruthy();
    expect(adv.open).toBe(false);
    expect(adv.querySelector('input[type="number"]')).toBeTruthy();
    handle.destroy();
  });
});

describe('createLLMSettings — blank key guard', () => {
  it('does not save or fire onSave when openrouter is chosen with a blank key', () => {
    const onSave = vi.fn();
    const handle = createLLMSettings({ onSave });
    document.body.appendChild(handle.element);
    selectProvider(handle.element, 'openrouter');
    // leave key blank
    ([...handle.element.querySelectorAll('button')].find(b => b.textContent === 'Save') as HTMLButtonElement).click();
    expect(onSave).not.toHaveBeenCalled();
    expect(localStorage.getItem('small-gods-llm-provider')).toBeNull();
    handle.destroy();
  });
});
