/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { GameUi, type GameUiCallbacks, type GameUiOptions } from '@/game/game-ui';
import { NpcAttentionStore } from '@/llm/npc-attention-store';

function callbacks(): GameUiCallbacks {
  return {
    onSelectRival: () => {}, onTargetNpc: () => {},
    onClickMinimapTile: () => {}, onGameSettingChange: () => {},
    onLLMConfigChange: () => {},
    onZoomIn: () => {}, onZoomOut: () => {}, onFitView: () => {}, onZoomActual: () => {}, onNewWorld: () => {},
    attentionStore: new NpcAttentionStore(), onWhisperSend: () => {},
    onMindOpen: () => {}, onMindCrossNav: () => {}, onCloseBuilding: () => {},
  };
}

describe('GameUi', () => {
  let ui: GameUi | null = null;
  let container: HTMLElement;
  afterEach(() => { ui?.destroy(); container?.remove(); ui = null; });

  function mount(opts?: GameUiOptions): GameUi {
    container = document.createElement('div');
    document.body.appendChild(container);
    ui = new GameUi(container, callbacks(), opts);
    return ui;
  }

  it('mounts panels into the container; exposes handles; destroy() removes them', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const before = container.childElementCount;
    ui = new GameUi(container, callbacks());
    expect(container.childElementCount).toBeGreaterThan(before);
    expect(ui.npcInfoPanel).toBeInstanceOf(HTMLDivElement);
    ui.destroy();
    ui = null;
    expect(container.childElementCount).toBe(before);
  }, 15000); // GameUi mounts the full panel tree synchronously (~5s in jsdom) — flakes against the 5s default

  // C5 — legacy whisper-chrome gating: the barebones game (legacyChrome:false)
  // must never MOUNT the attention panel or the LLM narration card; ?legacyui
  // (legacyChrome:true / default) keeps them exactly as before.
  it('legacyChrome (default/?legacyui) mounts the whisper chrome', () => {
    const u = mount({ legacyChrome: true });
    expect(u.npcAttentionPanel).not.toBeNull();
    expect(u.npcInfoPanel).toBeInstanceOf(HTMLDivElement);
    expect(u.llmDisplay).not.toBeNull();
    expect(container.querySelector('.sg-llm-overlay')).not.toBeNull();
  }, 15000);

  it('barebones (legacyChrome:false) never mounts the whisper chrome; destroy() stays clean', () => {
    const u = mount({ legacyChrome: false });
    expect(u.npcAttentionPanel).toBeNull();
    expect(u.npcInfoPanel).toBeNull();
    expect(u.llmDisplay).toBeNull();
    expect(container.querySelector('.sg-llm-overlay')).toBeNull(); // narration card DOM absent
    expect(container.querySelector('.sg-pin')).toBeNull();         // attention panel DOM absent
    u.destroy();
    ui = null;
    expect(container.childElementCount).toBe(0);
  }, 15000);
});
