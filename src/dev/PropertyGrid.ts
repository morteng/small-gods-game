import type { Tile, Entity, NpcInstance, GeneratedDecoration } from '@/core/types';
import type { HitResult } from '@/core/types';
import { injectDevStyles } from '@/dev/dev-styles';

/**
 * Property field descriptor for the generic property grid.
 */
export interface PropertyField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'json';
  options?: string[];
  min?: number;
  max?: number;
  readonly?: boolean;
}

/** Render label+input rows for a list of fields into `container`. */
export function renderFields(
  container: HTMLElement,
  fields: PropertyField[],
  getValue: (key: string) => unknown,
  onChange: (key: string, value: unknown) => void,
): void {
  injectDevStyles();
  for (const field of fields) {
    const row = document.createElement('div');
    row.className = 'sg-dev-row';
    const label = document.createElement('span');
    label.className = 'sg-dev-label';
    label.textContent = field.label;
    row.appendChild(label);
    row.appendChild(createInputForField(field, getValue(field.key), v => onChange(field.key, v)));
    container.appendChild(row);
  }
}

/**
 * Render a property grid into the given container.
 * Creates label + input pairs based on the object's properties.
 */
export function renderPropertyGrid(
  container: HTMLElement,
  hit: HitResult,
  onChange: (key: string, value: unknown) => void,
): void {
  container.innerHTML = '';

  switch (hit.type) {
    case 'tile':
      renderTileProperties(container, hit.tile, hit.tileX, hit.tileY, onChange);
      break;
    case 'entity':
      renderEntityProperties(container, hit.entity, onChange);
      break;
    case 'npc':
      renderNpcProperties(container, hit.npc, onChange);
      break;
    case 'decoration':
      renderDecorationProperties(container, hit.decoration, onChange);
      break;
  }
}

function renderTileProperties(
  container: HTMLElement,
  tile: Tile | undefined,
  _tx: number,
  _ty: number,
  onChange: (key: string, value: unknown) => void,
): void {
  if (!tile) {
    container.textContent = 'No tile data';
    return;
  }

  const fields: PropertyField[] = [
    { key: 'type', label: 'Type', type: 'enum', options: getTileTypes() },
    { key: 'walkable', label: 'Walkable', type: 'boolean' },
    { key: 'state', label: 'State', type: 'enum', options: ['void', 'realizing', 'realized'] },
  ];

  if (tile.height !== undefined) {
    fields.push({ key: 'height', label: 'Height', type: 'number', min: 0, max: 1, readonly: false });
  }
  if (tile.bridgeDirection !== undefined) {
    fields.push({ key: 'bridgeDirection', label: 'Bridge', type: 'enum', options: ['north', 'south', 'east', 'west', 'none'] });
  }

  const tileRecord = tile as unknown as Record<string, unknown>;
  renderFields(container, fields, key => tileRecord[key], onChange);
}

function renderEntityProperties(
  container: HTMLElement,
  entity: Entity | undefined,
  onChange: (key: string, value: unknown) => void,
): void {
  if (!entity) {
    container.textContent = 'No entity data';
    return;
  }

  // Basic entity fields
  const fields: PropertyField[] = [
    { key: 'kind', label: 'Kind', type: 'string', readonly: true },
    { key: 'x', label: 'X', type: 'number' },
    { key: 'y', label: 'Y', type: 'number' },
  ];

  renderFields(
    container,
    fields,
    key => key === 'kind' ? entity.kind : (entity as unknown as Record<string, unknown>)[key],
    onChange,
  );

  // Properties object (JSON editor)
  if (entity.properties && Object.keys(entity.properties).length > 0) {
    const propsLabel = document.createElement('div');
    propsLabel.style.cssText = 'color:#999; font-size:11px; margin-top:8px; margin-bottom:2px;';
    propsLabel.textContent = 'Properties (JSON)';
    container.appendChild(propsLabel);

    const textarea = document.createElement('textarea');
    textarea.value = JSON.stringify(entity.properties, null, 2);
    textarea.className = 'sg-dev-textarea';
    textarea.addEventListener('change', () => {
      try {
        const parsed = JSON.parse(textarea.value);
        textarea.classList.remove('sg-dev-textarea--bad');
        onChange('properties', parsed);
      } catch {
        textarea.classList.add('sg-dev-textarea--bad');
      }
    });
    textarea.addEventListener('focus', () => { textarea.classList.remove('sg-dev-textarea--bad'); });
    container.appendChild(textarea);
  }
}

