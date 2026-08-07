// src/render/ui/kit/world-code-island.ts
//
// The NEW GAME screen's paste field (UI v3 P5b — seed share) — the third DOM
// island, composing the shared shell in `island-frame.ts` rather than
// hand-rolling a third root/show/hide/layout/destroy (the house rule this
// module exists to honour; see that file's header). A single text field +
// BEGIN button, exactly the whisper island's row layout: Enter or a click on
// BEGIN hands the raw pasted text to the caller, which decodes it
// (`@/game/world-code`) and either starts that world or reports why not — this
// module has no opinion on the code's validity, it only emits what was typed.

import { IslandFrame, type IslandRect } from '@/render/ui/kit/island-frame';

export type { IslandRect };

export class WorldCodeIsland {
  private frame: IslandFrame;
  private input: HTMLInputElement;

  constructor(container: HTMLElement, private onSubmit: (text: string) => void) {
    this.frame = new IslandFrame(container, { flexDirection: 'row', gap: 8 });
    this.frame.root.style.alignItems = 'stretch';

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = 'paste a world code…';
    this.input.setAttribute('aria-label', 'World code');
    this.input.style.cssText = [
      'flex:1 1 auto', 'min-width:0', 'box-sizing:border-box', 'padding:8px 10px',
      'font:inherit', 'color:#e8e6f0', 'background:rgba(0,0,0,0.35)',
      'border:1px solid rgba(255,255,255,0.18)', 'border-radius:3px', 'outline:none',
      'text-transform:uppercase', 'letter-spacing:1px',
    ].join(';');
    // Enter submits; other keystrokes stay local while typing (same rule as
    // `WhisperInputIsland`) — Escape is deliberately NOT swallowed, so it still
    // bubbles to the runtime's generic screen-pop.
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key !== 'Escape') {
        e.stopPropagation();
      }
    });
    this.frame.root.appendChild(this.input);

    const begin = document.createElement('button');
    begin.textContent = 'BEGIN';
    begin.setAttribute('aria-label', 'Begin with this world code');
    begin.style.cssText = [
      'flex:0 0 auto', 'padding:0 14px', 'cursor:pointer', 'font:inherit',
      'letter-spacing:1px', 'color:#1a1a24', 'background:#d9b25e', 'border:0', 'border-radius:3px',
    ].join(';');
    begin.addEventListener('click', () => this.submit());
    this.frame.root.appendChild(begin);
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.onSubmit(text);
  }

  show(): void {
    this.frame.show();
  }

  hide(): void {
    this.frame.hide();
  }

  isShown(): boolean {
    return this.frame.isShown();
  }

  /** Position the island over the NEW GAME screen's reserved rect (CSS px). */
  layout(r: IslandRect): void {
    this.frame.layout(r);
  }

  destroy(): void {
    this.frame.destroy();
  }
}
