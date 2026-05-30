/**
 * Main Menu Screen — welcome screen with game title and start option.
 * Uses the design token system for consistent styling.
 */

import type { GameOptions } from '@/game';

export interface MainMenuHandle {
  element: HTMLElement;
  show(): void;
  hide(): void;
  destroy(): void;
}

const STYLE = `
.sg-main-menu {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    180deg,
    oklch(0.94 0.012 230 / 0.95) 0%,
    oklch(0.62 0.10 140 / 0.90) 100%
  );
  z-index: 50;
  animation: sg-fade-in 300ms ease-out;
}

@keyframes sg-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.sg-main-menu__card {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--r-4);
  box-shadow: var(--lift-2);
  padding: var(--s-6);
  max-width: 480px;
  width: calc(100% - 32px);
  text-align: center;
  animation: sg-scale-in 300ms ease-out;
}

@keyframes sg-scale-in {
  from { opacity: 0; transform: scale(0.95) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.sg-main-menu__title {
  font-family: var(--f-sans);
  font-size: var(--t-display);
  font-weight: 700;
  color: var(--ink);
  margin: 0 0 var(--s-2) 0;
  letter-spacing: -0.02em;
}

.sg-main-menu__subtitle {
  font-family: var(--f-sans);
  font-size: var(--t-md);
  color: var(--ink-2);
  margin: 0 0 var(--s-5) 0;
  font-weight: 400;
}

.sg-main-menu__divider {
  height: 1px;
  background: var(--line);
  margin: var(--s-4) 0;
}

.sg-main-menu__description {
  font-family: var(--f-sans);
  font-size: var(--t-small);
  color: var(--ink-3);
  line-height: 1.6;
  margin: 0 0 var(--s-5) 0;
}

.sg-main-menu__actions {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.sg-main-menu__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: 12px 24px;
  background: var(--you);
  color: white;
  border: 1px solid var(--you);
  border-radius: var(--r-3);
  font-family: var(--f-sans);
  font-size: var(--t-md);
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease, transform 80ms ease, box-shadow 120ms ease;
  box-shadow: var(--lift-1);
}

.sg-main-menu__btn:hover {
  background: oklch(0.62 0.14 45);
  box-shadow: var(--lift-2);
  transform: translateY(-1px);
}

.sg-main-menu__btn:active {
  transform: translateY(0);
}

.sg-main-menu__btn--ghost {
  background: transparent;
  border-color: var(--line-2);
  color: var(--ink-2);
}

.sg-main-menu__btn--ghost:hover {
  background: var(--paper-2);
  border-color: var(--ink-3);
  color: var(--ink);
  box-shadow: none;
}

.sg-main-menu__footer {
  margin-top: var(--s-5);
  font-family: var(--f-mono);
  font-size: var(--t-micro);
  color: var(--ink-4);
}

.sg-main-menu__key {
  display: inline-block;
  padding: 1px 5px;
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--r-1);
  font-size: var(--t-micro);
}
`;

export interface MainMenuOptions {
  onStart?: (options?: GameOptions) => void;
  onSettings?: () => void;
  version?: string;
}

export function createMainMenu(
  container: HTMLElement,
  opts: MainMenuOptions = {},
): MainMenuHandle {
  // Inject styles
  if (!document.querySelector('#sg-main-menu-styles')) {
    const style = document.createElement('style');
    style.id = 'sg-main-menu-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'sg-main-menu';

  const card = document.createElement('div');
  card.className = 'sg-main-menu__card';

  // Title
  const title = document.createElement('h1');
  title.className = 'sg-main-menu__title';
  title.textContent = 'Small Gods';
  card.appendChild(title);

  // Subtitle
  const subtitle = document.createElement('p');
  subtitle.className = 'sg-main-menu__subtitle';
  subtitle.textContent = 'A god game of whispers, belief, and divine rivalry';
  card.appendChild(subtitle);

  // Divider
  const divider = document.createElement('div');
  divider.className = 'sg-main-menu__divider';
  card.appendChild(divider);

  // Description
  const desc = document.createElement('p');
  desc.className = 'sg-main-menu__description';
  desc.innerHTML = 
    'Shape the hearts of mortals through subtle influence. ' +
    'Compete with rival spirits for the souls of a procedurally generated world.';
  card.appendChild(desc);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'sg-main-menu__actions';

  const startBtn = document.createElement('button');
  startBtn.className = 'sg-main-menu__btn';
  startBtn.innerHTML = '⚡ Begin Game';
  startBtn.addEventListener('click', () => {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 200ms ease-out';
    setTimeout(() => {
      opts.onStart?.();
      hide();
    }, 200);
  });
  actions.appendChild(startBtn);

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'sg-main-menu__btn sg-main-menu__btn--ghost';
  settingsBtn.innerHTML = '⚙️ Settings';
  settingsBtn.addEventListener('click', () => {
    opts.onSettings?.();
  });
  actions.appendChild(settingsBtn);

  card.appendChild(actions);

  // Footer with keyboard shortcut hint
  const footer = document.createElement('div');
  footer.className = 'sg-main-menu__footer';
  footer.innerHTML = 
    'Press <span class="sg-main-menu__key">T</span> for time controls • ' +
    'Click NPCs to interact • ' +
    `<span class="sg-main-menu__key">?</span> for help` +
    (opts.version ? ` • v${opts.version}` : '');
  card.appendChild(footer);

  overlay.appendChild(card);
  container.appendChild(overlay);

  function show(): void {
    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
    });
  }

  function hide(): void {
    overlay.style.display = 'none';
  }

  // Show by default
  show();

  return {
    element: overlay,
    show,
    hide,
    destroy() {
      overlay.remove();
    },
  };
}
