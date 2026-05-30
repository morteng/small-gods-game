/**
 * Tutorial / Onboarding System — first-time user experience.
 * Shows contextual hints for key controls without being intrusive.
 */

import type { RenderContext } from '@/core/types';

export interface TutorialOptions {
  onComplete?: () => void;
  onSkip?: () => void;
}

export interface TutorialHandle {
  show(step: string): void;
  hide(): void;
  advance(): void;
  destroy(): void;
  isShowing(): boolean;
}

interface TutorialStep {
  id: string;
  title: string;
  text: string;
  key?: string; // Keyboard shortcut to display
  position: 'top' | 'bottom' | 'left' | 'right' | 'center';
  target?: string; // CSS selector or element to point to
}

const STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Small Gods',
    text: 'You are a minor deity. Shape the world through whispers and miracles.',
    position: 'center',
  },
  {
    id: 'time',
    title: 'Time Controls',
    text: 'Press T to open the time bar. Use 1, 2, 4, 8 to change speed. Space to pause.',
    key: 'T',
    position: 'top',
  },
  {
    id: 'npc-interact',
    title: 'Interact with NPCs',
    text: 'Click on an NPC to see their info panel. Use divine actions like Whisper or Omen.',
    position: 'left',
  },
  {
    id: 'right-click',
    title: 'Context Menu',
    text: 'Right-click on tiles to place decorations or interact with POIs.',
    position: 'center',
  },
  {
    id: 'dev-mode',
    title: 'Developer Mode',
    text: 'Press ` (backquote) to toggle debug HUD. Ctrl+Shift+D for dev mode panels.',
    key: '`',
    position: 'bottom',
  },
  {
    id: 'ready',
    title: 'You\'re Ready!',
    text: 'Explore, influence, and grow your belief. Good luck, young deity.',
    position: 'center',
  },
];

const STYLE = `
.sg-tutorial-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  z-index: 100;
  animation: sg-fade-in 200ms ease-out;
  pointer-events: auto;
}

@keyframes sg-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.sg-tutorial-card {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--r-4);
  box-shadow: var(--lift-2);
  padding: var(--s-5);
  max-width: 420px;
  width: calc(100% - 32px);
  animation: sg-slide-up 300ms ease-out;
}

@keyframes sg-slide-up {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

.sg-tutorial__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--s-3);
}

.sg-tutorial__title {
  font-family: var(--f-sans);
  font-size: var(--t-md);
  font-weight: 600;
  color: var(--ink);
}

.sg-tutorial__close {
  all: unset;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--r-1);
  color: var(--ink-3);
  font-size: 18px;
  line-height: 1;
}

.sg-tutorial__close:hover {
  background: var(--paper-2);
  color: var(--ink);
}

.sg-tutorial__body {
  font-family: var(--f-sans);
  font-size: var(--t-base);
  color: var(--ink-2);
  line-height: 1.6;
  margin-bottom: var(--s-4);
}

.sg-tutorial__key {
  display: inline-block;
  padding: 2px 8px;
  background: var(--shade);
  border: 1px solid var(--line);
  border-radius: var(--r-1);
  font-family: var(--f-mono);
  font-size: var(--t-small);
  color: var(--ink);
  box-shadow: 0 1px 0 var(--line-2);
}

.sg-tutorial__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sg-tutorial__progress {
  font-family: var(--f-mono);
  font-size: var(--t-micro);
  color: var(--ink-4);
}

.sg-tutorial__actions {
  display: flex;
  gap: var(--s-2);
}

.sg-tutorial__btn {
  padding: 6px 14px;
  border-radius: var(--r-2);
  font-family: var(--f-sans);
  font-size: var(--t-small);
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, transform 80ms ease;
}

.sg-tutorial__btn--primary {
  background: var(--you);
  color: white;
  border: 1px solid var(--you);
}

.sg-tutorial__btn--primary:hover {
  background: oklch(0.62 0.14 45);
}

.sg-tutorial__btn--ghost {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--ink-2);
}

.sg-tutorial__btn--ghost:hover {
  background: var(--paper-2);
}

.sg-tutorial__dot-container {
  display: flex;
  gap: 6px;
  justify-content: center;
  margin-top: var(--s-3);
}

.sg-tutorial__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--line-2);
  transition: background 200ms ease;
}

.sg-tutorial__dot--active {
  background: var(--you);
}
`;

