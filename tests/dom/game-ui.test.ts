/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { GameUi } from '@/game/game-ui';

describe('GameUi', () => {
  let ui: GameUi | null = null;
  let container: HTMLElement;
  afterEach(() => { ui?.destroy(); container?.remove(); ui = null; });

  it('mounts panels into the container; exposes handles; destroy() removes them', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const before = container.childElementCount;
    ui = new GameUi(container, {
      onStart: () => {}, onSelectRival: () => {}, onTargetNpc: () => {},
      onClickMinimapTile: () => {}, onGameSettingChange: () => {},
      onLLMConfigChange: () => {},
      onZoomIn: () => {}, onZoomOut: () => {}, onFitView: () => {},
    });
    expect(container.childElementCount).toBeGreaterThan(before);
    expect(ui.npcInfoPanel).toBeInstanceOf(HTMLDivElement);
    const after = container.childElementCount;
    ui.destroy();
    ui = null;
    expect(container.childElementCount).toBe(before);
  });
});
