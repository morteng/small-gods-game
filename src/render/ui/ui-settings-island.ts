// src/render/ui/ui-settings-island.ts
//
// The "DOM island" the WebGPU UI epic mandates: a thin DOM overlay for the ONE
// thing a canvas can't do — typed text input (API keys, model ids). The pause
// menu's settings panel is drawn on the GPU; this island floats the actual
// provider FORM over the panel's interior, positioned each frame from the canvas
// layout (device px → css px) so the two stay aligned. Everything else (chrome,
// nav, the lighting toggle) stays on the GPU.
//
// Self-contained: inline styles, no CSS deps. Reads/writes the same localStorage
// provider config the legacy settings panel used, and calls back into the game to
// rebuild the live LLM client (`Game.applyLlmConfig`).

import {
  loadProviderConfig,
  saveProviderConfig,
  getProviderDisplayName,
  type ProviderConfig,
  type ProviderType,
} from '@/llm/provider-factory';

/** CSS-pixel rect (top-left origin) the island should occupy. */
export interface IslandRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PROVIDERS: ProviderType[] = ['mock', 'openai', 'openrouter'];

// Build identity baked in by Vite `define` (see vite.config.ts). Guarded with `typeof`
// so this module stays importable under vitest, which does not apply the vite define.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const GIT_SHA = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'unknown';
/** Human-readable build stamp shown in the settings footer, e.g. `v0.1.0 (a11cd869)`. */
export function buildStamp(): string {
  return `v${APP_VERSION} (${GIT_SHA})`;
}

export class SettingsIsland {
  private root: HTMLDivElement;
  private providerSel: HTMLSelectElement;
  private modelInput: HTMLInputElement;
  private keyInput: HTMLInputElement;
  private status: HTMLDivElement;
  private config: ProviderConfig;
  private shown = false;

  constructor(container: HTMLElement, private onSave: (cfg: ProviderConfig) => void) {
    this.config = loadProviderConfig();

    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:absolute', 'display:none', 'box-sizing:border-box',
      'flex-direction:column', 'gap:10px', 'padding:14px',
      'font-family:ui-monospace,Menlo,Consolas,monospace', 'color:#e8e6f0',
      'background:transparent', 'z-index:30', 'pointer-events:auto',
    ].join(';');

    this.root.appendChild(this.label('LLM PROVIDER'));
    this.providerSel = document.createElement('select');
    styleField(this.providerSel);
    for (const p of PROVIDERS) {
      const o = document.createElement('option');
      o.value = p;
      o.textContent = getProviderDisplayName(p);
      this.providerSel.appendChild(o);
    }
    this.providerSel.value = this.config.type;
    this.providerSel.addEventListener('change', () => this.syncFromFields());
    this.root.appendChild(this.providerSel);

    this.root.appendChild(this.label('MODEL'));
    this.modelInput = document.createElement('input');
    this.modelInput.type = 'text';
    this.modelInput.placeholder = 'e.g. anthropic/claude-haiku-4.5';
    styleField(this.modelInput);
    this.root.appendChild(this.modelInput);

    this.root.appendChild(this.label('API KEY'));
    this.keyInput = document.createElement('input');
    this.keyInput.type = 'password';
    this.keyInput.placeholder = 'sk-…  (stored locally, never sent to us)';
    styleField(this.keyInput);
    this.root.appendChild(this.keyInput);

    const save = document.createElement('button');
    save.textContent = 'SAVE';
    save.style.cssText = [
      'margin-top:4px', 'padding:8px 12px', 'cursor:pointer',
      'font:inherit', 'letter-spacing:2px', 'color:#1a1a24',
      'background:#d9b25e', 'border:0', 'border-radius:3px',
    ].join(';');
    save.addEventListener('click', () => this.save());
    this.root.appendChild(save);

    this.status = document.createElement('div');
    this.status.style.cssText = 'font-size:11px;opacity:0.7;min-height:14px';
    this.root.appendChild(this.status);

    // Build stamp footer — version + git SHA, for bug reports. Pushed to the bottom.
    const footer = document.createElement('div');
    footer.textContent = buildStamp();
    footer.style.cssText = 'margin-top:auto;font-size:10px;letter-spacing:1px;opacity:0.4';
    this.root.appendChild(footer);

    container.appendChild(this.root);
    this.populate();
  }

  private label(text: string): HTMLDivElement {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.cssText = 'font-size:11px;letter-spacing:2px;opacity:0.6';
    return d;
  }

  /** Reflect the current config into the visible model/key fields for the chosen provider. */
  private populate(): void {
    const t = this.providerSel.value as ProviderType;
    if (t === 'openrouter') {
      this.modelInput.value = this.config.openrouterModel ?? '';
      this.keyInput.value = this.config.openrouterApiKey ?? '';
    } else if (t === 'openai') {
      this.modelInput.value = this.config.openaiModel ?? '';
      this.keyInput.value = this.config.openaiApiKey ?? '';
    } else {
      this.modelInput.value = '';
      this.keyInput.value = '';
    }
    const disabled = t === 'mock';
    this.modelInput.disabled = disabled;
    this.keyInput.disabled = disabled;
  }

  private syncFromFields(): void {
    this.populate();
  }

  private save(): void {
    const t = this.providerSel.value as ProviderType;
    const next: ProviderConfig = { ...this.config, type: t };
    if (t === 'openrouter') {
      next.openrouterModel = this.modelInput.value.trim() || undefined;
      next.openrouterApiKey = this.keyInput.value.trim() || undefined;
    } else if (t === 'openai') {
      next.openaiModel = this.modelInput.value.trim() || undefined;
      next.openaiApiKey = this.keyInput.value.trim() || undefined;
    }
    this.config = next;
    saveProviderConfig(next);
    this.onSave(next);
    this.status.textContent = `Saved — ${getProviderDisplayName(t)} active.`;
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.root.style.display = 'flex';
    this.providerSel.value = this.config.type;
    this.populate();
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.style.display = 'none';
  }

  isShown(): boolean {
    return this.shown;
  }

  /** Position the island over the GPU settings panel's interior (CSS px). */
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

function styleField(el: HTMLElement): void {
  el.style.cssText = [
    'width:100%', 'box-sizing:border-box', 'padding:8px 10px', 'font:inherit',
    'color:#e8e6f0', 'background:rgba(0,0,0,0.35)',
    'border:1px solid rgba(255,255,255,0.18)', 'border-radius:3px', 'outline:none',
  ].join(';');
}
