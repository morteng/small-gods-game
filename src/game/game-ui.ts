import { createLlmDisplay, type LlmDisplayHandle } from '@/ui/llm-display';
import { createSettingsPanel as createUnifiedSettings, type SettingsHandle } from '@/ui/settings-unified';
import { createMainMenu, type MainMenuHandle } from '@/ui/main-menu';
import { createTutorial, type TutorialHandle } from '@/ui/tutorial';
import { createSpiritHud, type SpiritHudHandle } from '@/ui/spirit-hud';
import { createRivalPanel, type RivalPanelHandle } from '@/ui/rival-panel';
import { createMinimapPanel, type MinimapHandle } from '@/ui/minimap-panel';
import { DivineEffects } from '@/render/divine-effects';
import {
  createDecorationPlacementModal,
  type DecorationPlacementModalHandle,
} from '@/ui/decoration-placement-modal';

export interface GameUiCallbacks {
  onStart: () => void;
  onSelectRival: (rivalId: string) => void;
  onTargetNpc: (npcId: string) => void;
  onClickMinimapTile: (x: number, y: number) => void;
  onGameSettingChange: (key: string, value: unknown) => void;
}

/**
 * Owns the gameplay UI handles + raw DOM panels. Constructs them, exposes them
 * as readonly fields, and disposes them in destroy(). Game-semantic callbacks
 * (world gen, rival selection, camera, settings mutation) are injected via the
 * GameUiCallbacks bag; self-contained callbacks (logging, localStorage) stay here.
 */
export class GameUi {
  readonly pausedBanner: HTMLDivElement;
  readonly debugHud: HTMLDivElement;
  readonly npcInfoPanel: HTMLDivElement;
  readonly tooltip: HTMLDivElement;
  readonly llmDisplay: LlmDisplayHandle;
  readonly unifiedSettings: SettingsHandle;
  readonly mainMenu: MainMenuHandle;
  readonly tutorial: TutorialHandle;
  readonly spiritHud: SpiritHudHandle;
  readonly rivalPanel: RivalPanelHandle;
  readonly minimap: MinimapHandle;
  readonly divineEffects = new DivineEffects();
  readonly llmSettingsBtn: HTMLButtonElement;
  readonly placementModal: DecorationPlacementModalHandle;

  constructor(container: HTMLElement, cb: GameUiCallbacks) {
    this.pausedBanner = document.createElement('div');
    this.pausedBanner.textContent = 'PAUSED';
    this.pausedBanner.style.cssText = [
      'position:absolute', 'top:12px', 'left:50%', 'transform:translateX(-50%)',
      'padding:6px 14px', 'background:rgba(0,0,0,0.65)', 'color:#fff',
      'font:bold 14px sans-serif', 'letter-spacing:2px', 'border-radius:4px',
      'pointer-events:none', 'display:none', 'z-index:10',
    ].join(';');
    container.appendChild(this.pausedBanner);

    this.debugHud = document.createElement('div');
    this.debugHud.style.cssText = [
      'position:absolute', 'top:8px', 'right:8px',
      'padding:4px 8px', 'background:rgba(0,0,0,0.6)', 'color:#9fd8ff',
      'font:11px ui-monospace,monospace', 'border-radius:3px',
      'pointer-events:none', 'display:none', 'z-index:10',
      'white-space:nowrap',
    ].join(';');
    container.appendChild(this.debugHud);

    this.npcInfoPanel = document.createElement('div');
    this.npcInfoPanel.style.cssText = [
      'position:absolute', 'top:8px', 'left:8px', 'width:220px',
      'padding:10px 12px', 'background:rgba(10,10,20,0.88)',
      'border:1px solid rgba(255,255,255,0.18)', 'border-radius:6px',
      'color:#fff', 'pointer-events:none', 'display:none', 'z-index:10',
      'box-sizing:border-box',
    ].join(';');
    container.appendChild(this.npcInfoPanel);

    // LLM display (shows dialogue/narration from LLM backfill)
    this.llmDisplay = createLlmDisplay(container, {
      onClose: () => {
        // Optional: do something when LLM display is closed
      },
    });

    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = [
      'position:absolute', 'padding:3px 8px',
      'background:rgba(10,10,20,0.85)', 'color:#fff',
      'font:11px sans-serif', 'border-radius:3px',
      'pointer-events:none', 'display:none', 'z-index:11',
      'white-space:nowrap', 'transform:translate(12px, 12px)',
    ].join(';');
    container.appendChild(this.tooltip);

    // ── Unified Settings (replaces old settings) ────────────
    this.unifiedSettings = createUnifiedSettings(container, {
      onClose: () => { /* handle close */ },
      onLLMConfigChange: (config) => {
        // Update LLM client config
        console.log('[settings] LLM config changed:', config);
      },
      onGameSettingChange: (key, value) => cb.onGameSettingChange(key, value),
    });

    // ── NEW: Main Menu ────────────────────────────────────
    this.mainMenu = createMainMenu(container, {
      onStart: () => cb.onStart(),
      onSettings: () => this.unifiedSettings.toggle(),
      version: '1.0.0',
    });

    // ── NEW: Tutorial System ──────────────────────────────
    this.tutorial = createTutorial(container, {
      onComplete: () => {
        localStorage.setItem('small-gods-tutorial-seen', 'true');
        console.log('[tutorial] Completed');
      },
      onSkip: () => {
        localStorage.setItem('small-gods-tutorial-seen', 'true');
        console.log('[tutorial] Skipped');
      },
    });

    // ── NEW: Spirit HUD ───────────────────────────────────
    this.spiritHud = createSpiritHud(container, {
      onSelectRival: (rivalId) => cb.onSelectRival(rivalId),
    });
    this.spiritHud.hide(); // Hidden until world gen

    // ── NEW: Rival Panel ───────────────────────────────────
    this.rivalPanel = createRivalPanel(container, {
      onClose: () => { /* panel handles hide internally */ },
      onTargetNpc: (npcId) => cb.onTargetNpc(npcId),
    });

    // ── NEW: Minimap ──────────────────────────────────────
    this.minimap = createMinimapPanel(container, {
      onToggle: (visible) => {
        console.log('[minimap] visible:', visible);
      },
      onClickTile: (x, y) => cb.onClickMinimapTile(x, y),
    });

    // LLM settings button
    this.llmSettingsBtn = document.createElement('button');
    this.llmSettingsBtn.textContent = '⚙ LLM';
    this.llmSettingsBtn.style.cssText = [
      'position:absolute', 'bottom:8px', 'left:8px',
      'background:rgba(10,10,20,0.75)', 'color:#9ea0aa', 'border:none',
      'cursor:pointer', 'z-index:10',
    ].join(';');
    this.llmSettingsBtn.addEventListener('click', () => {
      this.unifiedSettings.toggle();
    });
    container.appendChild(this.llmSettingsBtn);

    this.placementModal = createDecorationPlacementModal(container);
  }

  destroy(): void {
    this.pausedBanner.remove();
    this.debugHud.remove();
    this.npcInfoPanel.remove();
    this.tooltip.remove();
    this.llmSettingsBtn.remove();
    this.mainMenu.destroy();
    this.spiritHud.destroy();
    this.rivalPanel.destroy();
    this.minimap.destroy();
    this.tutorial.destroy();
    this.unifiedSettings.destroy();
    this.placementModal.destroy();
    this.llmDisplay.destroy();
  }
}
