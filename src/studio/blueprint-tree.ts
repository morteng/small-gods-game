// src/studio/blueprint-tree.ts
// Node-tree inspector (browseable + editable live blueprint). The section title
// + Randomize button live on the accordion header now (no duplicate heading); this
// renders only the summary line and the editable tree.
//
// CLICK-TO-SELECT: every collapsible header carries a `data-node` attribute
// (`part:<id>` / `feature:<partId>/<featureId>`) and the returned handle exposes
// `select(pickKey)` — the studio's sprite pick-click calls it with the pick buffer's
// key (`<partId>` or `<partId>/<featureId>`), and the tree expands the ancestor part,
// expands the feature node, scrolls it into view and flash-highlights it.
import type { ResolvedBlueprint, ResolvedPart, ResolvedFeature } from '@/blueprint/types';
import type { ParamSchema, ParamSpec } from '@/blueprint/param-schema';
import { getPartType, getFeatureType } from '@/blueprint/registry';

interface TreeDeps {
  getRb: () => ResolvedBlueprint | null;
  onEdit: () => void;       // a value was mutated in place on the live blueprint
}

function partSchema(type: string): ParamSchema | undefined {
  try { return getPartType(type).paramSchema; } catch { return undefined; }
}
export function buildTree(host: HTMLElement, deps: TreeDeps): { render: () => void; select: (pickKey: string) => void } {
  const css = {
    head: 'position:sticky;top:0;z-index:1;background:var(--bg-1);padding:7px 10px;border-bottom:1px solid var(--line)',
    summary: 'font:400 10px/1.5 var(--font-mono);color:var(--info);white-space:normal;word-break:break-word',
    body: 'padding:6px 9px 16px;font:400 11px/1.4 var(--font-mono);color:var(--ink-0)',
    node: 'margin:2px 0;border-left:1px solid var(--line);padding-left:8px',
    nodeHead: 'cursor:pointer;user-select:none;padding:2px 0;color:var(--ink-0)',
    kv: 'display:flex;align-items:center;gap:6px;margin:2px 0',
    key: 'color:var(--ink-2);flex:0 0 auto',
    meta: 'font:400 10px/1.4 var(--font-mono);color:var(--ink-2);margin:2px 0',
  };
  const sect = (t: string): HTMLElement => { const d = document.createElement('div'); d.className = 'sg-eyebrow'; d.textContent = t; d.style.margin = '9px 0 3px'; return d; };

  // One editable control for obj[key]; schema-aware (enum→dropdown, number→clamped
  // range). Edits apply LIVE (oninput) so the 3D model regenerates as you change a
  // value — recurses for nested objects, JSON for arrays.
  function valueEditor(obj: Record<string, unknown>, key: string, spec?: ParamSpec): HTMLElement {
    const v = obj[key];
    // Schema enum → <select> of the exact valid values (no fragile free-text).
    if (spec?.kind === 'enum') {
      const sel = document.createElement('select'); sel.className = 'sg-input';
      for (const opt of spec.values) {
        const o = document.createElement('option'); o.value = opt; o.textContent = opt;
        if (opt === v) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => { obj[key] = sel.value; deps.onEdit(); };
      if (spec.doc) sel.title = spec.doc;
      return sel;
    }
    if (typeof v === 'boolean') {
      const c = document.createElement('input'); c.type = 'checkbox'; c.className = 'sg-check'; c.checked = v;
      if (spec?.doc) c.title = spec.doc;
      c.onchange = () => { obj[key] = c.checked; deps.onEdit(); };
      return c;
    }
    if (typeof v === 'number') {
      const i = document.createElement('input'); i.type = 'number'; i.className = 'sg-input sg-num'; i.value = String(v);
      i.step = Number.isInteger(v) ? '1' : '0.05';
      if (spec?.kind === 'number') {
        if (spec.min !== undefined) i.min = String(spec.min);
        if (spec.max !== undefined) i.max = String(spec.max);
        if (spec.doc) i.title = spec.doc;
      }
      const apply = (): void => {
        if (i.value.trim() === '') return;          // mid-edit empty: wait
        let n = Number(i.value); if (!Number.isFinite(n)) return;
        if (spec?.kind === 'number') {
          if (spec.min !== undefined) n = Math.max(spec.min, n);
          if (spec.max !== undefined) n = Math.min(spec.max, n);
        }
        obj[key] = n; deps.onEdit();
      };
      i.oninput = apply;                            // LIVE regen as you type/spin
      return i;
    }
    if (typeof v === 'string') {
      const i = document.createElement('input'); i.type = 'text'; i.className = 'sg-input'; i.style.flex = '1 1 auto'; i.style.minWidth = '0'; i.value = v;
      if (spec?.doc) i.title = spec.doc;
      i.oninput = () => { obj[key] = i.value; deps.onEdit(); };   // LIVE regen
      return i;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return paramBlock(v as Record<string, unknown>);
    }
    // arrays + anything else: editable JSON, reverts on parse failure (on commit).
    const i = document.createElement('input'); i.type = 'text'; i.className = 'sg-input'; i.style.flex = '1 1 auto'; i.style.minWidth = '0'; i.value = JSON.stringify(v);
    i.onchange = () => { try { obj[key] = JSON.parse(i.value); deps.onEdit(); } catch { i.value = JSON.stringify(obj[key]); } };
    return i;
  }

  function kvRow(obj: Record<string, unknown>, key: string, spec?: ParamSpec): HTMLElement {
    const row = document.createElement('div'); row.style.cssText = css.kv;
    const k = document.createElement('span'); k.textContent = key; k.style.cssText = css.key;
    if (spec?.doc) k.title = spec.doc;
    row.append(k, valueEditor(obj, key, spec));
    return row;
  }

  function paramBlock(params: Record<string, unknown>, schema?: ParamSchema): HTMLElement {
    const box = document.createElement('div'); box.style.cssText = css.node;
    const keys = Object.keys(params);
    if (!keys.length) { const e = document.createElement('div'); e.textContent = '(none)'; e.style.cssText = 'color:var(--ink-2);opacity:.6'; return e; }
    for (const key of keys) box.appendChild(kvRow(params, key, schema?.[key]));
    return box;
  }

  // Selectable-node registry (click-to-select): rebuilt on every render(); maps a
  // `data-node` key (`part:<id>` / `feature:<partId>/<featureId>`) to its header +
  // a programmatic expander, so `select()` can open/scroll/flash without re-rendering
  // (a re-render would collapse every other node — same rationale as onValueEdited).
  const nodeReg = new Map<string, { head: HTMLElement; open: () => void }>();

  function collapsible(label: string, openByDefault: boolean, nodeKey?: string): { el: HTMLElement; body: HTMLElement; head: HTMLElement; open: () => void } {
    const el = document.createElement('div'); el.style.cssText = css.node;
    const head = document.createElement('div'); head.style.cssText = css.nodeHead;
    const body = document.createElement('div'); body.style.display = openByDefault ? 'block' : 'none';
    const caret = () => (body.style.display === 'none' ? '▸' : '▾');
    const setLabel = () => { head.textContent = `${caret()} ${label}`; };
    head.onclick = () => { body.style.display = body.style.display === 'none' ? 'block' : 'none'; setLabel(); };
    setLabel();
    el.append(head, body);
    // Programmatic expand (idempotent) for select(): open WITHOUT toggling shut.
    const open = (): void => { if (body.style.display === 'none') { body.style.display = 'block'; setLabel(); } };
    if (nodeKey) { head.setAttribute('data-node', nodeKey); nodeReg.set(nodeKey, { head, open }); }
    return { el, body, head, open };
  }

  function featureNode(f: ResolvedFeature, partId: string): HTMLElement {
    const face = f.face ? ` · ${f.face}` : '';
    const kind = typeof f.params.kind === 'string' ? ` (${f.params.kind})` : '';
    const { el, body } = collapsible(`◦ ${f.type}${kind}${face}`, false, `feature:${partId}/${f.id}`);
    body.appendChild(paramBlock(f.params, getFeatureType(f.type)?.paramSchema));
    return el;
  }

  function partNode(p: ResolvedPart): HTMLElement {
    const mat = p.material ? ` · ${p.material}` : '';
    const { el, body } = collapsible(`▪ ${p.id} [${p.type}]${mat}`, false, `part:${p.id}`);
    const meta = document.createElement('div'); meta.style.cssText = css.meta;
    meta.textContent = `at (${p.at.x},${p.at.y})  size ${p.size.w}×${p.size.h}`;
    body.appendChild(meta);
    body.appendChild(sect('params'));
    body.appendChild(paramBlock(p.params, partSchema(p.type)));
    if (p.features.length) {
      body.appendChild(sect(`features (${p.features.length})`));
      for (const f of p.features) body.appendChild(featureNode(f, p.id));
    }
    return el;
  }

  // Brief flash highlight on the selected header — the house amber accent fading out
  // (fast in, slow out) so the eye lands on the node without a permanent selected state.
  function flash(el: HTMLElement): void {
    el.style.borderRadius = '3px';
    el.style.transition = 'background-color .12s ease-out';
    el.style.backgroundColor = 'rgba(255,194,75,.38)';   // --accent @ 38%
    window.setTimeout(() => {
      el.style.transition = 'background-color .9s ease-in';
      el.style.backgroundColor = '';
    }, 450);
  }

  /** Select a node by PICK key (`<partId>` or `<partId>/<featureId>`): expand the
   *  ancestor part (and the feature node), scroll it into view, flash-highlight. */
  function select(pickKey: string): void {
    const slash = pickKey.indexOf('/');
    const partId = slash === -1 ? pickKey : pickKey.slice(0, slash);
    const part = nodeReg.get(`part:${partId}`);
    part?.open();
    const target = (slash === -1 ? part : nodeReg.get(`feature:${pickKey}`)) ?? part;
    if (!target) return;
    target.open();
    target.head.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flash(target.head);
  }

  function render(): void {
    host.innerHTML = '';
    nodeReg.clear();          // stale registrations would select detached DOM
    const rb = deps.getRb();
    const head = document.createElement('div'); head.style.cssText = css.head;

    if (!rb) { head.appendChild(Object.assign(document.createElement('div'), { textContent: 'no blueprint for this kind', style: css.summary })); host.appendChild(head); return; }

    // Feature-type tally — the geometry truth (e.g. how many chimneys/vents the
    // model ACTUALLY has, vs whatever the img2img prompt claims).
    const counts: Record<string, number> = {};
    for (const p of rb.parts) for (const f of p.features) counts[f.type] = (counts[f.type] ?? 0) + 1;
    const vents = rb.parts.flatMap(p => p.features).filter(f => f.type === 'vent');
    const ventKinds = vents.map(v => (typeof v.params.kind === 'string' ? v.params.kind : 'vent'));
    const tally = Object.entries(counts).map(([t, n]) => `${t}×${n}`).join(' · ') || 'no features';
    const summary = document.createElement('div'); summary.style.cssText = css.summary;
    summary.textContent = `${rb.class}${rb.preset ? ` · ${rb.preset}` : ''}${rb.era ? ` · ${rb.era}` : ''} · ${rb.parts.length} part(s) · ${tally}${ventKinds.length ? `  [${ventKinds.join(', ')}]` : ''}`;
    head.appendChild(summary);
    host.appendChild(head);

    const body = document.createElement('div'); body.style.cssText = css.body;

    // ── meta: footprint + materials + palette (all editable) ──
    const metaBlock = collapsible('⚙ meta (footprint · materials · palette)', true);
    metaBlock.body.appendChild(sect('footprint'));
    metaBlock.body.appendChild(kvRow(rb.footprint as unknown as Record<string, unknown>, 'w'));
    metaBlock.body.appendChild(kvRow(rb.footprint as unknown as Record<string, unknown>, 'h'));
    metaBlock.body.appendChild(sect('materials'));
    metaBlock.body.appendChild(paramBlock(rb.materials as Record<string, unknown>));
    if (rb.palette && Object.keys(rb.palette).length) {
      metaBlock.body.appendChild(sect('palette'));
      metaBlock.body.appendChild(paramBlock(rb.palette as unknown as Record<string, unknown>));
    }
    body.appendChild(metaBlock.el);

    // ── parts ──
    body.appendChild(sect(`parts (${rb.parts.length})`));
    for (const p of rb.parts) body.appendChild(partNode(p));

    host.appendChild(body);
  }

  return { render, select };
}
