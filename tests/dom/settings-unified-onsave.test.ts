import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSettingsPanel } from '@/ui/settings-unified';

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

describe('settings-unified forwards LLM save', () => {
  it('calls onLLMConfigChange when the LLM tab saves', () => {
    const onLLMConfigChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = createSettingsPanel(container, { onLLMConfigChange });
    panel.show();

    const sel = container.querySelector('.sg-llm-settings select') as HTMLSelectElement;
    sel.value = 'openrouter';
    sel.dispatchEvent(new Event('change'));
    (container.querySelector('.sg-llm-settings input[type="password"]') as HTMLInputElement).value = 'sk-or-z';
    ([...container.querySelectorAll('.sg-llm-settings button')]
      .find(b => b.textContent === 'Save') as HTMLButtonElement).click();

    expect(onLLMConfigChange).toHaveBeenCalledTimes(1);
    expect(onLLMConfigChange.mock.calls[0][0].type).toBe('openrouter');
    panel.destroy();
  });
});
