/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { GameUi, type GameUiCallbacks } from '@/game/game-ui';

function callbacks(): GameUiCallbacks {
  return {
    onGameSettingChange: () => {},
    onLLMConfigChange: () => {},
    onZoomIn: () => {}, onZoomOut: () => {}, onFitView: () => {}, onZoomActual: () => {}, onNewWorld: () => {},
  };
}

describe('GameUi', () => {
  let ui: GameUi | null = null;
  let container: HTMLElement;
  afterEach(() => { ui?.destroy(); container?.remove(); ui = null; });

  it('mounts panels into the container; exposes handles; destroy() removes them', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const before = container.childElementCount;
    ui = new GameUi(container, callbacks());
    expect(container.childElementCount).toBeGreaterThan(before);
    // L4: the DOM LLM narration card is gone — `UiRuntime.showNarrationCard`
    // is its GPU heir, so GameUi mounts no narration-card DOM at all now.
    expect(container.querySelector('.sg-llm-overlay')).toBeNull();
    ui.destroy();
    ui = null;
    expect(container.childElementCount).toBe(before);
  }, 15000); // GameUi mounts the full panel tree synchronously (~5s in jsdom) — flakes against the 5s default
});
