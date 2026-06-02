import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWelcomeModal, ONBOARDED_KEY } from '@/ui/welcome-modal';

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

function getBtn(root: HTMLElement, label: string) {
  return [...root.querySelectorAll('button')].find(b => b.textContent === label) as HTMLButtonElement;
}

describe('welcome modal', () => {
  it('renders a key field, a model select, and two buttons', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    createWelcomeModal(c, { onComplete: () => {} });
    expect(c.querySelector('input[type="password"]')).toBeTruthy();
    expect(c.querySelector('select')).toBeTruthy();
    expect(getBtn(c, 'Begin')).toBeTruthy();
    expect(getBtn(c, 'Skip — no AI')).toBeTruthy();
  });

  it('Skip persists mock + onboarded flag and calls onComplete', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    const onComplete = vi.fn();
    createWelcomeModal(c, { onComplete });
    getBtn(c, 'Skip — no AI').click();
    expect(JSON.parse(localStorage.getItem('small-gods-llm-provider')!).type).toBe('mock');
    expect(localStorage.getItem(ONBOARDED_KEY)).toBe('true');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].type).toBe('mock');
  });

  it('Begin with a key persists openrouter + the key and calls onComplete', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    const onComplete = vi.fn();
    createWelcomeModal(c, { onComplete });
    (c.querySelector('input[type="password"]') as HTMLInputElement).value = 'sk-or-begin';
    getBtn(c, 'Begin').click();
    const saved = JSON.parse(localStorage.getItem('small-gods-llm-provider')!);
    expect(saved.type).toBe('openrouter');
    expect(saved.openrouterApiKey).toBe('sk-or-begin');
    expect(localStorage.getItem(ONBOARDED_KEY)).toBe('true');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('Begin with a blank key does not save or complete', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    const onComplete = vi.fn();
    createWelcomeModal(c, { onComplete });
    getBtn(c, 'Begin').click();
    expect(localStorage.getItem('small-gods-llm-provider')).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
