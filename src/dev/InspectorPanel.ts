import type { DevModeState, HitResult, Tile, Entity, NpcInstance, GeneratedDecoration } from '@/core/types';
import { TILE_SIZE } from '@/core/constants';
import { renderPropertyGrid } from '@/dev/PropertyGrid';
import { addPanelChrome, type PanelChromeHandle } from '@/dev/PanelChrome';

let onChangeCallback: ((hit: HitResult, key: string, value: unknown) => void) | null = null;
let onDeleteCallback: (() => void) | null = null;
let onUndoCallback: (() => void) | null = null;
let onRedoCallback: (() => void) | null = null;

interface ActionButton {
  label: string;
  action: () => void;
}

export interface InspectorPanelHandle {
  element: HTMLElement;
  update(hit: HitResult | null, devMode: DevModeState | null): void;
  destroy(): void;
  setOnChange(cb: (hit: HitResult, key: string, value: unknown) => void): void;
  setOnDelete(cb: () => void): void;
  setOnUndo(cb: () => void): void;
  setOnRedo(cb: () => void): void;
}

function renderHitInfo(hit: HitResult): string {
  const lines: string[] = [];
  if (hit.type === 'tile' && hit.tile) {
    const t = hit.tile;
    lines.push(`<div style="color:#8cf; font-size:11px; margin-bottom:4px;">Tile (${hit.tileX}, ${hit.tileY})</div>`);
    lines.push(`<div style="display:grid; grid-template-columns:auto 1fr; gap:2px 8px; font-size:10px;">`);
    lines.push(`<span style="color:#999;">type</span><span>${t.type}</span>`);
    lines.push(`<span style="color:#999;">walk</span><span>${t.walkable ? 'yes' : 'no'}</span>`);
    lines.push(`<span style="color:#999;">state</span><span>${t.state}</span>`);
    lines.push(`<span style="color:#999;">pos</span><span>(${hit.tileX}, ${hit.tileY})</span>`);
    lines.push('</div>');
  } else if (hit.type === 'entity' && hit.entity) {
    const e = hit.entity;
    lines.push(`<div style="color:#8cf; font-size:11px; margin-bottom:4px;">Entity: ${e.kind}</div>`);
    lines.push(`<div style="font-size:10px; color:#aaa;">ID: ${e.id}</div>`);
    lines.push(`<div style="font-size:10px; color:#aaa;">Pos: (${e.x}, ${e.y})</div>`);
    if (e.kind === 'npc' && hit.npc) {
      lines.push(`<div style="font-size:10px; color:#aaa;">Role: ${hit.npc.role ?? 'unknown'}</div>`);
    }
  } else if (hit.type === 'decoration' && hit.decoration) {
    const d = hit.decoration;
    lines.push(`<div style="color:#8cf; font-size:11px; margin-bottom:4px;">Decoration</div>`);
    lines.push(`<div style="font-size:10px; color:#aaa;">Asset ID: ${d.assetId}</div>`);
    lines.push(`<div style="font-size:10px; color:#aaa;">Pos: (${d.tileX}, ${d.tileY})</div>`);
  }
  return lines.join('\n');
}

function renderActions(container: HTMLElement, hit: HitResult): void {
  container.innerHTML = '';
  if (hit.type === null) return;

  const actions = getAvailableActions(hit);
  if (actions.length === 0) return;

  const label = document.createElement('div');
  label.style.cssText = 'color:#8cf; font-size:11px; margin-bottom:4px; width:100%;';
  label.textContent = 'Actions';
  container.appendChild(label);

  for (const act of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = act.label;
    btn.style.cssText = [
      'width:100%', 'padding:4px 8px', 'background:rgba(255, 255, 255, 0.1)',
      'color:#e0e0e0', 'border:1px solid #555', 'border-radius:3px',
      'font:10px sans-serif', 'cursor:pointer', 'margin-bottom:2px',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255, 255, 255, 0.2)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(255, 255, 255, 0.1)'; });
    btn.addEventListener('click', () => act.action());
    container.appendChild(btn);
  }
}

function getAvailableActions(hit: HitResult): ActionButton[] {
  const actions: ActionButton[] = [];
  if (hit.type === 'entity') {
    actions.push({ label: '🗑️ Delete Entity', action: () => onDeleteCallback?.() });
  }
  if (hit.type === 'tile') {
    actions.push({ label: '📋 Copy Coords', action: () => copyToClipboard(`${hit.tileX},${hit.tileY}`) });
  }
  return actions;
}

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).then(() => {
    console.log('[dev] Copied to clipboard:', text);
  });
}

