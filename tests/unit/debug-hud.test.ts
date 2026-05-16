import { describe, it, expect } from 'vitest';
import { formatDebugHud } from '@/ui/debug-hud';

describe('formatDebugHud', () => {
  it('renders the requested metrics', () => {
    const text = formatDebugHud({
      fps: 59.4,
      mouseTile: { x: 12, y: 7 },
      entityCount: 248,
      npcCount: 9,
      paused: false,
      zoom: 1.5,
    });
    expect(text).toContain('FPS 59');
    expect(text).toContain('tile 12,7');
    expect(text).toContain('entities 248');
    expect(text).toContain('npcs 9');
    expect(text).toContain('zoom 1.50');
    expect(text).toContain('running');
  });

  it('shows paused state', () => {
    const text = formatDebugHud({
      fps: 60, mouseTile: null, entityCount: 0, npcCount: 0,
      paused: true, zoom: 1,
    });
    expect(text).toContain('paused');
  });

  it('shows dash when mouse is off-map', () => {
    const text = formatDebugHud({
      fps: 60, mouseTile: null, entityCount: 0, npcCount: 0,
      paused: false, zoom: 1,
    });
    expect(text).toContain('tile -');
  });
});
