/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DevModeController } from '@/game/dev-mode-controller';
import { createState } from '@/core/state';
import { Scheduler } from '@/core/scheduler';
import { World } from '@/world/world';
import { CommandQueue } from '@/sim/command/command-queue';
import type { GameMap, Tile, HitResult } from '@/core/types';

function makeMap(w = 5, h = 5): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function makeWorld() {
  return new World(makeMap());
}

describe('DevModeController.applyInspectorEdit', () => {
  let container: HTMLElement;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => container?.remove());

  it('persists an entity x/y edit through World.updateEntity and records undo', () => {
    const state = createState();
    const world = makeWorld();
    world.addEntity({ id: 'e1', kind: 'rock', x: 1, y: 1, properties: {}, tags: [] } as any);
    state.world = world;
    let ctrl!: DevModeController;
    ctrl = new DevModeController({
      container, state, scheduler: new Scheduler(),
      getViewport: () => ({ width: 800, height: 600 }),
      getRenderDeps: () => ({ state, viewport: { width: 800, height: 600 }, sheets: new Map(), assets: {} as any, decorationImages: {} as any, devMode: ctrl.devMode }) as any,
      commandQueue: new CommandQueue(),
      getLlmCapable: () => null,
    });
    // The unified Inspector is mounted (single .sg-dev-panel for it).
    expect(container.querySelector('.sg-dev-panel')).not.toBeNull();
    // The dev toolbar is mounted but hidden until dev mode is enabled.
    const toolbar = container.querySelector<HTMLElement>('.sg-dev-toolbar');
    expect(toolbar).not.toBeNull();
    expect(toolbar!.style.display).toBe('none');
    // Enabling dev mode shows the toolbar.
    ctrl.toggle();
    expect(container.querySelector<HTMLElement>('.sg-dev-toolbar')!.style.display).not.toBe('none');
    const entity = world.query({}).find(e => e.id === 'e1')!;
    const hit: HitResult = { type: 'entity', tileX: 1, tileY: 1, entity };
    ctrl.devMode.selected = hit;
    ctrl.applyInspectorEdit(hit, 'x', 7);
    expect(world.query({}).find(e => e.id === 'e1')!.x).toBe(7);
    expect(ctrl.devMode.undoStack.length).toBe(1);
    ctrl.destroy();
  });

  it('exposes updateInspector() and selects via right-click hit', () => {
    const state = createState();
    const world = makeWorld();
    world.addEntity({ id: 'e1', kind: 'rock', x: 1, y: 1, properties: {}, tags: [] } as any);
    state.world = world;
    let ctrl!: DevModeController;
    ctrl = new DevModeController({
      container, state, scheduler: new Scheduler(),
      getViewport: () => ({ width: 800, height: 600 }),
      getRenderDeps: () => ({ state, viewport: { width: 800, height: 600 }, sheets: new Map(), assets: {} as any, decorationImages: {} as any, devMode: ctrl.devMode }) as any,
      commandQueue: new CommandQueue(),
      getLlmCapable: () => null,
    });
    expect(typeof ctrl.updateInspector).toBe('function');
    // Selecting a hit through the inspector handle should not throw.
    const entity = world.query({}).find(e => e.id === 'e1')!;
    const hit: HitResult = { type: 'entity', tileX: 1, tileY: 1, entity };
    ctrl.devMode.selected = hit;
    expect(() => ctrl.updateInspector()).not.toThrow();
    ctrl.destroy();
  });
});
