import { createSettingsPanel as createUnifiedSettings, type SettingsHandle } from '@/ui/settings-unified';
import { createSpiritHud, type SpiritHudHandle } from '@/ui/spirit-hud';
import { createCameraControls, type CameraControlsHandle } from '@/ui/camera-controls';
import { DivineEffects } from '@/render/divine-effects';
import type { ProviderConfig } from '@/llm/provider-factory';

export interface GameUiCallbacks {
  onGameSettingChange: (key: string, value: unknown) => void;
  onLLMConfigChange: (config: ProviderConfig) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onZoomActual: () => void;
  onNewWorld: () => void;
}

/**
 * Owns the gameplay UI handles + raw DOM panels. Constructs them, exposes them
 * as readonly fields, and disposes them in destroy(). Game-semantic callbacks
 * (world gen, rival selection, camera, settings mutation) are injected via the
 * GameUiCallbacks bag; self-contained callbacks (logging, localStorage) stay here.
 *
 * L4 (legacy chrome retirement) retired the last `legacyChrome`-gated
 * construction this class did — the DOM LLM narration card (its GPU heir is
 * `UiRuntime.showNarrationCard`) — so there is nothing left for a
 * `GameUiOptions` bag to carry; the remaining `legacyChrome` seams
 * (`Game.barebones`, `FrameRenderer.legacyChrome`, `?legacyui` itself) are
 * unrelated to this class and die together in L6.
 */
export class GameUi {
  readonly pausedBanner: HTMLDivElement;
  readonly debugHud: HTMLDivElement;
  readonly tooltip: HTMLDivElement;
  readonly unifiedSettings: SettingsHandle;
  readonly spiritHud: SpiritHudHandle;
  readonly divineEffects = new DivineEffects();
  readonly llmSettingsBtn: HTMLButtonElement;
  readonly newWorldBtn: HTMLButtonElement;
  readonly bottomLeftBar: HTMLElement;
  readonly cameraControls: CameraControlsHandle;