function renderUndoRedo(container: HTMLElement, devMode: DevModeState | null): void {
  container.innerHTML = '';
  if (!devMode) return;

  const label = document.createElement('div');
  label.style.cssText = 'color:#8cf; font-size:11px; margin-bottom:4px; width:100%;';
  label.textContent = 'Undo / Redo';
  container.appendChild(label);

  const btnStyle = [
    'flex:1', 'padding:4px 8px', 'background:rgba(255, 255, 255, 0.1)',
    'color:#e0e0e0', 'border:1px solid #555', 'border-radius:3px',
    'font:11px sans-serif', 'cursor:pointer', 'text-align:center',
  ].join(';');

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.textContent = '↩ Undo';
  undoBtn.style.cssText = btnStyle;
  undoBtn.disabled = devMode.undoStack.length === 0;
  undoBtn.style.opacity = undoBtn.disabled ? '0.4' : '1';
  undoBtn.addEventListener('mouseenter', () => { if (!undoBtn.disabled) undoBtn.style.background = 'rgba(255, 255, 255, 0.2)'; });
  undoBtn.addEventListener('mouseleave', () => { undoBtn.style.background = 'rgba(255, 255, 255, 0.1)'; });
  undoBtn.addEventListener('click', () => { onUndoCallback?.(); });
  container.appendChild(undoBtn);

  const redoBtn = document.createElement('button');
  redoBtn.type = 'button';
  redoBtn.textContent = '↪ Redo';
  redoBtn.style.cssText = btnStyle;
  redoBtn.disabled = devMode.redoStack.length === 0;
  redoBtn.style.opacity = redoBtn.disabled ? '0.4' : '1';
  redoBtn.addEventListener('mouseenter', () => { if (!redoBtn.disabled) redoBtn.style.background = 'rgba(255, 255, 255, 0.2)'; });
  redoBtn.addEventListener('mouseleave', () => { redoBtn.style.background = 'rgba(255, 255, 255, 0.1)'; });
  redoBtn.addEventListener('click', () => { onRedoCallback?.(); });
  container.appendChild(redoBtn);
}

export function mountInspectorPanel(
  container: HTMLElement,
  callbacks?: {
    onDelete?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
  }
): InspectorPanelHandle {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:absolute',
    'top:60px',
    'right:10px',
    'width:280px',
    'background:rgba(20,20,30,0.92)',
    'color:#e0e0e0',
    'border:1px solid #555',
    'border-radius:6px',
    'padding:12px',
    'font:12px/1.5 monospace',
    'z-index:100',
    'display:none',
    'box-sizing:border-box',
    'max-height:80vh',
    'overflow-y:auto',
  ].join(';');

  // Add panel chrome (title bar, close, minimize, drag)
  const chrome = addPanelChrome(panel, {
    title: '🔧 Inspector',
    onClose: () => { panel.style.display = 'none'; },
    onMinimize: (minimized) => { console.log('[dev] Inspector minimized:', minimized); },
    onDragEnd: (x, y) => { console.log('[dev] Inspector dragged to', x, y); },
  });

  // Info area (read-only info)
  const infoArea = document.createElement('div');
  infoArea.className = 'inspector-info';
  panel.appendChild(infoArea);

  // Property grid area (editable fields)
  const propArea = document.createElement('div');
  propArea.className = 'inspector-properties';
  propArea.style.cssText = 'margin-top:8px; padding-top:8px; border-top:1px solid #444;';
  panel.appendChild(propArea);

  // Action buttons area
  const actionArea = document.createElement('div');
  actionArea.className = 'inspector-actions';
  actionArea.style.cssText = 'margin-top:8px; padding-top:8px; border-top:1px solid #444;';
  panel.appendChild(actionArea);

  // Undo/Redo buttons area
  const undoRedoArea = document.createElement('div');
  undoRedoArea.className = 'inspector-undoredo';
  undoRedoArea.style.cssText = 'margin-top:8px; padding-top:8px; border-top:1px solid #444; display:flex; gap:4px;';
  panel.appendChild(undoRedoArea);

  container.appendChild(panel);

  // Set callbacks
  onDeleteCallback = callbacks?.onDelete ?? null;
  onUndoCallback = callbacks?.onUndo ?? null;
  onRedoCallback = callbacks?.onRedo ?? null;

  let currentHit: HitResult | null = null;

  return {
    element: panel,
    update(hit: HitResult | null, devMode: DevModeState | null): void {
      currentHit = hit;
      if (!hit || hit.type === null) {
        panel.style.display = 'none';
        return;
      }
      panel.style.display = 'block';

      // Render read-only info
      infoArea.innerHTML = renderHitInfo(hit);

      // Render editable property grid
      propArea.innerHTML = '<div style="color:#8cf; font-size:11px; margin-bottom:4px;">Properties</div>';
      renderPropertyGrid(propArea, hit, (key, value) => {
        if (onChangeCallback && currentHit) onChangeCallback(currentHit, key, value);
      });

      // Render action buttons
      renderActions(actionArea, hit);

      // Render undo/redo buttons
      renderUndoRedo(undoRedoArea, devMode);
    },
    destroy() {
      panel.remove();
    },
    setOnChange(cb: (hit: HitResult, key: string, value: unknown) => void): void {
      onChangeCallback = cb;
    },
    setOnDelete(cb: () => void): void {
      onDeleteCallback = cb;
    },
    setOnUndo(cb: () => void): void {
      onUndoCallback = cb;
    },
    setOnRedo(cb: () => void): void {
      onRedoCallback = cb;
    },
  };
}
