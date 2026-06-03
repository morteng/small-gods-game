import { describe, it, expect, vi } from 'vitest';
import { mountDevToolbar } from '@/dev/dev-toolbar';

describe('mountDevToolbar', () => {
  it('renders one button per spec, toggles active class on refresh, fires onClick', () => {
    const container = document.createElement('div');
    let inspectorOpen = false;
    const onClick = vi.fn(() => { inspectorOpen = true; });
    const tb = mountDevToolbar(container, [
      { id: 'inspector', label: '🔍 Inspector', isActive: () => inspectorOpen, onClick },
      { id: 'render', label: '◈ Iso', onClick: vi.fn() },
    ]);
    const btns = tb.element.querySelectorAll('.sg-dev-toolbar__btn');
    expect(btns.length).toBe(2);
    (btns[0] as HTMLElement).click();
    expect(onClick).toHaveBeenCalled();
    tb.refresh();
    expect((btns[0] as HTMLElement).classList.contains('sg-dev-toolbar__btn--active')).toBe(true);
    tb.hide(); expect(tb.element.style.display).toBe('none');
    tb.show(); expect(tb.element.style.display).not.toBe('none');
    tb.destroy(); expect(container.contains(tb.element)).toBe(false);
  });
});
