// src/render/ui/ui-whisper-island.ts
//
// The conversation card's free-text field — the second sanctioned "DOM island"
// (the WebGPU UI can't host a caret). While a `keepOpen` whisper card is up, this
// floats a single `<input>` + SEND over the card's input row, positioned each
// frame from the GPU layout (device px → css px) exactly like `SettingsIsland`.
// Enter (or SEND) hands the typed words to the game, which runs the same
// `sendWhisper` path the canned paths use; the field then clears and keeps focus
// so a back-and-forth flows without re-clicking.
//
// Self-contained: inline styles, no CSS deps. Purely an input surface — it owns no
// game state and never touches belief/transcript; it only emits the raw text.

/** CSS-pixel rect (top-left origin) the island should occupy. */
export interface IslandRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class WhisperInputIsland {
  private root: HTMLDivElement;
  private input: HTMLInputElement;
  private shown = false;

  constructor(container: HTMLElement, private onSend: (text: string) => void) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:absolute', 'display:none', 'box-sizing:border-box',
      'flex-direction:row', 'gap:8px', 'align-items:stretch',
      'font-family:ui-monospace,Menlo,Consolas,monospace', 'color:#e8e6f0',
      'background:transparent', 'z-index:30', 'pointer-events:auto',
    ].join(';');
    this.root.style.display = 'none'; // explicit (some CSSOMs drop the multi-prop cssText's display)

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = 'whisper your own words…';
    this.input.setAttribute('aria-label', 'Whisper free text');
    this.input.style.cssText = [
      'flex:1 1 auto', 'min-width:0', 'box-sizing:border-box', 'padding:8px 10px',
      'font:inherit', 'color:#e8e6f0', 'background:rgba(0,0,0,0.35)',
      'border:1px solid rgba(255,255,255,0.18)', 'border-radius:3px', 'outline:none',
    ].join(';');
    // Enter submits; keep other keystrokes from leaking to any window-level game
    // shortcut while the player is typing. Escape is intentionally NOT swallowed —
    // it bubbles to the runtime's handler, which closes the whole card.
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key !== 'Escape') {
        e.stopPropagation();
      }
    });
    this.root.appendChild(this.input);

    const send = document.createElement('button');
    send.textContent = '⏎';
    send.setAttribute('aria-label', 'Send whisper');
    send.style.cssText = [
      'flex:0 0 auto', 'padding:0 14px', 'cursor:pointer', 'font:inherit',
      'color:#1a1a24', 'background:#d9b25e', 'border:0', 'border-radius:3px',
    ].join(';');
    send.addEventListener('click', () => this.submit());
    this.root.appendChild(send);

    container.appendChild(this.root);
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.onSend(text);
    this.input.focus(); // keep the field hot for the next line of the exchange
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.root.style.display = 'flex';
    this.input.focus();
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.style.display = 'none';
    this.input.blur();
  }

  isShown(): boolean {
    return this.shown;
  }

  /** Position the island over the card's input row (CSS px). */
  layout(r: IslandRect): void {
    this.root.style.left = `${Math.round(r.x)}px`;
    this.root.style.top = `${Math.round(r.y)}px`;
    this.root.style.width = `${Math.round(r.w)}px`;
    this.root.style.height = `${Math.round(r.h)}px`;
  }

  destroy(): void {
    this.root.remove();
  }
}
