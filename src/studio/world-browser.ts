// src/studio/world-browser.ts
//
// The world-studio's left panel — the "World Browser" counterpart to the object
// studio's Object Browser. Three stacked sections:
//   1. Worlds   — pick a world config, type/roll a seed, pick a scale preset.
//                 Any change calls back to the studio to regenerate live.
//   2. Breadcrumb — World ▸ Settlement ▸ Building; click a crumb to pop up a level.
//   3. Inspector  — the focused connectome node's fields; at the building level
//                   an "Edit in studio ↗" button hands off to the object editor.
//
// Pure DOM + callbacks; the studio owns the map/focus state and feeds this panel
// an {@link InspectorModel} whenever the focus changes.

import type { ScalePreset } from '@/core/world-style';
import { h } from './theme';

export type CrumbLevel = 'world' | 'settlement' | 'building';

/** An editable field in the node inspector — a labelled chip-select of options. */
export interface InspectorField {
  key: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}

/** An action button under the node inspector (Frame / Regenerate / Remove …). */
export interface InspectorAction {
  label: string;
  onClick: () => void;
  /** 'accent' = primary; 'danger' = destructive (remove). */
  tone?: 'accent' | 'danger' | 'default';
}

export interface InspectorModel {
  breadcrumb: { label: string; level: CrumbLevel }[];
  title: string;
  subtitle?: string;
  rows: [string, string][];
  /** Editable node params rendered as chip-selects below the rows. */
  fields?: InspectorField[];
  /** Action buttons rendered below the fields. */
  actions?: InspectorAction[];
  /** Present only at the building level → renders the handoff button. */
  editTemplateId?: string;
  /** Optional hint line under the inspector (e.g. "click a settlement to drill"). */
  hint?: string;
}

const SCALES: ScalePreset[] = ['simulator', 'natural', 'storybook'];

export interface WorldBrowserDeps {
  configs: () => string[];
  getConfig: () => string;
  onConfig: (name: string) => void;
  getSeed: () => number;
  onSeed: (seed: number) => void;
  getScale: () => ScalePreset | null;
  onScale: (s: ScalePreset | null) => void;
  onCrumb: (level: CrumbLevel) => void;
  onEdit: (templateId: string) => void;
}

export interface WorldBrowserHandle {
  /** Re-render the breadcrumb + inspector for the current focus. */
  setInspector: (m: InspectorModel) => void;
  /** Re-sync the world controls (seed label, active scale chip) after a regen. */
  refreshControls: () => void;
}

const hex = (n: number): string => '0x' + (n >>> 0).toString(16).toUpperCase();

