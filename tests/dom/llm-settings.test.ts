import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLLMSettings } from '@/ui/llm-settings-new';

beforeEach(() => localStorage.clear());

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

describe('createLLMSettings — custom model + advanced', () => {
  it('reveals a custom-model input when "Custom model ID…" is chosen, and saves its value', () => {
    const onSave = vi.fn();
    const handle = createLLMSettings({ onSave });
    document.body.appendChild(handle.element);
    selectProvider(handle.element, 'openrouter');
    (handle.element.querySelector('input[type="password"]') as HTMLInputElement).value = 'sk-or-2';

    const modelSel = handle.element.querySelector('#sg-llm-model-select') as HTMLSelectElement;
    modelSel.value = '__custom__';
    modelSel.dispatchEvent(new Event('change'));

    const custom = handle.element.querySelector('#sg-llm-model-custom') as HTMLInputElement;
    expect(custom.style.display).not.toBe('none');
    custom.value = 'meta-llama/llama-4-scout';

    ([...handle.element.querySelectorAll('button')].find(b => b.textContent === 'Save') as HTMLButtonElement).click();
    expect(onSave.mock.calls[0][0].openrouterModel).toBe('meta-llama/llama-4-scout');
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
