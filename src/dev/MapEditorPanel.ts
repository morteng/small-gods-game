import type { GameMap, Tile } from '@/core/types';
import { addPanelChrome } from '@/dev/PanelChrome';

/** Callback to paint a tile on the map */
type PaintTileCallback = (x: number, y: number, tileType: string) => void;

/** Parameters for mountMapEditorPanel */
interface MapEditorDeps {
  onPaintTile?: PaintTileCallback;
}

export interface MapEditorPanelHandle {
  element: HTMLDivElement;
  update(map: GameMap | null, selectedTile: { x: number; y: number } | null): void;
  destroy(): void;
}

/**
 * Mount the map editor panel for dev mode.
 */
export function mountMapEditorPanel(
  container: HTMLElement,
  deps: MapEditorDeps = {}
): MapEditorPanelHandle {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:absolute', 'top:60px', 'left:560px', 'width:280px',
    'background:rgba(20,20,30,0.92)', 'color:#e0e0e0', 'border:1px solid #555',
    'border-radius:6px', 'padding:12px', 'font:12px/1.5 monospace',
    'z-index:100', 'display:none', 'box-sizing:border-box',
  ].join(';');

  // Add panel chrome (title bar, close, minimize, drag)
  const chrome = addPanelChrome(panel, {
    title: '🗺️ Map Editor',
    onClose: () => { panel.style.display = 'none'; },
    onMinimize: (minimized) => { console.log('[dev] Map Editor minimized:', minimized); },
    onDragEnd: (x, y) => { console.log('[dev] Map Editor dragged to', x, y); },
  });

  // ── Tile Painting Section ─────────────────────────────────────
  const paintSection = document.createElement('div');
  paintSection.style.cssText = 'margin-bottom:10px;';

  const paintLabel = document.createElement('div');
  paintLabel.style.cssText = 'color:#8cf; font-size:11px; margin-bottom:4px;';
  paintLabel.textContent = '🖌️ Tile Painter:';
  paintSection.appendChild(paintLabel);

  // Brush selector
  const brushSelect = document.createElement('select');
  brushSelect.style.cssText = 'width:100%; padding:4px; background:#1a1a2e; color:#e0e0e0; border:1px solid #555; border-radius:3px; font-size:11px; margin-bottom:6px; cursor:pointer;';
  const brushTypes = ['grass', 'dirt', 'stone', 'water', 'sand', 'snow', 'forest', 'mountain'];
  for (const brush of brushTypes) {
    const opt = document.createElement('option');
    opt.value = brush;
    opt.textContent = brush;
    brushSelect.appendChild(opt);
  }
  paintSection.appendChild(brushSelect);

  // Brush size
  const sizeLabel = document.createElement('div');
  sizeLabel.style.cssText = 'color:#8cf; font-size:10px; margin:4px 0 2px 0;';
  sizeLabel.textContent = 'Brush Size:';
  paintSection.appendChild(sizeLabel);

  const sizeSlider = document.createElement('input');
  sizeSlider.type = 'range';
  sizeSlider.min = '1';
  sizeSlider.max = '5';
  sizeSlider.value = '1';
  sizeSlider.style.cssText = 'width:100%; cursor:pointer; margin-bottom:6px;';
  paintSection.appendChild(sizeSlider);

  // Apply paint button
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.textContent = '📍 Apply to Selected Tile';
  applyBtn.style.cssText = [
    'width:100%', 'padding:6px 8px', 'background:rgba(255,165,0,0.2)',
    'color:#ffa500', 'border:1px solid #ffa500', 'border-radius:3px',
    'font:11px sans-serif', 'cursor:pointer',
  ].join(';');
  applyBtn.addEventListener('mouseenter', () => { applyBtn.style.background = 'rgba(255,165,0,0.4)'; });
  applyBtn.addEventListener('mouseleave', () => { applyBtn.style.background = 'rgba(255,165,0,0.2)'; });
  applyBtn.addEventListener('click', () => {
    if (selectedTile && deps.onPaintTile) {
      const tileType = brushSelect.value;
      deps.onPaintTile(selectedTile.x, selectedTile.y, tileType);
      console.log(`[dev] Paint tile (${selectedTile.x}, ${selectedTile.y}) with ${tileType}`);
    } else {
      console.log('[dev] No tile selected or paint callback not set');
    }
  });
  paintSection.appendChild(applyBtn);

  panel.appendChild(paintSection);

  // ── Selected Tile Info ──────────────────────────────────────
  const infoSection = document.createElement('div');
  infoSection.style.cssText = 'margin-top:8px; padding-top:8px; border-top:1px solid #444;';

  const infoLabel = document.createElement('div');
  infoLabel.style.cssText = 'color:#8cf; font-size:11px; margin-bottom:4px;';
  infoLabel.textContent = 'Selected Tile:';
  infoSection.appendChild(infoLabel);

  const infoContent = document.createElement('div');
  infoContent.style.cssText = 'font-size:10px; color:#aaa;';
  infoContent.textContent = 'Click a tile to inspect';
  infoSection.appendChild(infoContent);

  panel.appendChild(infoSection);

  container.appendChild(panel);

  let currentMap: GameMap | null = null;
  let selectedTile: { x: number; y: number } | null = null;

  return {
    element: panel,
    update(map: GameMap | null, tile: { x: number; y: number } | null): void {
      currentMap = map;
      selectedTile = tile;

      if (!panel.style.display || panel.style.display === 'none') return;

      // Update selected tile info
      if (infoContent && selectedTile && map) {
        const tileData = map.tiles[selectedTile.y]?.[selectedTile.x];
        if (tileData) {
          infoContent.innerHTML = `
            <div style="display:grid; grid-template-columns:auto 1fr; gap:2px 8px;">
              <span style="color:#999;">pos</span><span>(${selectedTile.x}, ${selectedTile.y})</span>
              <span style="color:#999;">type</span><span>${tileData.type}</span>
              <span style="color:#999;">walk</span><span>${tileData.walkable ? '✓' : '✗'}</span>
              <span style="color:#999;">state</span><span>${tileData.state}</span>
            </div>
          `;
        } else {
          infoContent.textContent = 'No tile data';
        }
      } else if (infoContent) {
        infoContent.textContent = 'Click a tile to inspect';
      }
    },
    destroy() {
      panel.remove();
    },
  };
}
