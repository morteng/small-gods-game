// src/studio/blueprint-tree.ts
// Node-tree inspector (browseable + editable live blueprint). Moved out of
// studio.ts (pure refactor).
import type { ResolvedBlueprint, ResolvedPart, ResolvedFeature } from '@/blueprint/types';

// ── node-tree inspector (browseable + editable live blueprint) ───────────────
interface TreeDeps {
  getRb: () => ResolvedBlueprint | null;
  onEdit: () => void;       // a value was mutated in place on the live blueprint
  randomize: () => void;    // re-roll all seeded params
}
export function buildTree(host: HTMLElement, deps: TreeDeps): { render: () => void } {
  const css = {
    head: 'position:sticky;top:0;z-index:1;background:rgba(16,16,26,0.98);padding:8px 10px 6px;border-bottom:1px solid #2a2a3a',
    title: 'color:#ffd35a;font:bold 12px monospace',
    summary: 'margin-top:4px;font:10px monospace;color:#9fd;white-space:normal;word-break:break-word',
    body: 'padding:6px 8px 16px;font:11px monospace;color:#cfe',
    node: 'margin:2px 0;border-left:1px solid #2a2a3a;padding-left:8px',
    nodeHead: 'cursor:pointer;user-select:none;padding:2px 0;color:#cde',
    kv: 'display:flex;align-items:center;gap:6px;margin:2px 0',
    key: 'opacity:0.7;flex:0 0 auto',
    inputN: 'width:64px;background:#11111a;color:#9fe;border:1px solid #3a3a52;padding:1px 3px;font:11px monospace',
    inputT: 'flex:1 1 auto;min-width:0;background:#11111a;color:#9fe;border:1px solid #3a3a52;padding:1px 3px;font:11px monospace',
    btn: 'background:#21213a;color:#ffd35a;border:1px solid #3a3a52;border-radius:4px;padding:2px 8px;cursor:pointer;font:11px monospace',
    sect: 'color:#ffd35a;opacity:0.85;margin:8px 0 2px;font-weight:bold',
  };

  // One editable control for obj[key]; recurses for nested objects, JSON for arrays.
  function valueEditor(obj: Record<string, unknown>, key: string): HTMLElement {
    const v = obj[key];
    if (typeof v === 'boolean') {
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = v;
      c.onchange = () => { obj[key] = c.checked; deps.onEdit(); };
      return c;
    }
    if (typeof v === 'number') {
      const i = document.createElement('input'); i.type = 'number'; i.value = String(v);
      i.step = Number.isInteger(v) ? '1' : '0.05'; i.style.cssText = css.inputN;
      i.onchange = () => { const n = Number(i.value); if (Number.isFinite(n)) { obj[key] = n; deps.onEdit(); } };
      return i;
    }
    if (typeof v === 'string') {
      const i = document.createElement('input'); i.type = 'text'; i.value = v; i.style.cssText = css.inputT;
      i.onchange = () => { obj[key] = i.value; deps.onEdit(); };
      return i;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return paramBlock(v as Record<string, unknown>);
    }
    // arrays + anything else: editable JSON, reverts on parse failure.
    const i = document.createElement('input'); i.type = 'text'; i.value = JSON.stringify(v); i.style.cssText = css.inputT;
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
    if (!keys.length) { const e = document.createElement('div'); e.textContent = '(none)'; e.style.opacity = '0.4'; return e; }
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
    const meta = document.createElement('div'); meta.style.cssText = 'font:10px monospace;opacity:0.6;margin:2px 0';
    meta.textContent = `at (${p.at.x},${p.at.y})  size ${p.size.w}×${p.size.h}`;
    body.appendChild(meta);
    const ps = document.createElement('div'); ps.style.cssText = css.sect; ps.textContent = 'params'; body.appendChild(ps);
    body.appendChild(paramBlock(p.params));
    if (p.features.length) {
      const fs = document.createElement('div'); fs.style.cssText = css.sect; fs.textContent = `features (${p.features.length})`; body.appendChild(fs);
      for (const f of p.features) body.appendChild(featureNode(f));
    }
    return el;
  }

  function render(): void {
    host.innerHTML = '';
    const rb = deps.getRb();
    const head = document.createElement('div'); head.style.cssText = css.head;
    const titleRow = document.createElement('div'); titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
    const title = document.createElement('div'); title.style.cssText = css.title; title.textContent = '🌳 Geometry · Blueprint';
    const rnd = document.createElement('button'); rnd.textContent = '🎲 Randomize'; rnd.style.cssText = css.btn; rnd.onclick = deps.randomize;
    titleRow.append(title, rnd);
    head.appendChild(titleRow);

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
    const fp = document.createElement('div'); fp.style.cssText = css.sect; fp.textContent = 'footprint'; metaBlock.body.appendChild(fp);
    metaBlock.body.appendChild(kvRow(rb.footprint as unknown as Record<string, unknown>, 'w'));
    metaBlock.body.appendChild(kvRow(rb.footprint as unknown as Record<string, unknown>, 'h'));
    const mts = document.createElement('div'); mts.style.cssText = css.sect; mts.textContent = 'materials'; metaBlock.body.appendChild(mts);
    metaBlock.body.appendChild(paramBlock(rb.materials as Record<string, unknown>));
    if (rb.palette && Object.keys(rb.palette).length) {
      const pl = document.createElement('div'); pl.style.cssText = css.sect; pl.textContent = 'palette'; metaBlock.body.appendChild(pl);
      metaBlock.body.appendChild(paramBlock(rb.palette as unknown as Record<string, unknown>));
    }
    body.appendChild(metaBlock.el);

    // ── parts ──
    const partsHdr = document.createElement('div'); partsHdr.style.cssText = css.sect; partsHdr.textContent = `parts (${rb.parts.length})`; body.appendChild(partsHdr);
    for (const p of rb.parts) body.appendChild(partNode(p));

    host.appendChild(body);
  }

  return { render };
}
