/**
 * PanelChrome — shared chrome (title bar, close, minimize, drag) for dev panels.
 * Uses design tokens for consistent styling.
 */

export interface PanelChromeOptions {
  title: string;
  onClose?: () => void;
  onMinimize?: (minimized: boolean) => void;
  onDragEnd?: (x: number, y: number) => void;
}

export interface PanelChromeHandle {
  element: HTMLElement;
  setTitle(title: string): void;
  setMinimized(minimized: boolean): void;
}

const STYLE = `
.sg-panel-chrome {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-2) var(--s-3);
  background: var(--paper-2);
  border-bottom: 1px solid var(--line);
  cursor: move;
  user-select: none;
}

.sg-panel-chrome__title {
  flex: 1;
  font-family: var(--f-sans);
  font-size: var(--t-small);
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sg-panel-chrome__actions {
  display: flex;
  gap: 2px;
}

.sg-panel-chrome__btn {
  all: unset;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--r-1);
  color: var(--ink-3);
  font-size: 14px;
  line-height: 1;
  transition: background 120ms ease, color 120ms ease;
}

.sg-panel-chrome__btn:hover {
  background: var(--paper);
  color: var(--ink);
}

.sg-panel-chrome__btn--close:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
`;

let styleInjected = false;

export function addPanelChrome(
  panel: HTMLElement,
  opts: PanelChromeOptions,
): PanelChromeHandle {
  if (!styleInjected) {
    const style = document.createElement('style');
    style.id = 'sg-panel-chrome-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
    styleInjected = true;
  }

  const chrome = document.createElement('div');
  chrome.className = 'sg-panel-chrome';

  const title = document.createElement('div');
  title.className = 'sg-panel-chrome__title';
  title.textContent = opts.title;
  chrome.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'sg-panel-chrome__actions';

  // Minimize button
  const minBtn = document.createElement('button');
  minBtn.className = 'sg-panel-chrome__btn';
  minBtn.textContent = '─';
  minBtn.title = 'Minimize';
  let minimized = false;
  minBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    minimized = !minimized;
    minBtn.textContent = minimized ? '□' : '─';
    opts.onMinimize?.(minimized);
  });
  actions.appendChild(minBtn);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'sg-panel-chrome__btn sg-panel-chrome__btn--close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.onClose?.();
  });
  actions.appendChild(closeBtn);

  chrome.appendChild(actions);

  // Insert at top of panel
  panel.insertBefore(chrome, panel.firstChild);

  // Drag functionality
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  chrome.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('.sg-panel-chrome__btn')) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    // The panel is absolutely positioned within its offsetParent (the game
    // container), which is generally not at the viewport origin. Convert the
    // desired viewport position into offsetParent-relative coordinates so the
    // panel tracks the cursor instead of jumping by the container's offset.
    const parent = panel.offsetParent as HTMLElement | null;
    let originX = 0;
    let originY = 0;
    if (parent) {
      const pr = parent.getBoundingClientRect();
      originX = pr.left + parent.clientLeft;
      originY = pr.top + parent.clientTop;
    }
    // Panels may be anchored via `right`/`bottom`; clear them so left/top win.
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = `${e.clientX - dragOffsetX - originX}px`;
    panel.style.top = `${e.clientY - dragOffsetY - originY}px`;
  });

  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      const rect = panel.getBoundingClientRect();
      opts.onDragEnd?.(rect.left, rect.top);
    }
  });

  return {
    element: chrome,
    setTitle(newTitle: string): void {
      title.textContent = newTitle;
    },
    setMinimized(isMinimized: boolean): void {
      minimized = isMinimized;
      minBtn.textContent = minimized ? '□' : '─';
      opts.onMinimize?.(minimized);
    },
  };
}
