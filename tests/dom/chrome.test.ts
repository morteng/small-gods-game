/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { mountChrome, mountPastVeil } from '@/ui/chrome';

describe('Chrome scaffold', () => {
  it('creates four anchor regions inside the container', () => {
    const container = document.createElement('div');
    container.style.position = 'relative';
    document.body.appendChild(container);

    const chrome = mountChrome(container);
    expect(container.querySelector('.sg-anchor-top-left')).not.toBeNull();
    expect(container.querySelector('.sg-anchor-top-right')).not.toBeNull();
    expect(container.querySelector('.sg-anchor-bottom-left')).not.toBeNull();
    expect(container.querySelector('.sg-anchor-bottom-right')).not.toBeNull();
    chrome.dispose();
    expect(container.querySelector('.sg-anchor-top-left')).toBeNull();
  });
});

describe('past veil', () => {
  it('toggles opacity on setActive', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const v = mountPastVeil(c);
    const el = c.querySelector('.sg-past-veil') as HTMLElement;
    expect(el.style.opacity).toBe('0');
    v.setActive(true);
    expect(el.style.opacity).toBe('1');
    v.setActive(false);
    expect(el.style.opacity).toBe('0');
    v.dispose();
  });
});
