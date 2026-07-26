/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { GameUi, type GameUiCallbacks, type GameUiOptions } from '@/game/game-ui';

function callbacks(): GameUiCallbacks {
  return {
    onClickMinimapTile: () => {}, onGameSettingChange: () => {},
    onLLMConfigChange: () => {},
    onZoomIn: () => {}, onZoomOut: () => {}, onFitView: () => {}, onZoomActual: () => {}, onNewWorld: () => {},
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
    ui.destroy();
    ui = null;
    expect(container.childElementCount).toBe(before);
  }, 15000); // GameUi mounts the full panel tree synchronously (~5s in jsdom) — flakes against the 5s default

  // C5 — legacy narration-card gating: the barebones game (legacyChrome:false)
  // must never MOUNT the LLM narration card; ?legacyui (legacyChrome:true /
  // default) keeps it exactly as before. L2 retired its sibling, the DOM
  // attention panel — the inspector v2 is its GPU heir now.
  it('legacyChrome (default/?legacyui) mounts the narration card', () => {
    const u = mount({ legacyChrome: true });
    expect(u.llmDisplay).not.toBeNull();
    expect(container.querySelector('.sg-llm-overlay')).not.toBeNull();
  }, 15000);

  it('barebones (legacyChrome:false) never mounts the narration card; destroy() stays clean', () => {
    const u = mount({ legacyChrome: false });
    expect(u.llmDisplay).toBeNull();
    expect(container.querySelector('.sg-llm-overlay')).toBeNull(); // narration card DOM absent
    u.destroy();
    ui = null;
    expect(container.childElementCount).toBe(0);
  }, 15000);
});
