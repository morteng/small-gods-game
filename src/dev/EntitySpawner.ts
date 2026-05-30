import type { Entity, NpcRole } from '@/core/types';
import type { World } from '@/world/world';

export interface SpawnOptions {
  kind: string;
  x: number;
  y: number;
  properties?: Record<string, unknown>;
}

export interface EntitySpawnerHandle {
  open(x: number, y: number): Promise<SpawnOptions | null>;
  destroy(): void;
}

/**
 * Modal for spawning new entities (NPCs, decorations, buildings, etc.)
 */
export function createEntitySpawner(container: HTMLElement): EntitySpawnerHandle {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
    'background:rgba(0,0,0,0.5)', 'display:none', 'z-index:1000',
    'justify-content:center', 'align-items:center',
  ].join(';');

  const modal = document.createElement('div');
  modal.style.cssText = [
    'background:rgba(25,25,35,0.95)', 'color:#e0e0e0',
    'border:1px solid #555', 'border-radius:8px',
    'padding:20px', 'min-width:300px', 'max-width:400px',
    'font:13px/1.5 sans-serif', 'box-shadow:0 4px 20px rgba(0,0,0,0.5)',
  ].join(';');

  // Title
  const title = document.createElement('h3');
  title.textContent = '⚡ Spawn Entity';
  title.style.cssText = 'margin:0 0 16px 0; font-size:16px; border-bottom:1px solid #444; padding-bottom:8px;';
  modal.appendChild(title);

  // Form fields
  const form = document.createElement('div');
  form.style.cssText = 'display:flex; flex-direction:column; gap:12px;';

  // Kind selector
  const kindGroup = createFormGroup('Entity Kind:');
  const kindSelect = document.createElement('select');
  kindSelect.style.cssText = 'padding:6px 8px; background:#1a1a2e; color:#e0e0e0; border:1px solid #555; border-radius:4px; font-size:12px;';
  const kinds = ['npc', 'decoration', 'building', 'vegetation', 'poi_marker'];
  for (const k of kinds) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k;
    kindSelect.appendChild(opt);
  }
  kindGroup.appendChild(kindSelect);
  form.appendChild(kindGroup);

  // Role selector (for NPCs)
  const roleGroup = createFormGroup('NPC Role:');
  const roleSelect = document.createElement('select');
  roleSelect.style.cssText = 'padding:6px 8px; background:#1a1a2e; color:#e0e0e0; border:1px solid #555; border-radius:4px; font-size:12px;';
  const roles: NpcRole[] = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'];
  for (const r of roles) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    roleSelect.appendChild(opt);
  }
  roleGroup.appendChild(roleSelect);
  form.appendChild(roleGroup);

  // Coordinates display
  const coordsGroup = createFormGroup('Coordinates:');
  const coordsDisplay = document.createElement('div');
  coordsDisplay.style.cssText = 'padding:6px 8px; background:#1a1a2e; border:1px solid #333; border-radius:4px; font-size:12px; font-family:monospace;';
  coordsGroup.appendChild(coordsDisplay);
  form.appendChild(coordsGroup);

  // Buttons
  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'display:flex; gap:8px; margin-top:16px;';

  const spawnBtn = document.createElement('button');
  spawnBtn.type = 'button';
  spawnBtn.textContent = '✨ Spawn';
  spawnBtn.style.cssText = 'flex:1; padding:8px 16px; background:#4a9eff; color:#fff; border:none; border-radius:4px; font-size:13px; cursor:pointer;';
  spawnBtn.addEventListener('mouseenter', () => { spawnBtn.style.background = '#3a8eef'; });
  spawnBtn.addEventListener('mouseleave', () => { spawnBtn.style.background = '#4a9eff'; });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'flex:1; padding:8px 16px; background:rgba(255,255,255,0.1); color:#e0e0e0; border:1px solid #555; border-radius:4px; font-size:13px; cursor:pointer;';
  cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = 'rgba(255,255,255,0.2)'; });
  cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'rgba(255,255,255,0.1)'; });

  btnGroup.appendChild(spawnBtn);
  btnGroup.appendChild(cancelBtn);
  form.appendChild(btnGroup);

  modal.appendChild(form);
  overlay.appendChild(modal);
  container.appendChild(overlay);

  let resolvePromise: ((value: SpawnOptions | null) => void) | null = null;
  let currentX = 0;
  let currentY = 0;

  function updateCoords(x: number, y: number): void {
    currentX = x;
    currentY = y;
    coordsDisplay.textContent = `(${x}, ${y})`;
  }

  spawnBtn.addEventListener('click', () => {
    const kind = kindSelect.value;
    const props: Record<string, unknown> = {};

    if (kind === 'npc') {
      props.role = roleSelect.value;
      props.name = `NPC_${Date.now().toString(36)}`;
      props.personality = {
        assertiveness: 0.5,
        skepticism: 0.3,
        piety: 0.5,
        sociability: 0.5,
      };
      props.beliefs = {};
      props.needs = { safety: 0.7, prosperity: 0.7, community: 0.7, meaning: 0.7 };
      props.mood = 0.7;
      props.whisperCooldown = 0;
      props.activity = 'idle';
      props.recentEventIds = [];
    }

    const result: SpawnOptions = {
      kind,
      x: currentX,
      y: currentY,
      properties: props,
    };

    overlay.style.display = 'none';
    if (resolvePromise) {
      resolvePromise(result);
      resolvePromise = null;
    }
  });

  cancelBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    if (resolvePromise) {
      resolvePromise(null);
      resolvePromise = null;
    }
  });

  // Update role visibility based on kind selection
  kindSelect.addEventListener('change', () => {
    roleGroup.style.display = kindSelect.value === 'npc' ? 'flex' : 'none';
  });

  return {
    open(x: number, y: number): Promise<SpawnOptions | null> {
      updateCoords(x, y);
      overlay.style.display = 'flex';
      kindSelect.value = 'npc';
      roleGroup.style.display = 'flex';

      return new Promise((resolve) => {
        resolvePromise = resolve;
      });
    },
    destroy() {
      overlay.remove();
    },
  };
}

function createFormGroup(label: string): HTMLDivElement {
  const group = document.createElement('div');
  group.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style.cssText = 'font-size:11px; color:#8cf;';
  group.appendChild(lbl);
  return group;
}
