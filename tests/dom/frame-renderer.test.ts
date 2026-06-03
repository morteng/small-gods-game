/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { FrameRenderer } from '@/game/frame-renderer';

describe('FrameRenderer', () => {
  it('render() no-ops when state.map is null', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const fr = new FrameRenderer({
      ctx,
      state: { map: null } as any,
      getRenderDeps: () => ({} as any),
      getViewport: () => ({ width: 100, height: 100 }),
      renderMap: () => null,
      isPaused: () => false,
      divine: { lastCastTime: -Infinity } as any,
      dev: { drawOverlays() {}, isEnabled: () => false, hitTest: () => ({ type: null }) } as any,
      llmBackfill: { trigger: async () => {} } as any,
      interaction: { overlayHitAreas: [], poiOverlay: null, hoverTile: null, hoverScreen: null } as any,
      ui: { minimap: {} as any, spiritHud: {} as any, divineEffects: {} as any, npcInfoPanel: document.createElement('div'), npcAttentionPanel: {} as any, tooltip: document.createElement('div'), debugHud: document.createElement('div') },
    });
    expect(() => fr.render(16)).not.toThrow();
  });
});
