import type { DevModeState, DebugOverlayOptions } from '@/core/types';
import type { SpiritId } from '@/core/spirit';
import { DEFAULT_DEBUG_OVERLAY_OPTIONS } from '@/render/debug-overlays';
import { createFloatingPanel } from '@/dev/FloatingPanel';
import type { DockManager } from '@/dev/dock-manager';

export interface DebugOverlayPanelHandle {
  element: HTMLElement;
  update(devMode: DevModeState): void;
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  destroy(): void;
}

/**
 * Mount the debug overlay control panel.
 * Provides toggles for belief heatmap, needs, mood, social connections, etc.
 */
export function mountDebugOverlayPanel(container: HTMLElement, deps: { dock?: DockManager } = {}): DebugOverlayPanelHandle {
  const fp = createFloatingPanel({ container, id: 'overlay', title: '🎨 Debug Overlays', dock: deps.dock, width: 260, anchor: { top: '60px', left: '10px' } });
  const body = fp.body;

  // Checkbox section
  const checkboxArea = document.createElement('div');
  checkboxArea.style.cssText = 'display:flex; flex-direction:column; gap:6px; margin-bottom:10px;';
  body.appendChild(checkboxArea);

  // Slider section
  const sliderArea = document.createElement('div');
  sliderArea.style.cssText = 'margin-top:8px; padding-top:8px; border-top:1px solid #444;';
  body.appendChild(sliderArea);

  // Spirit selector
  const spiritArea = document.createElement('div');
  spiritArea.style.cssText = 'margin-top:8px; padding-top:8px; border-top:1px solid #444;';
  body.appendChild(spiritArea);

  let currentDevMode: DevModeState | null = null;

  function createToggle(
    label: string,
    getVal: (opts: DebugOverlayOptions) => boolean,
    setVal: (devMode: DevModeState, value: boolean) => void,
  ): HTMLInputElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex; align-items:center; gap:6px;';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.style.cssText = 'margin:0; cursor:pointer;';

    const lbl = document.createElement('label');
    lbl.style.cssText = 'cursor:pointer; font-size:11px;';
    lbl.textContent = label;

    checkbox.addEventListener('change', () => {
      if (currentDevMode) {
        setVal(currentDevMode, checkbox.checked);
      }
    });

    wrapper.appendChild(checkbox);
    wrapper.appendChild(lbl);
    checkboxArea.appendChild(wrapper);

    return checkbox;
  }

  // Create toggles
  const beliefToggle = createToggle(
    '📊 Belief Heatmap',
    (o) => o.showBeliefHeatmap,
    (dm, v) => { dm.showBeliefHeatmap = v; },
  );

  const needsToggle = createToggle(
    '📈 Needs Indicators',
    (o) => o.showNeeds,
    (dm, v) => { dm.showNeeds = v; },
  );

  const moodToggle = createToggle(
    '😊 Mood Aura',
    (o) => o.showMood,
    (dm, v) => { dm.showMood = v; },
  );

  const socialToggle = createToggle(
    '🔗 Social Connections',
    (o) => o.showSocialConnections,
    (dm, v) => { dm.showSocialConnections = v; },
  );

  // Belief threshold slider
  const thresholdLabel = document.createElement('div');
  thresholdLabel.style.cssText = 'font-size:11px; color:#8cf; margin-bottom:4px;';
  thresholdLabel.textContent = 'Belief Threshold: 0.3';
  sliderArea.appendChild(thresholdLabel);

  const thresholdSlider = document.createElement('input');
  thresholdSlider.type = 'range';
  thresholdSlider.min = '0';
  thresholdSlider.max = '100';
  thresholdSlider.value = '30';
  thresholdSlider.style.cssText = 'width:100%; cursor:pointer;';
  thresholdSlider.addEventListener('input', () => {
    const val = parseInt(thresholdSlider.value) / 100;
    thresholdLabel.textContent = `Belief Threshold: ${val.toFixed(2)}`;
    if (currentDevMode) {
      currentDevMode.beliefThreshold = val;
    }
  });
  sliderArea.appendChild(thresholdSlider);

  // Spirit selector
  const spiritLabel = document.createElement('div');
  spiritLabel.style.cssText = 'font-size:11px; color:#8cf; margin-bottom:4px;';
  spiritLabel.textContent = 'Filter Spirit:';
  spiritArea.appendChild(spiritLabel);

  const spiritSelect = document.createElement('select');
  spiritSelect.style.cssText = 'width:100%; padding:3px; background:#1a1a2e; color:#e0e0e0; border:1px solid #555; border-radius:3px; font-size:11px; cursor:pointer;';
  spiritSelect.innerHTML = '<option value="">All (max belief)</option>';
  spiritSelect.addEventListener('change', () => {
    if (currentDevMode) {
      currentDevMode.selectedSpiritId = spiritSelect.value || null;
    }
  });
  spiritArea.appendChild(spiritSelect);

  function update(devMode: DevModeState): void {
    currentDevMode = devMode;
    if (!devMode.enabled) {
      fp.hide();
      return;
    }
    fp.show();

    // Sync checkbox states
    beliefToggle.checked = !!devMode.showBeliefHeatmap;
    needsToggle.checked = !!devMode.showNeeds;
    moodToggle.checked = !!devMode.showMood;
    socialToggle.checked = !!devMode.showSocialConnections;

    // Sync slider
    const threshold = devMode.beliefThreshold ?? 0.3;
    thresholdSlider.value = String(Math.round(threshold * 100));
    thresholdLabel.textContent = `Belief Threshold: ${threshold.toFixed(2)}`;

    // Sync spirit selector (rebuild options if needed)
    // In a real implementation, you'd pass the list of spirits here
    // For now, just sync the selection
    spiritSelect.value = devMode.selectedSpiritId ?? '';
  }

  return {
    element: fp.element,
    update,
    show: fp.show,
    hide: fp.hide,
    toggle: fp.toggle,
    isVisible: fp.isVisible,
    destroy: () => fp.destroy(),
  };
}
