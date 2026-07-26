import { DivineEffects } from '@/render/divine-effects';

/**
 * Owns the gameplay UI handles + raw DOM panels that remain after UI v3's
 * legacy-chrome retirement (P6). Constructs them, exposes them as readonly
 * fields, and disposes them in destroy().
 *
 * L6 (legacy chrome retirement, the final commit) removed the LAST
 * `?legacyui`-only surfaces this class ever mounted:
 *  - the paused banner — its only mutator, `Game.refreshPauseBanner`, always
 *    early-returned in the shipped (barebones) game; the WebGPU pause menu's
 *    "behind glass" dim is the real, live pause tell;
 *  - the Spirit HUD (`spirit-hud.ts`, deleted) — the pantheon panel +
 *    presence orb are its GPU heirs;
 *  - the unified-settings DOM chain (`settings-unified.ts`/
 *    `llm-settings-new.ts`/`model-picker.ts`, deleted) + its own
 *    `llmSettingsBtn` trigger — confirmed before deletion that the GPU
 *    `SettingsIsland` (the settings screen's Gameplay-tab provider/model/key
 *    form) is a from-scratch, independent surface, never a wrapper around
 *    them;
 *  - the New World button (`newWorldBtn`) — `Game.newWorld()` is ALSO wired
 *    straight from the GPU pause menu / the `new_game` meta verb, so this
 *    DOM trigger was a redundant second path to the same call;
 *  - DOM camera controls (zoom in/out/fit) — the GPU camera cluster already
 *    drives the SAME `Game.cameraZoomIn/Out/FitView/ZoomActual` methods
 *    independently, and this class always destroyed its own copy in the same
 *    synchronous tick it built it (construct-then-immediately-destroy is
 *    provably identical to never constructing at all), so the call is gone.
 *
 * `bottomLeftBar` stays (now empty of GameUi-owned buttons) as the mount
 * point `Game` uses for `spend-chip.ts` — a real, still-live feature this
 * pass does not touch, so it is flagged here rather than silently kept: the
 * bar has been permanently hidden since barebones became the game's only
 * mode, and nothing in this pass gives it a new, visible home. `debugHud`
 * and `tooltip` likewise stay DOM on purpose — `?dev`'s own surfaces.
 */
export class GameUi {
  readonly debugHud: HTMLDivElement;
  readonly tooltip: HTMLDivElement;
  readonly divineEffects = new DivineEffects();
  readonly bottomLeftBar: HTMLElement;

  constructor(container: HTMLElement) {
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

    // The DOM loading overlay is GONE (UI v3 P1): boot progress draws on the
    // WebGPU shell (`src/render/ui/shell/loading-screen.ts`). It used to be
    // mounted unconditionally here — an opaque, z-index:100, inset:0 div that in
    // shell mode nothing ever hid, so it sat over the title screen forever.
    // Nothing may mount a second progress surface: there is exactly one, and the
    // Shell owns it. Pinned by `tests/unit/no-dom-loading-screen.test.ts`.

    // Bottom-left toolbar — now just the mount point `Game` uses for the
    // spend chip (see the class doc). Starts hidden; nothing un-hides it.
    this.bottomLeftBar = document.createElement('div');
    this.bottomLeftBar.style.cssText = 'position:absolute;bottom:8px;left:8px;z-index:10;display:none;gap:8px;align-items:center;';
    container.appendChild(this.bottomLeftBar);
  }

  destroy(): void {
    this.debugHud.remove();
    this.tooltip.remove();
    this.bottomLeftBar.remove();
  }
}
