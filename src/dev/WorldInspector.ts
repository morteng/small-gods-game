import type { Entity, NpcSimState, GeneratedDecoration, GameMap } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import { addPanelChrome, type PanelChromeHandle } from '@/dev/PanelChrome';
import { TILE_SIZE } from '@/core/constants';
import { getEntityKindDef } from '@/world/entity-kinds';
import type { World } from '@/world/world';

export interface WorldInspectorHandle {
  element: HTMLElement;
  update(world: World | null, gameMap: GameMap | null, spirits: Map<SpiritId, Spirit>, decorations: GeneratedDecoration[]): void;
  destroy(): void;
  show(): void;
  hide(): void;
  isVisible(): boolean;
  setCameraFocusCallback(callback: (x: number, y: number) => void): void;
}

interface TabConfig {
  label: string;
  id: string;
}

const TABS: TabConfig[] = [
  { label: '📊 World', id: 'world' },
  { label: '👥 NPCs', id: 'npcs' },
  { label: '🌲 Entities', id: 'entities' },
  { label: '🗺️ Tiles', id: 'tiles' },
  { label: '✨ Spirits', id: 'spirits' },
  { label: '🎨 Decorations', id: 'decorations' },
];

export function mountWorldInspector(container: HTMLElement): WorldInspectorHandle {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:absolute',
    'top:60px',
    'right:10px',
    'width:400px',
    'max-height:80vh',
    'background:rgba(20,20,30,0.95)',
    'color:#e0e0e0',
    'border:1px solid #555',
    'border-radius:6px',
    'overflow:hidden',
    'font:12px/1.5 monospace',
    'z-index:100',
    'display:none',
    'box-sizing:border-box',
    'flex-direction:column',
  ].join(';');

  // Add panel chrome (title bar, close, minimize, drag)
  const chrome = addPanelChrome(panel, {
    title: '🔍 World Inspector',
    onClose: () => { panel.style.display = 'none'; },
    onMinimize: (minimized) => { console.log('[dev] World Inspector minimized:', minimized); },
    onDragEnd: (x, y) => { console.log('[dev] World Inspector dragged to', x, y); },
  });

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.style.cssText = 'display:flex; border-bottom:1px solid #444; padding:0 8px;';
  panel.appendChild(tabBar);

  // Search bar
  const searchBar = document.createElement('div');
  searchBar.style.cssText = 'padding:6px 8px; border-bottom:1px solid #333; display:none;';
  panel.appendChild(searchBar);

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = '🔍 Search...';
  searchInput.style.cssText = 'width:100%; padding:4px 8px; background:rgba(255,255,255,0.1); border:1px solid #555; border-radius:3px; color:#e0e0e0; font:11px sans-serif;';
  searchBar.appendChild(searchInput);

  // Content area
  const content = document.createElement('div');
  content.style.cssText = 'flex:1; overflow-y:auto; padding:8px;';
  panel.appendChild(content);

  // Footer with export button
  const footer = document.createElement('div');
  footer.style.cssText = 'padding:6px 8px; border-top:1px solid #444; display:flex; justify-content:space-between; align-items:center;';
  
  const exportBtn = document.createElement('button');
  exportBtn.textContent = '📥 Export JSON';
  exportBtn.style.cssText = 'padding:4px 8px; background:rgba(100,150,255,0.2); border:1px solid #555; border-radius:3px; color:#8cf; cursor:pointer; font:10px sans-serif;';
  exportBtn.addEventListener('mouseenter', () => { exportBtn.style.background = 'rgba(100,150,255,0.4)'; });
  exportBtn.addEventListener('mouseleave', () => { exportBtn.style.background = 'rgba(100,150,255,0.2)'; });
  footer.appendChild(exportBtn);
  
  const searchToggleBtn = document.createElement('button');
  searchToggleBtn.textContent = '🔍';
  searchToggleBtn.style.cssText = 'padding:4px 8px; background:transparent; border:1px solid #555; border-radius:3px; color:#aaa; cursor:pointer; font:10px sans-serif;';
  searchToggleBtn.addEventListener('click', () => {
    const isVisible = searchBar.style.display !== 'none';
    searchBar.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) searchInput.focus();
  });
  footer.appendChild(searchToggleBtn);
  
  panel.appendChild(footer);

  // State
  let currentTab = 'world';
  let world: World | null = null;
  let gameMap: GameMap | null = null;
  let spirits: Map<SpiritId, Spirit> = new Map();
  let decorations: GeneratedDecoration[] = [];
  let searchTerm = '';
  let cameraFocusCallback: ((x: number, y: number) => void) | null = null;

  // Create tab buttons
  const tabButtons: HTMLButtonElement[] = [];
  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tab.label;
    btn.dataset.tabId = tab.id;
    btn.style.cssText = [
      'padding:6px 10px',
      'background:transparent',
      'color:#aaa',
      'border:none',
      'border-bottom:2px solid transparent',
      'cursor:pointer',
      'font:11px sans-serif',
      'transition:all 0.15s',
    ].join(';');
    btn.addEventListener('mouseenter', () => {
      if (currentTab !== tab.id) btn.style.color = '#fff';
    });
    btn.addEventListener('mouseleave', () => {
      if (currentTab !== tab.id) btn.style.color = '#aaa';
    });
    btn.addEventListener('click', () => switchTab(tab.id));
    tabBar.appendChild(btn);
    tabButtons.push(btn);
  }

  // Search functionality
  searchInput.addEventListener('input', (e) => {
    searchTerm = (e.target as HTMLInputElement).value.toLowerCase();
    renderContent();
  });

  // Export functionality
  exportBtn.addEventListener('click', () => {
    exportToJson();
  });

  function switchTab(tabId: string): void {
    currentTab = tabId;
    tabButtons.forEach(btn => {
      const isActive = btn.dataset.tabId === tabId;
      btn.style.color = isActive ? '#8cf' : '#aaa';
      btn.style.borderBottomColor = isActive ? '#8cf' : 'transparent';
    });
    renderContent();
  }

  function renderContent(): void {
    content.innerHTML = '';
    switch (currentTab) {
      case 'world': renderWorldStats(); break;
      case 'npcs': renderNpcs(); break;
      case 'entities': renderEntities(); break;
      case 'tiles': renderTiles(); break;
      case 'spirits': renderSpirits(); break;
      case 'decorations': renderDecorations(); break;
    }
  }

  function filterBySearch(text: string): boolean {
    if (!searchTerm) return true;
    return text.toLowerCase().includes(searchTerm);
  }

  function renderWorldStats(): void {
    if (!world || !gameMap) {
      content.innerHTML = '<div style="color:#888; padding:20px; text-align:center;">No world loaded</div>';
      return;
    }

    const allEntities = world.registry.all();
    const npcs = allEntities.filter(e => e.tags?.includes('npc') ?? false);
    const vegetation = allEntities.filter(e => e.tags?.includes('vegetation') ?? false);
    const buildings = allEntities.filter(e => e.tags?.includes('building') ?? false);
    const decos = allEntities.filter(e => e.tags?.includes('decoration') ?? false);

    const lines = [
      `<div style="color:#8cf; font-size:14px; margin-bottom:8px;">World Statistics</div>`,
      `<div style="display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:11px;">`,
      `<span style="color:#999;">Map Size</span><span>${gameMap.width} × ${gameMap.height}</span>`,
      `<span style="color:#999;">Total Tiles</span><span>${gameMap.width * gameMap.height}</span>`,
      `<span style="color:#999;">Total Entities</span><span>${allEntities.length}</span>`,
      `<span style="color:#999;">NPCs</span><span>${npcs.length}</span>`,
      `<span style="color:#999;">Vegetation</span><span>${vegetation.length}</span>`,
      `<span style="color:#999;">Buildings</span><span>${buildings.length}</span>`,
      `<span style="color:#999;">Decorations</span><span>${decos.length}</span>`,
      `</div>`,
    ];
    content.innerHTML = lines.join('\n');
  }

  function renderNpcs(): void {
    if (!world) {
      content.innerHTML = '<div style="color:#888; padding:20px; text-align:center;">No world loaded</div>';
      return;
    }

    let npcs = world.query({ tag: 'npc' });
    
    // Apply search filter
    if (searchTerm) {
      npcs = npcs.filter(npc => {
        const npcState = npc.properties?.npc as NpcSimState | undefined;
        const role = npcState?.role ?? 'unknown';
        const searchText = `${npc.kind} ${npc.id} ${role}`.toLowerCase();
        return searchText.includes(searchTerm);
      });
    }

    if (npcs.length === 0) {
      content.innerHTML = '<div style="color:#888; padding:20px; text-align:center;">No NPCs found</div>';
      return;
    }

    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:6px;';

    for (const npc of npcs) {
      const card = document.createElement('div');
      card.style.cssText = 'background:rgba(255,255,255,0.05); border:1px solid #444; border-radius:4px; padding:8px; cursor:pointer;';
      card.addEventListener('mouseenter', () => { card.style.background = 'rgba(255,255,255,0.1)'; });
      card.addEventListener('mouseleave', () => { card.style.background = 'rgba(255,255,255,0.05)'; });
      
      // Click to focus camera on NPC
      card.addEventListener('click', () => {
        if (cameraFocusCallback) {
          cameraFocusCallback(npc.x, npc.y);
        } else {
          console.log(`[World Inspector] Focus on NPC at (${npc.x}, ${npc.y})`);
        }
      });

      const npcState = npc.properties?.npc as NpcSimState | undefined;
      const role = npcState?.role ?? 'unknown';
      let beliefStr = 'none';
      if (npcState?.beliefs) {
        beliefStr = Object.entries(npcState.beliefs)
          .map(([id, b]: [string, any]) => `${id}:${Math.round(b.faith * 100)}%`)
          .join(', ');
      }

      card.innerHTML = [
        `<div style="color:#8cf; font-size:11px; margin-bottom:4px;">${npc.kind} (${npc.id})</div>`,
        `<div style="font-size:10px; color:#aaa;">Role: ${role}</div>`,
        `<div style="font-size:10px; color:#aaa;">Pos: (${Math.floor(npc.x)}, ${Math.floor(npc.y)})</div>`,
        `<div style="font-size:10px; color:#aaa; margin-top:4px;">Beliefs: ${beliefStr}</div>`,
        `<div style="font-size:9px; color:#666; margin-top:4px;">💡 Click to focus camera</div>`,
      ].join('\n');

      list.appendChild(card);
    }

    content.appendChild(list);
  }

  function renderEntities(): void {
    if (!world) {
      content.innerHTML = '<div style="color:#888; padding:20px; text-align:center;">No world loaded</div>';
      return;
    }

    const all = world.registry.all();
    const byKind = new Map<string, { count: number; sample: Entity | null }>();
    
    for (const e of all) {
      const entry = byKind.get(e.kind) ?? { count: 0, sample: null };
      entry.count++;
      if (!entry.sample) entry.sample = e;
      byKind.set(e.kind, entry);
    }

    // Apply search filter
    let filtered = Array.from(byKind.entries());
    if (searchTerm) {
      filtered = filtered.filter(([kind]) => kind.toLowerCase().includes(searchTerm));
    }

    const sorted = filtered.sort((a, b) => b[1].count - a[1].count);

    const lines = [
      `<div style="color:#8cf; font-size:14px; margin-bottom:8px;">Entities by Kind (${all.length} total, ${filtered.length} kinds)</div>`,
      `<div style="display:grid; grid-template-columns:auto 60px 1fr; gap:4px 12px; font-size:11px;">`,
      `<span style="color:#999;">Kind</span><span style="color:#999;">Count</span><span style="color:#999;">Sample</span>`,
    ];

    for (const [kind, data] of sorted) {
      const def = getEntityKindDef(kind);
      const color = def?.sprite.fallbackColor ?? '#666';
      lines.push(`<span>${kind}</span><span style="text-align:right;">${data.count}</span><span style="color:${color};">■ Sample</span>`);
    }

    lines.push('</div>');
    content.innerHTML = lines.join('\n');
  }

  function renderTiles(): void {
    if (!gameMap) {
      content.innerHTML = '<div style="color:#888; padding:20px; text-align:center;">No world loaded</div>';
      return;
    }

    const typeCounts = new Map<string, number>();
    for (let y = 0; y < gameMap.height; y++) {
      for (let x = 0; x < gameMap.width; x++) {
        const tile = gameMap.tiles[y]?.[x];
        if (tile) {
          typeCounts.set(tile.type, (typeCounts.get(tile.type) ?? 0) + 1);
        }
      }
    }

    // Apply search filter
    let filtered = Array.from(typeCounts.entries());
    if (searchTerm) {
      filtered = filtered.filter(([type]) => type.toLowerCase().includes(searchTerm));
    }

    const sorted = filtered.sort((a, b) => b[1] - a[1]);

    const lines = [
      `<div style="color:#8cf; font-size:14px; margin-bottom:8px;">Tile Types (${gameMap.width}×${gameMap.height})</div>`,
      `<div style="display:grid; grid-template-columns:auto 60px auto; gap:4px 12px; font-size:11px;">`,
      `<span style="color:#999;">Type</span><span style="color:#999;">Count</span><span style="color:#999;">%</span>`,
    ];

    const total = gameMap.width * gameMap.height;
    for (const [type, count] of sorted) {
      const pct = ((count / total) * 100).toFixed(1);
      lines.push(`<span>${type}</span><span style="text-align:right;">${count}</span><span style="text-align:right;">${pct}%</span>`);
    }

    lines.push('</div>');
    content.innerHTML = lines.join('\n');
  }

  function renderSpirits(): void {
    if (spirits.size === 0) {
      content.innerHTML = '<div style="color:#888; padding:20px; text-align:center;">No spirits found</div>';
      return;
    }

    let spiritList = Array.from(spirits.entries());
    
    // Apply search filter
    if (searchTerm) {
      spiritList = spiritList.filter(([id, spirit]) => {
        const searchText = `${id} ${spirit.name} ${spirit.sigil}`.toLowerCase();
        return searchText.includes(searchTerm);
      });
    }

    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:8px;';

    for (const [id, spirit] of spiritList) {
      const card = document.createElement('div');
      card.style.cssText = 'background:rgba(255,255,255,0.05); border:1px solid #444; border-radius:4px; padding:8px;';

      const isPlayer = spirit.isPlayer ? '👑 (Player)' : '';
      const followerCount = 0; // TODO: implement follower count from spirits

      card.innerHTML = [
        `<div style="color:${spirit.color}; font-size:12px; margin-bottom:4px;">${spirit.sigil} ${spirit.name} ${isPlayer}</div>`,
        `<div style="font-size:10px; color:#aaa;">ID: ${spirit.id}</div>`,
        `<div style="font-size:10px; color:#aaa;">Power: ${spirit.power ?? 0}</div>`,
        `<div style="font-size:10px; color:#aaa;">Followers: ${followerCount}</div>`,
        spirit.manifestation ? `<div style="font-size:10px; color:#aaa;">Manifestation: ${spirit.manifestation}</div>` : '',
      ].filter(Boolean).join('\n');

      list.appendChild(card);
    }

    content.appendChild(list);
  }

  function renderDecorations(): void {
    if (decorations.length === 0) {
      content.innerHTML = '<div style="color:#888; padding:20px; text-align:center;">No decorations found</div>';
      return;
    }

    let decoList = [...decorations];
    
    // Apply search filter
    if (searchTerm) {
      decoList = decoList.filter(d => d.assetId.toLowerCase().includes(searchTerm));
    }

    const lines = [
      `<div style="color:#8cf; font-size:14px; margin-bottom:8px;">Decorations (${decoList.length})</div>`,
      `<div style="display:grid; grid-template-columns:auto auto auto; gap:4px 12px; font-size:11px;">`,
      `<span style="color:#999;">Asset</span><span style="color:#999;">Tile</span><span style="color:#999;">Scale</span>`,
    ];

    for (const d of decoList) {
      const scale = (d as any).scale as number | undefined;
      lines.push(`<span>${d.assetId}</span><span>(${d.tileX},${d.tileY})</span><span>${scale?.toFixed(2) ?? '1.00'}</span>`);
    }

    lines.push('</div>');
    content.innerHTML = lines.join('\n');
  }

  function exportToJson(): void {
    const data: any = {
      timestamp: new Date().toISOString(),
      world: null as any,
      gameMap: null as any,
      spirits: {} as any,
      decorations: [] as any[],
    };

    if (world) {
      const allEntities = world.registry.all();
      data.world = {
        entityCount: allEntities.length,
        entitiesByKind: {} as Record<string, number>,
      };
      
      for (const e of allEntities) {
        data.world.entitiesByKind[e.kind] = (data.world.entitiesByKind[e.kind] ?? 0) + 1;
      }
    }

    if (gameMap) {
      data.gameMap = {
        width: gameMap.width,
        height: gameMap.height,
        tileCount: gameMap.width * gameMap.height,
      };
    }

    if (spirits) {
      data.spirits = Array.from(spirits.entries()).map(([id, spirit]) => ({
        id, name: spirit.name, sigil: spirit.sigil, power: spirit.power, isPlayer: spirit.isPlayer,
      }));
    }

    if (decorations) {
      data.decorations = decorations;
    }

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `world-inspector-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Initial render
  switchTab('world');

  container.appendChild(panel);

  return {
    element: panel,
    update(w: World | null, map: GameMap | null, s: Map<SpiritId, Spirit>, dec: GeneratedDecoration[]) {
      world = w;
      gameMap = map;
      spirits = s;
      decorations = dec;
      renderContent();
    },
    destroy() {
      panel.remove();
    },
    show() {
      panel.style.display = 'flex';
    },
    hide() {
      panel.style.display = 'none';
    },
    isVisible() {
      return panel.style.display !== 'none';
    },
    setCameraFocusCallback(callback: (x: number, y: number) => void) {
      cameraFocusCallback = callback;
    },
  };
}
