/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { mountPastVeil } from '@/ui/chrome';

// L6 (legacy chrome retirement): `mountChrome`/`ChromeHandle` (the four DOM
// anchor regions) are gone — their only consumer, the DOM time chip, is
// deleted too (the WebGPU HUD's transport cluster is the live clock), and
// nothing else ever mounted into `anchorTopLeft`/`anchorTopRight`/
// `anchorBottomLeft`/`anchorBottomRight`. `mountPastVeil` is unrelated
// (the time-scrub dim) and stays.
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
