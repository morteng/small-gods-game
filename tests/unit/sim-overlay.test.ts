import { describe, it, expect, beforeEach } from 'vitest';
import { drawNpcOverlay } from '@/render/sim-overlay';
import { createCamera } from '@/render/camera';
import type { NpcInstance, NpcSimState } from '@/core/types';

function makeNpc(): NpcInstance {
  return {
    id: 'alric',
    archetype: 'priest',
    spritePath: '',
    tileX: 10,
    tileY: 10,
    direction: 's',
    state: 'idle',
    animFrame: 0,
    animElapsed: 0,
    moveProgress: 0,
    homePoiId: null,
    homeBuildingId: null,
  } as unknown as NpcInstance;
}

function makeSim(): NpcSimState {
  return {
    npcId: 'alric',
    name: 'Brother Alric',
    role: 'priest',
    personality: { assertiveness: 0.5, skepticism: 0.5, piety: 0.7, sociability: 0.5 },
    beliefs: { player: { faith: 0.3, understanding: 0.2, devotion: 0.1 } },
    needs: { safety: 0.8, prosperity: 0.6, community: 0.5, meaning: 0.4 },
    mood: 0.6,
    recentEvents: [],
    whisperCooldown: 0,
    homePoiId: 'oakshire',
  } as unknown as NpcSimState;
}

describe('drawNpcOverlay', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    ctx = canvas.getContext('2d')!;
  });

  it('returns only the whisper hit area — info lives in the DOM panel now', () => {
    const hits = drawNpcOverlay(ctx, makeNpc(), makeSim(), createCamera(), 800, 600, 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].action).toBe('whisper');
  });

  it('whisper hit area is active when power is sufficient and not on cooldown', () => {
    const hits = drawNpcOverlay(ctx, makeNpc(), makeSim(), createCamera(), 800, 600, 5);
    expect(hits[0].active).toBe(true);
  });

  it('whisper is inactive when on cooldown', () => {
    const sim = makeSim();
    sim.whisperCooldown = 4;
    const hits = drawNpcOverlay(ctx, makeNpc(), sim, createCamera(), 800, 600, 5);
    expect(hits[0].active).toBe(false);
  });

  it('whisper is inactive when power is zero', () => {
    const hits = drawNpcOverlay(ctx, makeNpc(), makeSim(), createCamera(), 800, 600, 0);
    expect(hits[0].active).toBe(false);
  });
});
