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
  /** M1: show excerpts from the restored world's chronicle while the world
   *  wakes (rotates through `texts` if more than one). Empty array hides the
   *  block — the fresh-world default. */
  setChronicle(texts: readonly string[]): void;
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
.sg-loading__chronicle {
  max-width: min(520px, 78vw);
  margin-top: 18px;
  text-align: center;
  font-style: italic;
  font-size: 14px;
  line-height: 1.55;
  color: #b8b2a2;
  opacity: 0;
  transition: opacity 600ms ease;
}
.sg-loading__chronicle--visible { opacity: 0.85; }
.sg-loading__chronicle-caption {
  margin-top: 8px;
  font-style: normal;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #6d7078;
}
`;

/** How long each chronicle excerpt holds before rotating to the next. */
const CHRONICLE_ROTATE_MS = 9000;

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

  // The chronicle block sits under the bar, hidden until setChronicle() gets
  // a restored world's annals to read from.
  const chronicle = document.createElement('div');
  chronicle.className = 'sg-loading__chronicle';
  const chronicleText = document.createElement('div');
  const chronicleCaption = document.createElement('div');
  chronicleCaption.className = 'sg-loading__chronicle-caption';
  chronicleCaption.textContent = 'from the chronicle of this world';
  chronicle.appendChild(chronicleText);
  chronicle.appendChild(chronicleCaption);
  element.appendChild(chronicle);

  container.appendChild(element);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let rotateTimer: ReturnType<typeof setInterval> | null = null;

  const stopRotation = (): void => {
    if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
  };

  return {
    element,
    setProgress(fraction: number, text?: string): void {
      const pct = Math.max(0, Math.min(1, fraction)) * 100;
      fill.style.width = `${pct}%`;
      if (text !== undefined) label.textContent = text;
    },
    setChronicle(texts: readonly string[]): void {
      stopRotation();
      if (!texts.length) {
        chronicle.classList.remove('sg-loading__chronicle--visible');
        return;
      }
      let i = texts.length - 1;               // start on the most recent annal
      chronicleText.textContent = texts[i];
      chronicle.classList.add('sg-loading__chronicle--visible');
      if (texts.length > 1) {
        rotateTimer = setInterval(() => {
          i = (i + 1) % texts.length;
          chronicleText.textContent = texts[i];
        }, CHRONICLE_ROTATE_MS);
      }
    },
    show(): void {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (!element.isConnected) container.appendChild(element);
      element.classList.remove('sg-loading--hidden');
    },
    hide(): void {
      stopRotation();
      element.classList.add('sg-loading--hidden');
      hideTimer = setTimeout(() => { element.remove(); hideTimer = null; }, 360);
    },
    destroy(): void {
      stopRotation();
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      element.remove();
    },
  };
}
