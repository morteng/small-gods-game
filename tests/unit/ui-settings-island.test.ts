import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsIsland, buildStamp } from '@/render/ui/ui-settings-island';

describe('ui-settings-island build stamp', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('buildStamp reads the vX (sha) shape', () => {
    // Under vitest the vite `define` is not applied, so the module falls back to
    // the sentinel values — the format must still be v<version> (<sha>).
    expect(buildStamp()).toMatch(/^v\S+ \(\S+\)$/);
  });

  it('renders the build stamp as a footer line in the island DOM', () => {
    const container = document.createElement('div');
    const island = new SettingsIsland(container, () => {});
    const text = container.textContent ?? '';
    expect(text).toContain(buildStamp());
    // The stamp lives in its own low-emphasis footer element, not merged into a label.
    const footer = Array.from(container.querySelectorAll('div')).find(
      (d) => d.textContent === buildStamp(),
    );
    expect(footer).toBeTruthy();
    island.destroy();
  });
});
