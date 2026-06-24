/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { GameUi } from '@/game/game-ui';
import { NpcAttentionStore } from '@/llm/npc-attention-store';

describe('GameUi', () => {
  let ui: GameUi | null = null;
  let container: HTMLElement;
  afterEach(() => { ui?.destroy(); container?.remove(); ui = null; });

  it('mounts panels into the container; exposes handles; destroy() removes them', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const before = container.childElementCount;
    ui = new GameUi(container, {
      onSelectRival: () => {}, onTargetNpc: () => {},
      onClickMinimapTile: () => {}, onGameSettingChange: () => {},
      onLLMConfigChange: () => {},
      onZoomIn: () => {}, onZoomOut: () => {}, onFitView: () => {}, onZoomActual: () => {}, onNewWorld: () => {},
      attentionStore: new NpcAttentionStore(), onWhisperSend: () => {},
      onMindOpen: () => {}, onMindCrossNav: () => {}, onCloseBuilding: () => {},
    });
    expect(container.childElementCount).toBeGreaterThan(before);
    expect(ui.npcInfoPanel).toBeInstanceOf(HTMLDivElement);
    ui.destroy();
    ui = null;
    expect(container.childElementCount).toBe(before);
  }, 15000); // GameUi mounts the full panel tree synchronously (~5s in jsdom) — flakes against the 5s default
});
