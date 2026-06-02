import { addPanelChrome } from '@/dev/PanelChrome';
import { injectDevStyles } from '@/dev/dev-styles';

/** Dedicated dev-UI stacking band (kept in sync with DevModeController). */
export const DEV_UI_Z = 600;

export interface FloatingPanelOptions {
  container: HTMLElement;
  title: string;
  width?: number;
  anchor?: { top?: string; right?: string; left?: string; bottom?: string };
  zIndex?: number;
}

export interface FloatingPanelHandle {
  element: HTMLElement;
  body: HTMLElement;
  setTitle(title: string): void;
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  destroy(): void;
}

export function createFloatingPanel(opts: FloatingPanelOptions): FloatingPanelHandle {
  injectDevStyles();

  const panel = document.createElement('div');
  panel.className = 'sg-dev-panel';
  panel.style.width = `${opts.width ?? 360}px`;
  panel.style.maxHeight = '80vh';
  panel.style.zIndex = String(opts.zIndex ?? DEV_UI_Z);
  panel.style.display = 'none';
  const anchor = opts.anchor ?? { top: '60px', right: '10px' };
  if (anchor.top !== undefined) panel.style.top = anchor.top;
  if (anchor.right !== undefined) panel.style.right = anchor.right;
  if (anchor.left !== undefined) panel.style.left = anchor.left;
  if (anchor.bottom !== undefined) panel.style.bottom = anchor.bottom;

  const body = document.createElement('div');
  body.className = 'sg-dev-body';
  panel.appendChild(body);

  // PanelChrome inserts its bar at panel.firstChild, so it lands above `body`.
  const chrome = addPanelChrome(panel, {
    title: opts.title,
    onClose: () => { panel.style.display = 'none'; },
  });

  opts.container.appendChild(panel);

  return {
    element: panel,
    body,
    setTitle(title: string): void { chrome.setTitle(title); },
    show(): void { panel.style.display = 'flex'; },
    hide(): void { panel.style.display = 'none'; },
    toggle(): void { panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; },
    isVisible(): boolean { return panel.style.display !== 'none'; },
    destroy(): void { panel.remove(); },
  };
}
