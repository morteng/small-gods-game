import type { World } from '@/world/world';
import type {
  GameMap, GeneratedDecoration, WorldSeed, DevModeState, HitResult, Entity,
} from '@/core/types';
import type { EventLog } from '@/core/events';
import type { Spirit, SpiritId } from '@/core/spirit';
import { npcProps, getRecentEventDescriptions } from '@/world/npc-helpers';
import { resolveSettlementEra } from '@/core/era';
import { renderPropertyGrid } from '@/dev/PropertyGrid';
import { injectDevStyles } from '@/dev/dev-styles';
import type { Selection } from './selection';

export interface DetailDeps {
  world: World | null;
  map: GameMap | null;
  spirits: Map<SpiritId, Spirit>;
  decorations: GeneratedDecoration[];
  eventLog: EventLog;
  seed: WorldSeed | null;
  devMode: DevModeState | null;
  onEdit: (hit: HitResult, key: string, value: unknown) => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onNavigate: (sel: Selection) => void;
  onFocusCamera: (x: number, y: number) => void;
}

export function renderDetail(host: HTMLElement, sel: Selection | null, deps: DetailDeps): void {
  injectDevStyles();
  host.innerHTML = '';
  if (!sel) { muted(host, 'Nothing selected.'); return; }

  switch (sel.type) {
    case 'entity': return renderEntity(host, sel.id, deps);
    case 'tile':   return renderTile(host, sel.x, sel.y, deps);
    case 'decoration': return renderDecoration(host, sel.index, deps);
    case 'spirit': return renderSpirit(host, sel.id, deps);
    case 'world':  return renderWorld(host, deps);
    case 'lore':   return renderLore(host, deps);
    case 'poi':    return renderPoi(host, sel.id, deps);
  }
}

// ── helpers ────────────────────────────────────────────────
function muted(host: HTMLElement, text: string): void {
  const d = document.createElement('div');
  d.className = 'sg-dev-muted';
  d.textContent = text;
  host.appendChild(d);
}
function title(host: HTMLElement, text: string): void {
  const d = document.createElement('div');
  d.className = 'sg-dev-section-title';
  d.textContent = text;
  host.appendChild(d);
}
function card(host: HTMLElement, rows: [string, string][]): void {
  const c = document.createElement('div');
  c.className = 'sg-dev-card';
  for (const [k, v] of rows) {
    const row = document.createElement('div');
    row.className = 'sg-dev-row';
    const label = document.createElement('span');
    label.className = 'sg-dev-label';
    label.textContent = k;
    const val = document.createElement('span');
    val.textContent = v;
    row.append(label, val);
    c.appendChild(row);
  }
  host.appendChild(c);
}

function renderEntity(host: HTMLElement, id: string, deps: DetailDeps): void {
  const e = deps.world?.registry.get(id);
  if (!e) { muted(host, 'Selection no longer present.'); return; }

  title(host, `${e.kind} · ${e.id}`);

  const isNpc = e.kind === 'npc' || e.kind === 'remains';
  if (isNpc) renderNpcSections(host, e, deps);

  // Editable basics (kind/x/y + JSON properties). Emit edits as an 'entity' hit
  // so the existing applyInspectorEdit handles them unchanged.
  title(host, 'Edit');
  const editHost = document.createElement('div');
  host.appendChild(editHost);
  const hit: HitResult = { type: 'entity', tileX: Math.floor(e.x), tileY: Math.floor(e.y), entity: e };
  renderPropertyGrid(editHost, hit, (key, value) => deps.onEdit(hit, key, value));

  renderActions(host, e, deps);
}

function renderNpcSections(host: HTMLElement, e: Entity, deps: DetailDeps): void {
  const p = npcProps(e);

  title(host, 'Beliefs');
  const beliefRows: [string, string][] = Object.entries(p.beliefs ?? {}).map(([sid, b]) =>
    [sid, `faith ${pct(b.faith)} · understanding ${pct(b.understanding)} · devotion ${pct(b.devotion)}`]);
  if (beliefRows.length) card(host, beliefRows); else muted(host, 'No beliefs.');

  title(host, 'Needs');
  const n = p.needs;
  card(host, [['safety', pct(n.safety)], ['prosperity', pct(n.prosperity)], ['community', pct(n.community)], ['meaning', pct(n.meaning)]]);

  title(host, 'Personality');
  const pe = p.personality;
  card(host, [['assertiveness', pct(pe.assertiveness)], ['skepticism', pct(pe.skepticism)], ['piety', pct(pe.piety)], ['sociability', pct(pe.sociability)]]);

  title(host, 'Lineage');
  const lineage = document.createElement('div');
  lineage.className = 'sg-dev-card';
  const parents = p.parentIds ?? [];
  if (parents.length === 0) lineage.appendChild(textRow('parents', 'none'));
  for (const pid of parents) lineage.appendChild(linkRow('parent', pid, () => deps.onNavigate({ type: 'entity', id: pid })));
  host.appendChild(lineage);

  title(host, 'Relationships');
  const rels = p.relationships ?? [];
  if (rels.length) card(host, rels.map(r => [r.type, `${r.npcId} (trust ${pct(r.trust)})`])); else muted(host, 'No relationships.');

  title(host, 'Recent events');
  const events = getRecentEventDescriptions(p, deps.eventLog);
  if (events.length) card(host, events.map(ev => ['•', ev])); else muted(host, 'No remembered events.');
}

