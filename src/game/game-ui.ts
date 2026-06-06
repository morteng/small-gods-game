import { createLlmDisplay, type LlmDisplayHandle } from '@/ui/llm-display';
import { createSettingsPanel as createUnifiedSettings, type SettingsHandle } from '@/ui/settings-unified';
import { createMainMenu, type MainMenuHandle } from '@/ui/main-menu';
import { createTutorial, type TutorialHandle } from '@/ui/tutorial';
import { createSpiritHud, type SpiritHudHandle } from '@/ui/spirit-hud';
import { createRivalPanel, type RivalPanelHandle } from '@/ui/rival-panel';
import { createMinimapPanel, type MinimapHandle } from '@/ui/minimap-panel';
import { createCameraControls, type CameraControlsHandle } from '@/ui/camera-controls';
import { DivineEffects } from '@/render/divine-effects';
import {
  createDecorationPlacementModal,
  type DecorationPlacementModalHandle,
} from '@/ui/decoration-placement-modal';
import type { ProviderConfig } from '@/llm/provider-factory';
import { mountNpcAttentionPanel, type NpcAttentionPanelHandle } from '@/ui/npc-attention-panel';
import type { NpcAttentionStore } from '@/llm/npc-attention-store';

export interface GameUiCallbacks {
  onStart: () => void;
  onSelectRival: (rivalId: string) => void;
  onTargetNpc: (npcId: string) => void;
  onClickMinimapTile: (x: number, y: number) => void;
  onGameSettingChange: (key: string, value: unknown) => void;
  onLLMConfigChange: (config: ProviderConfig) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onNewWorld: () => void;
  attentionStore: NpcAttentionStore;
  onWhisperSend: (npcId: string, text: string) => void;
  onMindOpen: (npcId: string, path: string[], depth: number) => void;
  onMindCrossNav: (entityId: string) => void;
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
  readonly npcAttentionPanel: NpcAttentionPanelHandle;
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
  readonly newWorldBtn: HTMLButtonElement;
  readonly bottomLeftBar: HTMLElement;
  readonly placementModal: DecorationPlacementModalHandle;
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

    this.npcInfoPanel = document.createElement('div');
    this.npcInfoPanel.className = 'sg-scroll';
    this.npcInfoPanel.style.cssText = [
      'position:absolute', 'top:14px', 'right:14px', 'width:400px',
      'max-height:calc(100% - 28px)', 'overflow-y:auto',
      'padding:16px 18px', 'background:var(--shade)',
      'backdrop-filter:blur(10px)', '-webkit-backdrop-filter:blur(10px)',
      'border:1px solid var(--line)', 'border-radius:var(--r-4)',
      'box-shadow:var(--lift-2)',
      'color:var(--ink)', 'pointer-events:auto', 'display:none', 'z-index:21',
      'box-sizing:border-box',
    ].join(';');
    container.appendChild(this.npcInfoPanel);
    this.npcAttentionPanel = mountNpcAttentionPanel(this.npcInfoPanel, {
      onWhisperSend: cb.onWhisperSend,
      onMindOpen: cb.onMindOpen,
      onMindCrossNav: cb.onMindCrossNav,
    });

    // LLM display (shows dialogue/narration from LLM backfill)
    this.llmDisplay = createLlmDisplay(container, {
      onClose: () => {
        // Optional: do something when LLM display is closed
      },
    });

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
      onClose: () => this.rivalPanel.hide(),
      onTargetNpc: (npcId) => cb.onTargetNpc(npcId),
    });
    this.rivalPanel.hide(); // Hidden until a rival is selected (no rivals in single-god slice)

    // ── NEW: Minimap ──────────────────────────────────────
    this.minimap = createMinimapPanel(container, {
      onToggle: (visible) => {
        console.log('[minimap] visible:', visible);
      },
      onClickTile: (x, y) => cb.onClickMinimapTile(x, y),
    });

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

    this.placementModal = createDecorationPlacementModal(container);

    // ── Camera controls (zoom in/out/fit) ─────────────────
    this.cameraControls = createCameraControls(container, {
      onZoomIn: () => cb.onZoomIn(),
      onZoomOut: () => cb.onZoomOut(),
      onFitView: () => cb.onFitView(),
    });
  }

  destroy(): void {
    this.pausedBanner.remove();
    this.debugHud.remove();
    this.npcAttentionPanel.destroy();
    this.npcInfoPanel.remove();
    this.tooltip.remove();
    this.bottomLeftBar.remove();
    this.mainMenu.destroy();
    this.spiritHud.destroy();
    this.rivalPanel.destroy();
    this.minimap.destroy();
    this.cameraControls.destroy();
    this.tutorial.destroy();
    this.unifiedSettings.destroy();
    this.placementModal.destroy();
    this.llmDisplay.destroy();
  }
}
