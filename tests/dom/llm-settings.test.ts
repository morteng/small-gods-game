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