function textRow(k: string, v: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sg-dev-row';
  const label = document.createElement('span'); label.className = 'sg-dev-label'; label.textContent = k;
  const val = document.createElement('span'); val.textContent = v;
  row.append(label, val);
  return row;
}
function linkRow(k: string, v: string, onClick: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sg-dev-row';
  const label = document.createElement('span'); label.className = 'sg-dev-label'; label.textContent = k;
  const link = document.createElement('span'); link.className = 'sg-dev-link'; link.textContent = v;
  link.addEventListener('click', onClick);
  row.append(label, link);
  return row;
}

function renderActions(host: HTMLElement, e: Entity, deps: DetailDeps): void {
  title(host, 'Actions');
  host.appendChild(btn('🎯 Focus camera', () => deps.onFocusCamera(e.x, e.y)));
  host.appendChild(btn('🗑 Delete', () => deps.onDelete(), true));
  const undo = btn('↩ Undo', () => deps.onUndo());
  const redo = btn('↪ Redo', () => deps.onRedo());
  undo.toggleAttribute('disabled', (deps.devMode?.undoStack.length ?? 0) === 0);
  redo.toggleAttribute('disabled', (deps.devMode?.redoStack.length ?? 0) === 0);
  host.append(undo, redo);
}
function btn(label: string, onClick: () => void, danger = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = danger ? 'sg-dev-btn sg-dev-btn--danger' : 'sg-dev-btn';
  b.style.display = 'block';
  b.style.width = '100%';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderTile(host: HTMLElement, x: number, y: number, deps: DetailDeps): void {
  const tile = deps.map?.tiles[y]?.[x];
  title(host, `Tile (${x}, ${y})`);
  if (!tile) { muted(host, 'No tile.'); return; }
  const hit: HitResult = { type: 'tile', tileX: x, tileY: y, tile };
  renderPropertyGrid(host, hit, (key, value) => deps.onEdit(hit, key, value));
}

function renderDecoration(host: HTMLElement, index: number, deps: DetailDeps): void {
  const dec = index >= 0 ? deps.decorations[index] : undefined;
  title(host, 'Decoration');
  if (!dec) { muted(host, 'Selection no longer present.'); return; }
  const hit: HitResult = { type: 'decoration', tileX: dec.tileX, tileY: dec.tileY, decoration: dec };
  renderPropertyGrid(host, hit, (key, value) => deps.onEdit(hit, key, value));
}

function renderSpirit(host: HTMLElement, id: string, deps: DetailDeps): void {
  const s = deps.spirits.get(id);
  title(host, 'Spirit');
  if (!s) { muted(host, 'Selection no longer present.'); return; }
  card(host, [
    ['name', `${s.sigil} ${s.name}`],
    ['id', s.id],
    ['power', String(Math.round(s.power))],
    ['player', s.isPlayer ? 'yes' : 'no'],
    ['manifestation', s.manifestation ? s.manifestation.kind : 'none'],
  ]);
  // Focus on the spirit's manifestation, if it's incarnated in the world.
  const manifestId = s.manifestation
    ? (s.manifestation.kind === 'avatar' ? s.manifestation.entityId : s.manifestation.npcEntityId)
    : null;
  const manifestEntity = manifestId ? deps.world?.registry.get(manifestId) : undefined;
  if (manifestEntity) {
    title(host, 'Actions');
    host.appendChild(btn('🎯 Focus manifestation', () => deps.onFocusCamera(manifestEntity.x, manifestEntity.y)));
  }
}

function renderWorld(host: HTMLElement, deps: DetailDeps): void {
  title(host, 'World — Generation');
  const seed = deps.seed;
  const all = deps.world?.registry.all() ?? [];
  card(host, [
    ['name', seed?.name ?? 'unknown'],
    ['size', seed ? `${seed.size.width} × ${seed.size.height}` : '—'],
    ['biome', seed?.biome ?? '—'],
    ['era', seed?.era ?? 'medieval (default)'],
    ['visualTheme', seed?.visualTheme ?? '—'],
    ['constraints', (seed?.constraints ?? []).join(', ') || 'none'],
    ['POIs', String(seed?.pois.length ?? 0)],
    ['entities', String(all.length)],
  ]);
  if (!seed) return;

  // The world is generated from this JSON recipe — surface it so the inspector
  // can answer "what does the recipe say?" without opening the file.
  title(host, `Recipe — POIs (${seed.pois.length})`);
  if (seed.pois.length === 0) {
    muted(host, 'No POIs in recipe.');
  } else {
    for (const poi of seed.pois) {
      const era = resolveSettlementEra(poi, seed);
      const pos = poi.position ? `(${poi.position.x},${poi.position.y})` : poi.region ? 'region' : '—';
      const n = poi.npcs?.length ?? 0;
      const label = `📍 ${poi.name ?? poi.id} · ${poi.type} · ${era} · ${pos}${n ? ` · ${n} NPC${n > 1 ? 's' : ''}` : ''}`;
      host.appendChild(btn(label, () => deps.onNavigate({ type: 'poi', id: poi.id })));
    }
  }

  if (seed.connections.length) {
    title(host, `Connections (${seed.connections.length})`);
    card(host, seed.connections.map(
      (c) => [`${c.from} → ${c.to}`, `${c.type}${c.style ? ` · ${c.style}` : ''}`] as [string, string],
    ));
  }

  title(host, 'Raw recipe');
  jsonBlock(host, seed);
}

/** Collapsible, scrollable JSON dump. */
function jsonBlock(host: HTMLElement, value: unknown): void {
  const det = document.createElement('details');
  det.className = 'sg-dev-card';
  const sum = document.createElement('summary');
  sum.textContent = 'Show JSON';
  sum.style.cursor = 'pointer';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(value, null, 2);
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.wordBreak = 'break-word';
  pre.style.maxHeight = '320px';
  pre.style.overflow = 'auto';
  pre.style.fontSize = '11px';
  pre.style.margin = '6px 0 0';
  det.append(sum, pre);
  host.appendChild(det);
}

function renderLore(host: HTMLElement, deps: DetailDeps): void {
  title(host, 'Lore');
  const lore = deps.seed?.lore;
  if (!lore) { muted(host, 'No lore recorded.'); return; }
  card(host, [
    ['history', lore.history ?? '—'],
    ['factions', (lore.factions ?? []).join(', ') || '—'],
    ['quests', (lore.quests ?? []).join(', ') || '—'],
  ]);
}

function renderPoi(host: HTMLElement, id: string, deps: DetailDeps): void {
  const poi = deps.seed?.pois.find(p => p.id === id);
  title(host, 'POI');
  if (!poi) { muted(host, 'Selection no longer present.'); return; }

  const ents = deps.world?.registry.getByPoi(poi.id) ?? [];
  const rows: [string, string][] = [
    ['name', poi.name ?? poi.id],
    ['type', poi.type],
    ['id', poi.id],
    ['size', poi.size ?? '—'],
    ['importance', poi.importance ?? '—'],
  ];
  if (poi.position) rows.push(['position', `(${poi.position.x}, ${poi.position.y})`]);
  if (poi.region) rows.push(['region', `x ${poi.region.x_min}–${poi.region.x_max} · y ${poi.region.y_min}–${poi.region.y_max}`]);
  rows.push(['entities here', String(ents.length)]);
  rows.push(['seed NPCs', String(poi.npcs?.length ?? 0)]);
  card(host, rows);

  if (poi.description) {
    title(host, 'Description');
    const d = document.createElement('div');
    d.className = 'sg-dev-card';
    d.textContent = poi.description;
    host.appendChild(d);
  }

  // Co-located entities — navigable into the tree's detail.
  if (ents.length) {
    title(host, `Entities at this POI (${ents.length})`);
    const c = document.createElement('div');
    c.className = 'sg-dev-card';
    for (const e of ents.slice(0, 30)) {
      c.appendChild(linkRow(e.kind, e.id, () => deps.onNavigate({ type: 'entity', id: e.id })));
    }
    host.appendChild(c);
  }

  // Focus camera: prefer the POI's own position, else its region centre, else
  // the first co-located entity.
  const target = poiFocusTarget(poi, ents);
  if (target) {
    title(host, 'Actions');
    host.appendChild(btn('🎯 Focus camera', () => deps.onFocusCamera(target.x, target.y)));
  }
}

function poiFocusTarget(
  poi: { position?: { x: number; y: number }; region?: { x_min: number; x_max: number; y_min: number; y_max: number } },
  ents: Entity[],
): { x: number; y: number } | null {
  if (poi.position) return poi.position;
  if (poi.region) return { x: (poi.region.x_min + poi.region.x_max) / 2, y: (poi.region.y_min + poi.region.y_max) / 2 };
  if (ents.length) return { x: ents[0].x, y: ents[0].y };
  return null;
}

function pct(v: number | undefined): string { return `${Math.round((v ?? 0) * 100)}%`; }
