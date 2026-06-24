import { describe, it, expect } from 'vitest';
import { causalSiteCardView } from '@/game/causal-site-view';
import type { CausalSite } from '@/world/causal-site';
import type { Spirit, SpiritId } from '@/core/spirit';

function site(over: Partial<CausalSite> = {}): CausalSite {
  return {
    id: 'causal:flood:0007', kind: 'flood', name: 'The Drowned Reach of Ironvein',
    pos: { x: 10, y: 12 }, cells: Int32Array.from([0, 1, 2]),
    cause: 'player', bornTick: 0, lifeTicks: 30, ageTicks: 0, intensity: 0.6,
    ...over,
  } as CausalSite;
}

const spirits = new Map<SpiritId, Spirit>([
  ['khoth' as SpiritId, { name: 'Khoth' } as Spirit],
]);

describe('causalSiteCardView — sim CausalSite → card payload', () => {
  it('attributes a player-caused site to "By your hand"', () => {
    expect(causalSiteCardView(site({ cause: 'player' }), spirits).subtitle).toBe('By your hand');
  });

  it('attributes a nature-caused site to "A work of nature"', () => {
    expect(causalSiteCardView(site({ cause: 'nature' }), spirits).subtitle).toBe('A work of nature');
  });

  it('names a rival-spirit cause from the spirits map', () => {
    expect(causalSiteCardView(site({ cause: 'khoth' }), spirits).subtitle).toBe('By Khoth');
  });

  it('reports "Standing water" while the flood still covers it (ageTicks 0)', () => {
    expect(causalSiteCardView(site({ ageTicks: 0 }), spirits).status).toBe('Standing water');
  });

  it('reports a fading countdown once the cause is gone', () => {
    expect(causalSiteCardView(site({ ageTicks: 18, lifeTicks: 30 }), spirits).status).toBe('Fading — 12s left');
  });

  it('clamps intensity into 0..1', () => {
    expect(causalSiteCardView(site({ intensity: 1.4 }), spirits).intensity).toBe(1);
    expect(causalSiteCardView(site({ intensity: -0.2 }), spirits).intensity).toBe(0);
  });
});