  constructor(container: HTMLElement, cb: GameUiCallbacks) {
    this.pausedBanner = document.createElement('div');
    this.pausedBanner.textContent = 'PAUSED';
    this.pausedBanner.style.cssText = [
      'position:absolute', 'top:64px', 'left:50%', 'transform:translateX(-50%)',
      'padding:8px 18px', 'background:var(--shade)',
      'backdrop-filter:blur(8px)', '-webkit-backdrop-filter:blur(8px)',
      'border:1px solid var(--line)', 'box-shadow:var(--lift-1)',
      'color:var(--ink)', 'font-family:var(--f-sans)',
      'font-weight:700', 'font-size:var(--t-md)', 'letter-spacing:2px',
      'border-radius:var(--r-pill)',
      'pointer-events:none', 'display:none', 'z-index:10',
    ].join(';');
    container.appendChild(this.pausedBanner);

    this.debugHud = document.createElement('div');
    this.debugHud.style.cssText = [
      'position:absolute', 'top:8px', 'left:8px',
      'padding:5px 9px', 'background:var(--shade)',
      'border:1px solid var(--line)', 'color:var(--time)',
      'font-family:var(--f-mono)', 'font-size:var(--t-tiny)',
      'border-radius:var(--r-2)',
      'pointer-events:none', 'display:none', 'z-index:10',
      'white-space:nowrap',
    ].join(';');
    container.appendChild(this.debugHud);

    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = [
      'position:absolute', 'padding:5px 10px',
      'background:var(--shade)', 'backdrop-filter:blur(8px)',
      '-webkit-backdrop-filter:blur(8px)',
      'border:1px solid var(--line)', 'box-shadow:var(--lift-1)',
      'color:var(--ink)', 'font-family:var(--f-sans)', 'font-size:var(--t-small)',
      'border-radius:var(--r-2)',
      'pointer-events:none', 'display:none', 'z-index:11',
      'white-space:nowrap', 'transform:translate(12px, 12px)',
    ].join(';');
    container.appendChild(this.tooltip);

    // ── Unified Settings (replaces old settings) ────────────
    this.unifiedSettings = createUnifiedSettings(container, {
      onClose: () => { /* handle close */ },
      onLLMConfigChange: (config) => cb.onLLMConfigChange(config),
      onGameSettingChange: (key, value) => cb.onGameSettingChange(key, value),
    });

    // The DOM loading overlay is GONE (UI v3 P1): boot progress draws on the
    // WebGPU shell (`src/render/ui/shell/loading-screen.ts`). It used to be
    // mounted unconditionally here — an opaque, z-index:100, inset:0 div that in
    // shell mode nothing ever hid, so it sat over the title screen forever.
    // Nothing may mount a second progress surface: there is exactly one, and the
    // Shell owns it. Pinned by `tests/unit/no-dom-loading-screen.test.ts`.

    // ── NEW: Spirit HUD ───────────────────────────────────
    // L3: the rival chip's click used to open the DOM rival-panel (below,
    // now deleted) — the pantheon panel (`onPantheonRow`) is its GPU heir, so
    // there is nothing left for this DOM HUD's own rival click to do.
    this.spiritHud = createSpiritHud(container, {});
    this.spiritHud.hide(); // Hidden until world gen

    // Bottom-left toolbar — contains LLM settings button, New World button, and spend chip.
    this.bottomLeftBar = document.createElement('div');
    this.bottomLeftBar.style.cssText = 'position:absolute;bottom:8px;left:8px;z-index:10;display:flex;gap:8px;align-items:center;';
    container.appendChild(this.bottomLeftBar);

    // LLM settings button
    this.llmSettingsBtn = document.createElement('button');
    this.llmSettingsBtn.textContent = '⚙ LLM';
    this.llmSettingsBtn.className = 'sg-btn sg-btn--ghost';
    this.llmSettingsBtn.title = 'Settings — choose your LLM provider and model for narrating mortal minds.';
    this.llmSettingsBtn.addEventListener('click', () => {
      this.unifiedSettings.toggle();
    });
    this.bottomLeftBar.appendChild(this.llmSettingsBtn);

    // New World button — abandons the autosaved game and starts fresh.
    this.newWorldBtn = document.createElement('button');
    this.newWorldBtn.textContent = '✦ New World';
    this.newWorldBtn.className = 'sg-btn sg-btn--ghost';
    this.newWorldBtn.title = 'New World — abandon the current game and regenerate a fresh world.';
    this.newWorldBtn.addEventListener('click', () => {
      if (window.confirm('Start a new world? This abandons your current game.')) cb.onNewWorld();
    });
    this.bottomLeftBar.appendChild(this.newWorldBtn);

    // ── Camera controls (zoom in/out/fit) ─────────────────
    this.cameraControls = createCameraControls(container, {
      onZoomIn: () => cb.onZoomIn(),
      onZoomOut: () => cb.onZoomOut(),
      onFitView: () => cb.onFitView(),
      onZoomActual: () => cb.onZoomActual(),
    });
  }

  /**
   * Barebones cleanup: the WebGPU HUD + pause menu are the only chrome, so tear
   * down every persistent legacy DOM panel here (one place — DRY). The
   * on-demand power pill is suppressed at its render site via
   * `FrameRenderer.legacyChrome`; this handles the always-mounted ones.
   */
  suppressLegacyChrome(): void {
    this.pausedBanner.style.display = 'none';
    this.debugHud.style.display = 'none';
    this.spiritHud.hide();
    this.tooltip.style.display = 'none';
    this.bottomLeftBar.style.display = 'none';
    this.cameraControls.destroy();
  }

  destroy(): void {
    this.pausedBanner.remove();
    this.debugHud.remove();
    this.tooltip.remove();
    this.bottomLeftBar.remove();
    this.spiritHud.destroy();
    this.cameraControls.destroy();
    this.unifiedSettings.destroy();
  }
}