export function createTutorial(
  container: HTMLElement,
  opts: TutorialOptions = {},
): TutorialHandle {
  // Inject styles
  if (!document.querySelector('#sg-tutorial-styles')) {
    const style = document.createElement('style');
    style.id = 'sg-tutorial-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'sg-tutorial-overlay';
  overlay.style.display = 'none';

  const card = document.createElement('div');
  card.className = 'sg-tutorial-card';

  // Header
  const header = document.createElement('div');
  header.className = 'sg-tutorial__header';

  const title = document.createElement('div');
  title.className = 'sg-tutorial__title';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sg-tutorial__close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    hide();
    opts.onSkip?.();
  });
  header.appendChild(closeBtn);

  card.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'sg-tutorial__body';
  card.appendChild(body);

  // Dots
  const dotContainer = document.createElement('div');
  dotContainer.className = 'sg-tutorial__dot-container';
  card.appendChild(dotContainer);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'sg-tutorial__footer';

  const progress = document.createElement('div');
  progress.className = 'sg-tutorial__progress';
  footer.appendChild(progress);

  const actions = document.createElement('div');
  actions.className = 'sg-tutorial__actions';

  const skipBtn = document.createElement('button');
  skipBtn.className = 'sg-tutorial__btn sg-tutorial__btn--ghost';
  skipBtn.textContent = 'Skip';
  skipBtn.addEventListener('click', () => {
    hide();
    opts.onSkip?.();
  });
  actions.appendChild(skipBtn);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'sg-tutorial__btn sg-tutorial__btn--primary';
  nextBtn.textContent = 'Next';
  actions.appendChild(nextBtn);

  footer.appendChild(actions);
  card.appendChild(footer);

  overlay.appendChild(card);
  container.appendChild(overlay);

  let currentStep = -1;
  let showing = false;

  function updateDots(): void {
    dotContainer.innerHTML = '';
    STEPS.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.className = 'sg-tutorial__dot';
      if (i === currentStep) dot.classList.add('sg-tutorial__dot--active');
      dotContainer.appendChild(dot);
    });
  }

  function show(stepId: string): void {
    const idx = STEPS.findIndex(s => s.id === stepId);
    if (idx === -1) return;

    currentStep = idx;
    const step = STEPS[idx];

    title.textContent = step.title;
    
    // Format body text with key hint if available
    if (step.key) {
      body.innerHTML = step.text + ' <span class="sg-tutorial__key">' + step.key + '</span>';
    } else {
      body.textContent = step.text;
    }

    progress.textContent = `${idx + 1} / ${STEPS.length}`;
    updateDots();

    nextBtn.textContent = idx === STEPS.length - 1 ? 'Start Playing' : 'Next';

    overlay.style.display = 'flex';
    showing = true;
  }

  function hide(): void {
    overlay.style.display = 'none';
    showing = false;
  }

  function advance(): void {
    if (currentStep < STEPS.length - 1) {
      show(STEPS[currentStep + 1].id);
    } else {
      hide();
      opts.onComplete?.();
    }
  }

  nextBtn.addEventListener('click', advance);

  // Keyboard navigation
  const keyHandler = (e: KeyboardEvent) => {
    if (!showing) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      advance();
    }
    if (e.key === 'Escape') {
      hide();
      opts.onSkip?.();
    }
  };
  document.addEventListener('keydown', keyHandler);

  // Auto-show first step (check localStorage)
  const tutorialSeen = localStorage.getItem('small-gods-tutorial-seen');
  if (!tutorialSeen) {
    setTimeout(() => show('welcome'), 500);
  }

  return {
    show,
    hide,
    advance,
    destroy() {
      overlay.remove();
      document.removeEventListener('keydown', keyHandler);
    },
    isShowing() {
      return showing;
    },
  };
}
