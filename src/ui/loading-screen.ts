/**
 * Loading Screen — a plain dark-background overlay shown while the world boots.
 *
 * Deliberately minimal (no theme tokens, no onboarding): a title, a determinate
 * progress bar, and a status label. Replaces the old start menu / welcome modal
 * during development. A richer "gamey" intro / user flow comes later.
 */

export interface LoadingScreenHandle {
  element: HTMLElement;
  /** Set progress 0..1 and an optional status label. Clamps to [0,1]. */
  setProgress(fraction: number, label?: string): void;
  show(): void;
  /** Fade out, then detach from the DOM tree (kept removable via destroy()). */
  hide(): void;
  destroy(): void;
}

const STYLE = `
.sg-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  background: #0d0e12;
  color: #e7e3d8;
  z-index: 100;
  opacity: 1;
  transition: opacity 320ms ease;
  font-family: var(--f-sans, system-ui, sans-serif);
  user-select: none;
}
.sg-loading--hidden { opacity: 0; pointer-events: none; }
.sg-loading__title {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #f3efe4;
  opacity: 0.92;
}
.sg-loading__track {
  width: min(340px, 60vw);
  height: 4px;
  border-radius: 999px;
  background: #26282f;
  overflow: hidden;
}
.sg-loading__fill {
  height: 100%;
  width: 0%;
  border-radius: 999px;
  background: linear-gradient(90deg, #6f8f5f, #b9c98a);
  transition: width 240ms ease;
}
.sg-loading__label {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #8b8f9a;
  min-height: 14px;
}
`;

export function createLoadingScreen(container: HTMLElement): LoadingScreenHandle {
  if (!document.querySelector('#sg-loading-styles')) {
    const style = document.createElement('style');
    style.id = 'sg-loading-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const element = document.createElement('div');
  element.className = 'sg-loading';

  const title = document.createElement('div');
  title.className = 'sg-loading__title';
  title.textContent = 'Small Gods';
  element.appendChild(title);

  const track = document.createElement('div');
  track.className = 'sg-loading__track';
  const fill = document.createElement('div');
  fill.className = 'sg-loading__fill';
  track.appendChild(fill);
  element.appendChild(track);

  const label = document.createElement('div');
  label.className = 'sg-loading__label';
  label.textContent = 'Loading…';
  element.appendChild(label);

  container.appendChild(element);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    element,
    setProgress(fraction: number, text?: string): void {
      const pct = Math.max(0, Math.min(1, fraction)) * 100;
      fill.style.width = `${pct}%`;
      if (text !== undefined) label.textContent = text;
    },
    show(): void {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (!element.isConnected) container.appendChild(element);
      element.classList.remove('sg-loading--hidden');
    },
    hide(): void {
      element.classList.add('sg-loading--hidden');
      hideTimer = setTimeout(() => { element.remove(); hideTimer = null; }, 360);
    },
    destroy(): void {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      element.remove();
    },
  };
}
