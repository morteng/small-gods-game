import type { GameState } from '@/core/state';
import type { HitResult, DevModeState } from '@/core/types';
import { createFloatingPanel, type FloatingPanelHandle } from '@/dev/FloatingPanel';
import type { DockManager } from '@/dev/dock-manager';
import { buildInspectorTree, filterTree, type TreeNode } from './inspector-tree';
import { renderDetail, type DetailDeps } from './inspector-detail';
import { selectionFromHit, type Selection } from './selection';

export interface InspectorDeps {
  container: HTMLElement;
  getState: () => GameState;
  getDevMode?: () => DevModeState | null;
  onEdit: (hit: HitResult, key: string, value: unknown) => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFocusCamera: (x: number, y: number) => void;
  dock?: DockManager;
}

export interface InspectorHandle {
  element: HTMLElement;
  select(sel: Selection | null): void;
  selectHit(hit: HitResult | null): void;
  /** The current selection (unified source of truth for canvas + tree picks). */
  getSelection(): Selection | null;
  update(): void;
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  destroy(): void;
}

export function mountInspector(deps: InspectorDeps): InspectorHandle {
  const panel: FloatingPanelHandle = createFloatingPanel({
    container: deps.container, title: '🔍 Inspector', width: 560,
    anchor: { top: '60px', right: '10px' }, id: 'inspector', dock: deps.dock,
  });

  // Search row (above the split)
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'padding:6px; border-bottom:1px solid #444;';
  const search = document.createElement('input');
  search.className = 'sg-dev-search';
  search.placeholder = '🔍 Search…';
  searchWrap.appendChild(search);

  const split = document.createElement('div');
  split.style.cssText = 'display:flex; min-height:0; flex:1;';
  const treeEl = document.createElement('div');
  treeEl.className = 'sg-dev-tree';
  const detailEl = document.createElement('div');
  detailEl.className = 'sg-dev-detail';
  split.append(treeEl, detailEl);

  // panel.body is flex; stack search + split vertically inside it.
  panel.body.style.flexDirection = 'column';
  panel.body.append(searchWrap, split);

  let selection: Selection | null = null;
  const openIds = new Set<string>(['root', 'kinds']);
  let searchTerm = '';

  search.addEventListener('input', () => { searchTerm = search.value; renderTree(); });

  function detailDeps(): DetailDeps {
    const s = deps.getState();
    return {
      world: s.world, map: s.map, spirits: s.spirits, decorations: s.generatedDecorations,
      eventLog: s.eventLog, seed: s.worldSeed, devMode: deps.getDevMode ? deps.getDevMode() : null,
      onEdit: deps.onEdit, onDelete: deps.onDelete, onUndo: deps.onUndo, onRedo: deps.onRedo,
      onFocusCamera: deps.onFocusCamera, onNavigate: (sel) => select(sel),
    };
  }

  function renderDetailPane(): void { renderDetail(detailEl, selection, detailDeps()); }

  function selectionId(sel: Selection | null): string | null {
    if (!sel) return null;
    switch (sel.type) {
      case 'entity': return `entity:${sel.id}`;
      case 'spirit': return `spirit:${sel.id}`;
      case 'poi': return `poi:${sel.id}`;
      case 'decoration': return `deco:${sel.index}`;
      case 'world': return 'root';
      case 'lore': return 'lore';
      case 'tile': return `tile:${sel.x},${sel.y}`;
    }
  }

  function renderTree(): void {
    treeEl.innerHTML = '';
    const s = deps.getState();
    const full = buildInspectorTree(s.world, s.map, s.spirits, s.generatedDecorations, s.worldSeed);
    const model = searchTerm.trim() ? filterTree(full, searchTerm) : full;
    if (!model) { const d = document.createElement('div'); d.className = 'sg-dev-muted'; d.textContent = 'No matches.'; treeEl.appendChild(d); return; }
    const selId = selectionId(selection);
    const autoOpen = searchTerm.trim().length > 0;
    renderNode(treeEl, model, 0, selId, autoOpen);
  }

  function renderNode(host: HTMLElement, node: TreeNode, depth: number, selId: string | null, autoOpen: boolean): void {
    const row = document.createElement('div');
    row.className = 'sg-dev-tree-node' + (node.id === selId ? ' sg-dev-tree-node--selected' : '');
    row.style.paddingLeft = `${depth * 12 + 4}px`;
    const hasChildren = !!node.children && node.children.length > 0;
    const open = autoOpen || openIds.has(node.id) || node.defaultOpen === true;
    const toggle = document.createElement('span');
    toggle.className = 'sg-dev-tree-toggle';
    toggle.textContent = hasChildren ? (open ? '▾' : '▸') : '';
    row.appendChild(toggle);
    row.appendChild(document.createTextNode(node.label));
    row.addEventListener('click', () => {
      if (hasChildren) {
        if (openIds.has(node.id)) openIds.delete(node.id); else openIds.add(node.id);
      }
      if (node.selection) select(node.selection);
      else renderTree();
    });
    host.appendChild(row);
    if (hasChildren && open) {
      for (const c of node.children!) renderNode(host, c, depth + 1, selId, autoOpen);
    }
  }

  function select(sel: Selection | null): void {
    selection = sel;
    if (sel) { panel.show(); }
    renderTree();
    renderDetailPane();
  }

  return {
    element: panel.element,
    select,
    selectHit(hit: HitResult | null): void {
      let sel = selectionFromHit(hit);
      if (sel && sel.type === 'decoration' && hit?.decoration) {
        const decs = deps.getState().generatedDecorations ?? [];
        const d = hit.decoration;
        const index = decs.findIndex(
          x => x.tileX === d.tileX && x.tileY === d.tileY && x.assetId === d.assetId,
        );
        sel = { type: 'decoration', index };
      }
      select(sel);
    },
    getSelection(): Selection | null { return selection; },
    update(): void { renderTree(); renderDetailPane(); },
    show(): void { panel.show(); },
    hide(): void { panel.hide(); },
    toggle(): void { panel.toggle(); },
    isVisible(): boolean { return panel.isVisible(); },
    destroy(): void { panel.destroy(); },
  };
}
