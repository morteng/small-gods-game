import { injectDevStyles } from '@/dev/dev-styles';
import { DEV_UI_Z } from '@/dev/FloatingPanel';

export interface ToolbarButton {
  id: string;
  label: string;
  isActive?: () => boolean;
  onClick: () => void;
}
export interface DevToolbarHandle {
  element: HTMLElement;
  refresh(): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

export function mountDevToolbar(container: HTMLElement, buttons: ToolbarButton[]): DevToolbarHandle {
  injectDevStyles();
  const bar = document.createElement('div');
  bar.className = 'sg-dev-toolbar';
  bar.style.zIndex = String(DEV_UI_Z);
  bar.style.display = 'none';

  const els: { spec: ToolbarButton; el: HTMLButtonElement }[] = [];
  for (const spec of buttons) {
    const b = document.createElement('button');
    b.className = 'sg-dev-toolbar__btn';
    b.type = 'button';
    b.textContent = spec.label;
    b.addEventListener('click', () => { spec.onClick(); refresh(); });
    bar.appendChild(b);
    els.push({ spec, el: b });
  }
  container.appendChild(bar);

  function refresh(): void {
    for (const { spec, el } of els) {
      if (spec.isActive) el.classList.toggle('sg-dev-toolbar__btn--active', spec.isActive());
    }
  }
  refresh();

  return {
    element: bar,
    refresh,
    show(): void { bar.style.display = 'flex'; refresh(); },
    hide(): void { bar.style.display = 'none'; },
    destroy(): void { bar.remove(); },
  };
}