function renderNpcProperties(
  container: HTMLElement,
  npc: NpcInstance | undefined,
  onChange: (key: string, value: unknown) => void,
): void {
  if (!npc) {
    container.textContent = 'No NPC data';
    return;
  }

  const fields: PropertyField[] = [
    { key: 'name', label: 'Name', type: 'string' },
    { key: 'role', label: 'Role', type: 'enum', options: ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'] },
    { key: 'tileX', label: 'Tile X', type: 'number', readonly: true },
    { key: 'tileY', label: 'Tile Y', type: 'number', readonly: true },
    { key: 'direction', label: 'Direction', type: 'enum', options: ['up', 'down', 'left', 'right'] },
    { key: 'frame', label: 'Frame', type: 'number', min: 0, max: 8 },
  ];

  const npcRecord = npc as unknown as Record<string, unknown>;
  renderFields(container, fields, key => npcRecord[key], onChange);
}

function renderDecorationProperties(
  container: HTMLElement,
  decoration: GeneratedDecoration | undefined,
  onChange: (key: string, value: unknown) => void,
): void {
  if (!decoration) {
    container.textContent = 'No decoration data';
    return;
  }

  const fields: PropertyField[] = [
    { key: 'tileX', label: 'Tile X', type: 'number' },
    { key: 'tileY', label: 'Tile Y', type: 'number' },
    { key: 'assetId', label: 'Asset ID', type: 'string', readonly: true },
  ];

  const decRecord = decoration as unknown as Record<string, unknown>;
  renderFields(container, fields, key => decRecord[key], onChange);
}

/**
 * Create an input element based on field type.
 */
function createInputForField(
  field: PropertyField,
  currentValue: unknown,
  onChange: (value: unknown) => void,
): HTMLElement {
  const isReadonly = field.readonly;

  if (field.type === 'boolean') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!currentValue;
    checkbox.disabled = !!isReadonly;
    checkbox.style.justifySelf = 'start';
    if (!isReadonly) {
      checkbox.addEventListener('change', () => onChange(checkbox.checked));
    }
    return checkbox;
  }

  if (field.type === 'enum' && field.options) {
    const select = document.createElement('select');
    select.className = 'sg-dev-select';
    select.disabled = !!isReadonly;

    for (const opt of field.options) {
      const option = document.createElement('option');
      option.value = opt ?? 'undefined';
      option.textContent = opt ?? '(none)';
      if (opt === currentValue) option.selected = true;
      select.appendChild(option);
    }

    if (!isReadonly) {
      select.addEventListener('change', () => {
        const val = select.value === 'undefined' ? undefined : select.value;
        onChange(val);
      });
    }
    return select;
  }

  if (field.type === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(currentValue ?? 0);
    input.readOnly = !!isReadonly;
    input.className = 'sg-dev-input';
    input.style.maxWidth = '90px';
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);

    if (!isReadonly) {
      input.addEventListener('change', () => {
        const num = parseFloat(input.value);
        onChange(isNaN(num) ? input.value : num);
      });
    }
    return input;
  }

  // Default: string input
  const input = document.createElement('input');
  input.type = 'text';
  input.value = String(currentValue ?? '');
  input.readOnly = !!isReadonly;
  input.className = 'sg-dev-input';

  if (!isReadonly) {
    input.addEventListener('change', () => onChange(input.value));
  }
  return input;
}

/**
 * Get available tile types from constants.
 */
function getTileTypes(): string[] {
  return [
    'grass', 'forest', 'dense_forest', 'pine_forest', 'scrubland',
    'water', 'shallow_water', 'deep_water', 'beach',
    'mountain', 'hills', 'boulder',
    'road', 'dirt_road', 'stone_road', 'bridge',
    'void',
  ];
}
