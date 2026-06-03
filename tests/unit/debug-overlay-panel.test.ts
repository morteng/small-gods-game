import { describe, it, expect, beforeEach } from 'vitest';
import { mountDebugOverlayPanel } from '@/dev/DebugOverlayPanel';
import { RENDER_LAYERS, layerFlag } from '@/render/layer-visibility';
import type { DevModeState } from '@/core/types';

function freshDevMode(): DevModeState {
  return {
    enabled: true, selected: null, clipboard: null,
    undoStack: [], redoStack: [], activeTool: 'select',
  };
}

/** Find the checkbox whose label text contains `needle`. */
function checkboxFor(root: HTMLElement, needle: string): HTMLInputElement {
  const labels = Array.from(root.querySelectorAll('label'));
  const lbl = labels.find(l => l.textContent?.includes(needle));
  if (!lbl) throw new Error(`no toggle labelled "${needle}"`);
  return lbl.querySelector('input[type=checkbox]') as HTMLInputElement;
}

describe('DebugOverlayPanel — render layer toggles', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders a checkbox for every render layer', () => {
    const panel = mountDebugOverlayPanel(container);
    const labels = ['Terrain', 'Roads', 'Rivers', 'NPCs', 'Buildings', 'Vegetation', 'Props', 'Terrain Features', 'Decorations', 'Remains'];
    for (const label of labels) {
      expect(() => checkboxFor(panel.element, label)).not.toThrow();
    }
  });

  it('layer toggles default to checked (shown) for a fresh devMode', () => {
    const panel = mountDebugOverlayPanel(container);
    panel.update(freshDevMode());
    expect(checkboxFor(panel.element, 'NPCs').checked).toBe(true);
    expect(checkboxFor(panel.element, 'Buildings').checked).toBe(true);
  });

  it('unchecking a layer sets its flag to false on the devMode', () => {
    const panel = mountDebugOverlayPanel(container);
    const dm = freshDevMode();
    panel.update(dm);

    const npcs = checkboxFor(panel.element, 'NPCs');
    npcs.checked = false;
    npcs.dispatchEvent(new Event('change'));

    expect(dm.showNpcs).toBe(false);
  });

  it('reflects an explicit false flag as an unchecked box', () => {
    const panel = mountDebugOverlayPanel(container);
    const dm = freshDevMode();
    dm.showBuildings = false;
    panel.update(dm);
    expect(checkboxFor(panel.element, 'Buildings').checked).toBe(false);
  });

  it('reset restores every render layer to shown (true)', () => {
    const panel = mountDebugOverlayPanel(container);
    const dm = freshDevMode();
    for (const layer of RENDER_LAYERS) dm[layerFlag(layer)] = false;
    panel.update(dm);

    const resetBtn = Array.from(panel.element.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Reset'))!;
    resetBtn.dispatchEvent(new Event('click'));

    for (const layer of RENDER_LAYERS) {
      expect(dm[layerFlag(layer)]).toBe(true);
    }
    expect(checkboxFor(panel.element, 'Vegetation').checked).toBe(true);
  });
});
