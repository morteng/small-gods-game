/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { createLoadingScreen } from '@/ui/loading-screen';

describe('loading-screen', () => {
  let container: HTMLElement;
  afterEach(() => { container?.remove(); });

  it('mounts a dark overlay with a title, progress fill, and label', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const ls = createLoadingScreen(container);
    expect(container.querySelector('.sg-loading')).not.toBeNull();
    expect(container.querySelector('.sg-loading__title')?.textContent).toBe('Small Gods');
    expect(container.querySelector('.sg-loading__fill')).not.toBeNull();
    ls.destroy();
    expect(container.querySelector('.sg-loading')).toBeNull();
  });

  it('setProgress clamps to [0,1] and updates fill width + label', () => {
    container = document.createElement('div');
    const ls = createLoadingScreen(container);
    const fill = container.querySelector('.sg-loading__fill') as HTMLElement;
    const label = container.querySelector('.sg-loading__label') as HTMLElement;

    ls.setProgress(0.5, 'Generating…');
    expect(fill.style.width).toBe('50%');
    expect(label.textContent).toBe('Generating…');

    ls.setProgress(2);            // over-range clamps to 100%
    expect(fill.style.width).toBe('100%');
    ls.setProgress(-1);           // under-range clamps to 0%
    expect(fill.style.width).toBe('0%');

    ls.destroy();
  });

  it('hide() adds the hidden class so it fades out', () => {
    container = document.createElement('div');
    const ls = createLoadingScreen(container);
    const el = container.querySelector('.sg-loading') as HTMLElement;
    expect(el.classList.contains('sg-loading--hidden')).toBe(false);
    ls.hide();
    expect(el.classList.contains('sg-loading--hidden')).toBe(true);
    ls.destroy();
  });

  it('setChronicle shows the most recent annal; empty hides the block', () => {
    container = document.createElement('div');
    const ls = createLoadingScreen(container);
    const block = container.querySelector('.sg-loading__chronicle') as HTMLElement;
    expect(block.classList.contains('sg-loading__chronicle--visible')).toBe(false);

    ls.setChronicle(['In this year there was a drought.', 'In this year the drought broke, and two were born.']);
    expect(block.classList.contains('sg-loading__chronicle--visible')).toBe(true);
    // Starts on the MOST RECENT entry.
    expect(block.textContent).toContain('the drought broke');
    expect(block.textContent).toContain('from the chronicle of this world');

    ls.setChronicle([]);
    expect(block.classList.contains('sg-loading__chronicle--visible')).toBe(false);
    ls.destroy();
  });

  it('setChronicle with one entry never arms a rotation timer (destroy-safe)', () => {
    container = document.createElement('div');
    const ls = createLoadingScreen(container);
    ls.setChronicle(['A single annal.']);
    const block = container.querySelector('.sg-loading__chronicle') as HTMLElement;
    expect(block.textContent).toContain('A single annal.');
    ls.destroy();   // must not throw with no interval armed
    expect(container.querySelector('.sg-loading')).toBeNull();
  });
});
