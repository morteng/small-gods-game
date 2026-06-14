// src/studio/blueprint-tree.ts
// Node-tree inspector (browseable + editable live blueprint). The section title
// + Randomize button live on the accordion header now (no duplicate heading); this
// renders only the summary line and the editable tree.
import type { ResolvedBlueprint, ResolvedPart, ResolvedFeature } from '@/blueprint/types';

interface TreeDeps {
  getRb: () => ResolvedBlueprint | null;
  onEdit: () => void;       // a value was mutated in place on the live blueprint
}
export function buildTree(host: HTMLElement, deps: TreeDeps): { render: () => void } {
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

  // One editable control for obj[key]; recurses for nested objects, JSON for arrays.
  function valueEditor(obj: Record<string, unknown>, key: string): HTMLElement {
    const v = obj[key];
    if (typeof v === 'boolean') {
      const c = document.createElement('input'); c.type = 'checkbox'; c.className = 'sg-check'; c.checked = v;
      c.onchange = () => { obj[key] = c.checked; deps.onEdit(); };
      return c;
    }
    if (typeof v === 'number') {
      const i = document.createElement('input'); i.type = 'number'; i.className = 'sg-input sg-num'; i.value = String(v);
      i.step = Number.isInteger(v) ? '1' : '0.05';
      i.onchange = () => { const n = Number(i.value); if (Number.isFinite(n)) { obj[key] = n; deps.onEdit(); } };
      return i;
    }
    if (typeof v === 'string') {
      const i = document.createElement('input'); i.type = 'text'; i.className = 'sg-input'; i.style.flex = '1 1 auto'; i.style.minWidth = '0'; i.value = v;
      i.onchange = () => { obj[key] = i.value; deps.onEdit(); };
      return i;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return paramBlock(v as Record<string, unknown>);
    }
    // arrays + anything else: editable JSON, reverts on parse failure.
    const i = document.createElement('input'); i.type = 'text'; i.className = 'sg-input'; i.style.flex = '1 1 auto'; i.style.minWidth = '0'; i.value = JSON.stringify(v);
    i.onchange = () => { try { obj[key] = JSON.parse(i.value); deps.onEdit(); } catch { i.value = JSON.stringify(obj[key]); } };
    return i;
  }

  function kvRow(obj: Record<string, unknown>, key: string): HTMLElement {
    const row = document.createElement('div'); row.style.cssText = css.kv;
    const k = document.createElement('span'); k.textContent = key; k.style.cssText = css.key;
    row.append(k, valueEditor(obj, key));
    return row;
  }

  function paramBlock(params: Record<string, unknown>): HTMLElement {
    const box = document.createElement('div'); box.style.cssText = css.node;
    const keys = Object.keys(params);
    if (!keys.length) { const e = document.createElement('div'); e.textContent = '(none)'; e.style.cssText = 'color:var(--ink-2);opacity:.6'; return e; }
    for (const key of keys) box.appendChild(kvRow(params, key));
    return box;
  }

  function collapsible(label: string, openByDefault: boolean): { el: HTMLElement; body: HTMLElement } {
    const el = document.createElement('div'); el.style.cssText = css.node;
    const head = document.createElement('div'); head.style.cssText = css.nodeHead;
    const body = document.createElement('div'); body.style.display = openByDefault ? 'block' : 'none';
    const caret = () => (body.style.display === 'none' ? '▸' : '▾');
    const setLabel = () => { head.textContent = `${caret()} ${label}`; };
    head.onclick = () => { body.style.display = body.style.display === 'none' ? 'block' : 'none'; setLabel(); };
    setLabel();
    el.append(head, body);
    return { el, body };
  }

  function featureNode(f: ResolvedFeature): HTMLElement {
    const face = f.face ? ` · ${f.face}` : '';
    const kind = typeof f.params.kind === 'string' ? ` (${f.params.kind})` : '';
    const { el, body } = collapsible(`◦ ${f.type}${kind}${face}`, false);
    body.appendChild(paramBlock(f.params));
    return el;
  }

  function partNode(p: ResolvedPart): HTMLElement {
    const mat = p.material ? ` · ${p.material}` : '';
    const { el, body } = collapsible(`▪ ${p.id} [${p.type}]${mat}`, false);
    const meta = document.createElement('div'); meta.style.cssText = css.meta;
    meta.textContent = `at (${p.at.x},${p.at.y})  size ${p.size.w}×${p.size.h}`;
    body.appendChild(meta);
    body.appendChild(sect('params'));
    body.appendChild(paramBlock(p.params));
    if (p.features.length) {
      body.appendChild(sect(`features (${p.features.length})`));
      for (const f of p.features) body.appendChild(featureNode(f));
    }
    return el;
  }

  function render(): void {
    host.innerHTML = '';
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

  return { render };
}
