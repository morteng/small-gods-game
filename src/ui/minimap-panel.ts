/**
 * Minimap Panel — toggleable minimap showing world overview.
 * Shows viewport rectangle, POI markers, NPC positions.
 */

import type { GameMap, NpcInstance } from '@/core/types';
import { TILE_SIZE } from '@/core/constants';
import type { RenderContext } from '@/core/types';

export interface MinimapOptions {
  onToggle?: (visible: boolean) => void;
  onClickTile?: (x: number, y: number) => void;
}

export interface MinimapHandle {
  update(map: GameMap, npcs: NpcInstance[], camera: { x: number; y: number; zoom: number }, canvasWidth: number, canvasHeight: number): void;
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  destroy(): void;
}

const STYLE = `
.sg-minimap {
  position: absolute;
  bottom: 60px;
  left: 18px;
  width: 200px;
  background: var(--shade);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  overflow: hidden;
  box-shadow: var(--lift-1);
  z-index: 20;
  pointer-events: auto;
  transition: opacity 200ms ease;
}

.sg-minimap__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-2) var(--s-3);
  background: var(--paper-2);
  border-bottom: 1px solid var(--line);
  cursor: move;
}

.sg-minimap__title {
  font-family: var(--f-sans);
  font-size: var(--t-micro);
  font-weight: 600;
  color: var(--ink-2);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.sg-minimap__close {
  all: unset;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--r-1);
  color: var(--ink-3);
  font-size: 14px;
  line-height: 1;
}

.sg-minimap__close:hover {
  background: var(--paper);
  color: var(--ink);
}

.sg-minimap__canvas {
  display: block;
  width: 100%;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

.sg-minimap__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-1) var(--s-3);
  background: var(--paper-2);
  border-top: 1px solid var(--line);
}

.sg-minimap__coords {
  font-family: var(--f-mono);
  font-size: var(--t-micro);
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

.sg-minimap__zoom {
  font-family: var(--f-mono);
  font-size: var(--t-micro);
  color: var(--ink-4);
}
`;

export function createMinimapPanel(
  container: HTMLElement,
  opts: MinimapOptions = {},
): MinimapHandle {
  // Inject styles
  if (!document.querySelector('#sg-minimap-styles')) {
    const style = document.createElement('style');
    style.id = 'sg-minimap-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const panel = document.createElement('div');
  panel.className = 'sg-minimap';

  // Header
  const header = document.createElement('div');
  header.className = 'sg-minimap__header';

  const title = document.createElement('div');
  title.className = 'sg-minimap__title';
  title.textContent = 'World Map';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sg-minimap__close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => hide());
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.className = 'sg-minimap__canvas';
  panel.appendChild(canvas);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'sg-minimap__footer';

  const coords = document.createElement('div');
  coords.className = 'sg-minimap__coords';
  coords.textContent = '0, 0';
  footer.appendChild(coords);

  const zoom = document.createElement('div');
  zoom.className = 'sg-minimap__zoom';
  footer.appendChild(zoom);

  panel.appendChild(footer);

  container.appendChild(panel);

  const ctx = canvas.getContext('2d')!;
  let visible = true;

  function renderMinimap(
    map: GameMap,
    npcs: NpcInstance[],
    camera: { x: number; y: number; zoom: number },
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    const mapW = map.width;
    const mapH = map.height;

    // Set canvas size (maintain aspect ratio)
    const aspect = mapW / mapH;
    const displayW = 200;
    const displayH = Math.round(displayW / aspect);

    canvas.width = mapW;
    canvas.height = mapH;
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;

    // Clear
    ctx.fillStyle = '#2a2a3a';
    ctx.fillRect(0, 0, mapW, mapH);

    // Draw tiles (simplified - just color based on type)
    const scaleX = mapW / displayW;
    const scaleY = mapH / displayH;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y]?.[x];
        if (!tile) continue;

        switch (tile.type) {
          case 'grass':
            ctx.fillStyle = '#4a7a4a';
            break;
          case 'water':
          case 'shallow_water':
            ctx.fillStyle = '#3a5a8a';
            break;
          case 'forest':
            ctx.fillStyle = '#2a5a2a';
            break;
          case 'mountain':
            ctx.fillStyle = '#6a6a7a';
            break;
          case 'road':
          case 'dirt_road':
          case 'stone_road':
            ctx.fillStyle = '#8a7a5a';
            break;
          default:
            ctx.fillStyle = '#4a5a4a';
        }

        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Draw POIs
    if (map.worldSeed?.pois) {
      for (const poi of map.worldSeed.pois) {
        if (!poi.position) continue;
        ctx.fillStyle = '#FFD54F';
        ctx.fillRect(poi.position.x - 1, poi.position.y - 1, 3, 3);
      }
    }

    // Draw NPCs
    for (const npc of npcs) {
      ctx.fillStyle = '#FF6B6B';
      ctx.fillRect(Math.floor(npc.tileX), Math.floor(npc.tileY), 1, 1);
    }

    // Draw viewport rectangle
    const viewLeft = camera.x / TILE_SIZE;
    const viewTop = camera.y / TILE_SIZE;
    const viewW = (canvasWidth / camera.zoom) / TILE_SIZE;
    const viewH = (canvasHeight / camera.zoom) / TILE_SIZE;

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(viewLeft, viewTop, viewW, viewH);

    // Update footer
    const centerX = Math.floor(viewLeft + viewW / 2);
    const centerY = Math.floor(viewTop + viewH / 2);
    coords.textContent = `${centerX}, ${centerY}`;
    zoom.textContent = `${camera.zoom.toFixed(1)}×`;
  }

  // Click on minimap to move camera
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const tileX = Math.floor(x * canvas.width);
    const tileY = Math.floor(y * canvas.height);

    opts.onClickTile?.(tileX, tileY);
  });

  function show(): void {
    panel.style.display = 'block';
    visible = true;
    opts.onToggle?.(true);
  }

  function hide(): void {
    panel.style.display = 'none';
    visible = false;
    opts.onToggle?.(false);
  }

  function toggle(): void {
    if (visible) hide();
    else show();
  }

  return {
    update: renderMinimap,
    show,
    hide,
    toggle,
    isVisible: () => visible,
    destroy() {
      panel.remove();
    },
  };
}
