import { addPanelChrome } from '@/dev/PanelChrome';
import { injectDevStyles } from '@/dev/dev-styles';
import type { DockManager } from './dock-manager';

/** Dedicated dev-UI stacking band (kept in sync with DevModeController). */
export const DEV_UI_Z = 600;

export interface FloatingPanelOptions {
  container: HTMLElement;
  title: string;
  width?: number;
  anchor?: { top?: string; right?: string; left?: string; bottom?: string };
  zIndex?: number;
  id?: string;
  dock?: DockManager;
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

  function show(): void { panel.style.display = 'flex'; if (opts.dock && opts.id) opts.dock.noteOpen(opts.id, true); }
  function hide(): void { panel.style.display = 'none'; if (opts.dock && opts.id) opts.dock.noteOpen(opts.id, false); }
  function toggle(): void { if (panel.style.display === 'none') show(); else hide(); }

  // PanelChrome inserts its bar at panel.firstChild, so it lands above `body`.
  const chrome = addPanelChrome(panel, {
    title: opts.title,
    onClose: () => hide(),
    onDragEnd: () => { if (opts.dock && opts.id) opts.dock.onDragEnd(opts.id, panel.getBoundingClientRect()); },
  });

  opts.container.appendChild(panel);

  if (opts.dock && opts.id) {
    opts.dock.register({ id: opts.id, element: panel, setOpen: (o) => { if (o) show(); else hide(); } });
  }

  return {
    element: panel,
    body,
    setTitle(title: string): void { chrome.setTitle(title); },
    show,
    hide,
    toggle,
    isVisible(): boolean { return panel.style.display !== 'none'; },
    destroy(): void { panel.remove(); },
  };
}