export function buildWorldBrowser(host: HTMLElement, deps: WorldBrowserDeps): WorldBrowserHandle {
  host.style.cssText +=
    ';display:flex;flex-direction:column;height:100%;overflow:hidden;' +
    'font:400 11px/1.5 var(--font-mono);color:var(--ink-0)';

  // ── 1) Worlds section ──────────────────────────────────────────────────────
  const worlds = h('div', { style: 'padding:9px 10px;border-bottom:1px solid var(--line)' });
  worlds.append(h('div', { class: 'sg-muted', style: 'font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-1);margin-bottom:7px', text: 'Worlds' }));

  // config row (single config today; lists whatever the studio offers)
  const configRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px' });
  const configChips: { name: string; el: HTMLElement }[] = [];
  for (const name of deps.configs()) {
    const el = h('span', { class: 'sg-chip', text: name, on: { click: () => deps.onConfig(name) } });
    configChips.push({ name, el });
    configRow.append(el);
  }
  worlds.append(configRow);

  // seed row: hex label + edit input + roll
  const seedLabel = h('span', { style: 'font-variant-numeric:tabular-nums;color:var(--info)' });
  const seedInput = h('input', {
    class: 'sg-search', style: 'width:96px;margin:0',
    attrs: { type: 'text', spellcheck: 'false', title: 'seed (decimal or 0x hex)' },
  }) as HTMLInputElement;
  const commitSeed = (): void => {
    const raw = seedInput.value.trim();
    const n = raw.startsWith('0x') ? parseInt(raw, 16) : parseInt(raw, 10);
    if (Number.isFinite(n)) deps.onSeed(n >>> 0);
  };
  seedInput.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') commitSeed(); });
  seedInput.addEventListener('blur', commitSeed);
  const rollBtn = h('button', {
    class: 'sg-btn', style: 'padding:3px 8px', title: 'Roll a new random seed',
    html: '🎲 <span style="opacity:.7">Roll</span>',
    on: { click: () => deps.onSeed((Math.floor(Math.random() * 0xffffffff)) >>> 0) },
  });
  const seedRow = h('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:9px' },
    h('span', { class: 'sg-muted', text: 'seed' }), seedLabel, seedInput, rollBtn);
  worlds.append(seedRow);

  // scale-preset chip row ("game factor")
  const scaleRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;align-items:center' },
    h('span', { class: 'sg-muted', style: 'margin-right:2px', text: 'scale' }));
  const scaleChips: { v: ScalePreset; el: HTMLElement }[] = [];
  for (const v of SCALES) {
    const el = h('span', { class: 'sg-chip', text: v, on: { click: () => deps.onScale(deps.getScale() === v ? null : v) } });
    scaleChips.push({ v, el });
    scaleRow.append(el);
  }
  worlds.append(scaleRow);

  // ── 2) Breadcrumb ──────────────────────────────────────────────────────────
  const crumbBar = h('div', { style: 'padding:7px 10px;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:3px;align-items:center;min-height:30px' });

  // ── 3) Inspector ───────────────────────────────────────────────────────────
  const inspector = h('div', { style: 'flex:1 1 auto;overflow:auto;padding:9px 10px' });

  host.append(worlds, crumbBar, inspector);

  function refreshControls(): void {
    const cfg = deps.getConfig();
    for (const c of configChips) c.el.classList.toggle('is-on', c.name === cfg);
    const scale = deps.getScale();
    for (const c of scaleChips) c.el.classList.toggle('is-on', c.v === scale);
    seedLabel.textContent = hex(deps.getSeed());
    if (document.activeElement !== seedInput) seedInput.value = hex(deps.getSeed());
  }
  refreshControls();

  function setInspector(m: InspectorModel): void {
    // breadcrumb
    crumbBar.replaceChildren();
    m.breadcrumb.forEach((c, i) => {
      if (i > 0) crumbBar.append(h('span', { class: 'sg-muted', style: 'opacity:.5', text: '▸' }));
      const last = i === m.breadcrumb.length - 1;
      crumbBar.append(h('span', {
        class: 'sg-chip', style: last ? 'background:var(--bg-3);color:var(--accent)' : 'cursor:pointer',
        text: c.label, on: last ? {} : { click: () => deps.onCrumb(c.level) },
      }));
    });

    // inspector body
    inspector.replaceChildren();
    inspector.append(h('div', { style: 'font-weight:700;color:var(--ink-0);margin-bottom:2px', text: m.title }));
    if (m.subtitle) inspector.append(h('div', { class: 'sg-muted', style: 'color:var(--ink-1);margin-bottom:8px', text: m.subtitle }));
    const table = h('div', { style: 'display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin-top:6px' });
    for (const [k, v] of m.rows) {
      table.append(
        h('span', { class: 'sg-muted', style: 'color:var(--ink-2)', text: k }),
        h('span', { style: 'color:var(--ink-0);font-variant-numeric:tabular-nums', text: v }),
      );
    }
    inspector.append(table);

    // editable node params — each a labelled row of selectable chips
    if (m.fields?.length) {
      const fieldsBox = h('div', { style: 'margin-top:12px;display:flex;flex-direction:column;gap:7px' });
      for (const f of m.fields) {
        const chips = f.options.map((o) => h('span', {
          class: 'sg-chip', text: o.label,
          style: o.value === f.value ? 'background:var(--bg-3);color:var(--accent)' : 'cursor:pointer',
          on: { click: () => { if (o.value !== f.value) f.onChange(o.value); } },
        }));
        fieldsBox.append(h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;align-items:center' },
          h('span', { class: 'sg-muted', style: 'color:var(--ink-2);min-width:64px', text: f.key }), ...chips));
      }
      inspector.append(fieldsBox);
    }

    // action buttons (Frame / Regenerate / Remove …)
    if (m.actions?.length) {
      const actionsBox = h('div', { style: 'margin-top:12px;display:flex;flex-wrap:wrap;gap:6px' });
      for (const a of m.actions) {
        const bg = a.tone === 'accent' ? 'background:var(--accent);color:var(--accent-ink);font-weight:700'
          : a.tone === 'danger' ? 'background:var(--bg-2);color:var(--danger,#e06)' : '';
        actionsBox.append(h('button', { class: 'sg-btn', style: `padding:5px 10px;${bg}`, text: a.label, on: { click: a.onClick } }));
      }
      inspector.append(actionsBox);
    }

    if (m.editTemplateId) {
      inspector.append(h('button', {
        class: 'sg-btn', style: 'margin-top:12px;width:100%;padding:6px;background:var(--accent);color:var(--accent-ink);font-weight:700',
        html: `Edit “${m.editTemplateId}” in studio ↗`,
        on: { click: () => deps.onEdit(m.editTemplateId!) },
      }));
    }
    if (m.hint) inspector.append(h('div', { class: 'sg-muted', style: 'color:var(--ink-2);margin-top:12px;font-style:italic', text: m.hint }));
  }

  return { setInspector, refreshControls };
}
