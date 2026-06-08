import type { DevModeState } from '@/core/types';
import { createFloatingPanel } from '@/dev/FloatingPanel';
import type { DockManager } from '@/dev/dock-manager';
import { RENDER_LAYERS, layerFlag, type RenderLayer } from '@/render/layer-visibility';

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
 * Provides toggles for belief heatmap, needs, mood, social connections,
 * map info layers, and vegetation rendering, grouped into labelled sections.
 */
export function mountDebugOverlayPanel(container: HTMLElement, deps: { dock?: DockManager } = {}): DebugOverlayPanelHandle {
  const fp = createFloatingPanel({ container, id: 'overlay', title: '🎨 Debug Overlays', dock: deps.dock, width: 300, anchor: { top: '60px', left: '10px' } });

  // The shared `.sg-dev-body` is a flex ROW (for master-detail panels). This
  // panel stacks vertically, so wrap everything in a padded column to give the
  // controls room to breathe instead of being squeezed side-by-side.
  const col = document.createElement('div');
  col.style.cssText = 'display:flex; flex-direction:column; width:100%; padding:12px; gap:12px; box-sizing:border-box; overflow:auto;';
  fp.body.appendChild(col);

  let currentDevMode: DevModeState | null = null;

  /** A titled group of controls. */
  function section(title: string): HTMLDivElement {
    const heading = document.createElement('div');
    heading.className = 'sg-dev-section-title';
    heading.style.cssText = 'color:#8cf; font-size:11px; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; margin:0;';
    heading.textContent = title;
    col.appendChild(heading);

    const group = document.createElement('div');
    group.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
    col.appendChild(group);
    return group;
  }

  function createToggle(
    parent: HTMLElement,
    label: string,
    setVal: (devMode: DevModeState, value: boolean) => void,
  ): HTMLInputElement {
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex; align-items:center; gap:8px; cursor:pointer; font-size:12px; padding:2px 0;';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.style.cssText = 'margin:0; cursor:pointer; width:14px; height:14px;';

    const text = document.createElement('span');
    text.textContent = label;

    checkbox.addEventListener('change', () => {
      if (currentDevMode) setVal(currentDevMode, checkbox.checked);
    });

    lbl.appendChild(checkbox);
    lbl.appendChild(text);
    parent.appendChild(lbl);
    return checkbox;
  }

  // ── Belief & NPCs ──────────────────────────────────────────────────────────
  const beliefSection = section('Belief & NPCs');
  const beliefToggle = createToggle(beliefSection, '📊 Belief Heatmap', (dm, v) => { dm.showBeliefHeatmap = v; });
  const needsToggle = createToggle(beliefSection, '📈 Needs Indicators', (dm, v) => { dm.showNeeds = v; });
  const moodToggle = createToggle(beliefSection, '😊 Mood Aura', (dm, v) => { dm.showMood = v; });
  const socialToggle = createToggle(beliefSection, '🔗 Social Connections', (dm, v) => { dm.showSocialConnections = v; });

  // Belief threshold slider
  const thresholdLabel = document.createElement('div');
  thresholdLabel.style.cssText = 'font-size:11px; color:#8cf; margin:6px 0 4px;';
  thresholdLabel.textContent = 'Belief Threshold: 0.30';
  beliefSection.appendChild(thresholdLabel);

  const thresholdSlider = document.createElement('input');
  thresholdSlider.type = 'range';
  thresholdSlider.min = '0';
  thresholdSlider.max = '100';
  thresholdSlider.value = '30';
  thresholdSlider.style.cssText = 'width:100%; cursor:pointer; margin:0;';
  thresholdSlider.addEventListener('input', () => {
    const val = parseInt(thresholdSlider.value) / 100;
    thresholdLabel.textContent = `Belief Threshold: ${val.toFixed(2)}`;
    if (currentDevMode) currentDevMode.beliefThreshold = val;
  });
  beliefSection.appendChild(thresholdSlider);

  // Spirit selector
  const spiritLabel = document.createElement('div');
  spiritLabel.style.cssText = 'font-size:11px; color:#8cf; margin:6px 0 4px;';
  spiritLabel.textContent = 'Filter Spirit:';
  beliefSection.appendChild(spiritLabel);

  const spiritSelect = document.createElement('select');
  spiritSelect.style.cssText = 'width:100%; padding:4px; background:#1a1a2e; color:#e0e0e0; border:1px solid #555; border-radius:3px; font-size:11px; cursor:pointer;';
  spiritSelect.innerHTML = '<option value="">All (max belief)</option>';
  spiritSelect.addEventListener('change', () => {
    if (currentDevMode) currentDevMode.selectedSpiritId = spiritSelect.value || null;
  });
  beliefSection.appendChild(spiritSelect);

  // ── Map Layers ───────────────────────────────────────────────────────────
  const mapSection = section('Map Layers');
  const biomeToggle = createToggle(mapSection, '🗺️ Biome Layer', (dm, v) => { dm.showBiomeLayer = v; });
  const poiToggle = createToggle(mapSection, '📍 POI Layer', (dm, v) => { dm.showPoiLayer = v; });

  // ── Render Layers ─────────────────────────────────────────────────────────
  // One toggle per base scene category. Each is shown unless its flag is
  // explicitly false, so a fresh (undefined) checkbox reads "shown" (checked).
  const renderSection = section('Render Layers');
  const LAYER_LABELS: Record<RenderLayer, string> = {
    terrain: '🗺️ Terrain (tiles)',
    roads: '🛣️ Roads',
    rivers: '🌊 Rivers',
    npcs: '🧍 NPCs',
    buildings: '🏠 Buildings',
    vegetation: '🌳 Vegetation',
    props: '📦 Props',
    terrainFeatures: '🪨 Terrain Features',
    decorations: '🎨 Decorations',
    remains: '⚰️ Remains',
  };
  const layerToggles = new Map<RenderLayer, HTMLInputElement>();
  for (const layer of RENDER_LAYERS) {
    const flag = layerFlag(layer);
    const toggle = createToggle(renderSection, LAYER_LABELS[layer], (dm, v) => { dm[flag] = v; });
    layerToggles.set(layer, toggle);
  }

  // ── Building Render ──────────────────────────────────────────────────────
  // Off (default): draw the generated asset sprite where one exists, else the
  // parametric massing. On: always draw the parametric massing.
  const buildingSection = section('Building Render');
  const parametricToggle = createToggle(
    buildingSection, '🏗️ Force parametric (ignore assets)',
    (dm, v) => { dm.forceParametricBuildings = v; },
  );

  // Reset button — clears every overlay back to its default (off / shown).
  const resetBtn = document.createElement('button');
  resetBtn.className = 'sg-dev-btn';
  resetBtn.textContent = '↺ Reset overlays';
  resetBtn.style.cssText = 'margin-top:4px;';
  resetBtn.addEventListener('click', () => {
    if (!currentDevMode) return;
    currentDevMode.showBeliefHeatmap = false;
    currentDevMode.showNeeds = false;
    currentDevMode.showMood = false;
    currentDevMode.showSocialConnections = false;
    currentDevMode.showBiomeLayer = false;
    currentDevMode.showPoiLayer = false;
    // Render layers default to shown.
    for (const layer of RENDER_LAYERS) currentDevMode[layerFlag(layer)] = true;
    currentDevMode.forceParametricBuildings = false;
    currentDevMode.beliefThreshold = 0.3;
    currentDevMode.selectedSpiritId = null;
    update(currentDevMode);
  });
  col.appendChild(resetBtn);

  function update(devMode: DevModeState): void {
    currentDevMode = devMode;
    // NOTE: visibility is owned solely by the toolbar/dock — update() only syncs
    // control state. Do NOT call fp.show()/fp.hide() here or it fights the toggle.

    beliefToggle.checked = !!devMode.showBeliefHeatmap;
    needsToggle.checked = !!devMode.showNeeds;
    moodToggle.checked = !!devMode.showMood;
    socialToggle.checked = !!devMode.showSocialConnections;
    biomeToggle.checked = !!devMode.showBiomeLayer;
    poiToggle.checked = !!devMode.showPoiLayer;
    // Render layers default to shown (undefined → checked); only false unchecks.
    for (const [layer, toggle] of layerToggles) {
      toggle.checked = devMode[layerFlag(layer)] !== false;
    }
    parametricToggle.checked = !!devMode.forceParametricBuildings;

    const threshold = devMode.beliefThreshold ?? 0.3;
    thresholdSlider.value = String(Math.round(threshold * 100));
    thresholdLabel.textContent = `Belief Threshold: ${threshold.toFixed(2)}`;

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
