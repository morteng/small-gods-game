// src/studio/object-browser.ts
// Object browser: search + faceted filter over the asset catalogue, plus a VARIANT
// row (wealth/quality/condition descriptor pickers) that rebuilds the current
// subject through resolveAsset.
import { assetCatalogue, queryCatalogue, type CatalogueEntry } from '@/blueprint/catalogue';
import type { Descriptors } from '@/blueprint/types';

// ── object browser (search + faceted filter over the asset catalogue) ────────
interface BrowserDeps {
  getCurrent: () => string;
  onSelect: (kind: string) => void;
  getDescriptors: () => Descriptors;
  onVariant: (d: Descriptors) => void;
}
export function buildObjectBrowser(host: HTMLElement, deps: BrowserDeps): { refresh: () => void } {
  host.style.cssText += ';padding:6px 8px;font:11px monospace;color:#cfe';
  const entries = assetCatalogue();
  // Facet values present in the catalogue (only show filters that exist).
  const classes = [...new Set(entries.map(e => e.class))].sort();
  const categories = [...new Set(entries.map(e => e.category))].sort();
  const eras = [...new Set(entries.map(e => e.era).filter(Boolean) as string[])].sort();
  const filter = { text: '', class: '', category: '', era: '' };

  const search = document.createElement('input');
  search.type = 'search'; search.placeholder = 'search name / category / tag…';
  search.style.cssText = 'width:100%;box-sizing:border-box;background:#11111a;color:#9fe;border:1px solid #3a3a52;padding:3px 5px;margin-bottom:4px;font:11px monospace';
  search.oninput = () => { filter.text = search.value.trim().toLowerCase(); renderList(); };

  // A chip-row facet: clicking a chip toggles it (single-select per facet).
  function chipRow(label: string, values: string[], key: 'class' | 'category' | 'era'): HTMLElement {
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin:2px 0 4px';
    const lbl = document.createElement('span'); lbl.textContent = label; lbl.style.cssText = 'opacity:0.55;margin-right:3px'; wrap.appendChild(lbl);
    const chips: { v: string; el: HTMLElement }[] = [];
    const paint = () => { for (const c of chips) c.el.style.background = filter[key] === c.v ? '#3a5a8a' : '#21213a'; };
    for (const v of values) {
      const c = document.createElement('span'); c.textContent = v;
      c.style.cssText = 'cursor:pointer;border:1px solid #3a3a52;border-radius:8px;padding:0 6px;color:#cfe';
      c.onclick = () => { filter[key] = filter[key] === v ? '' : v; paint(); renderList(); };
      chips.push({ v, el: c }); wrap.appendChild(c);
    }
    paint();
    return wrap;
  }

  const facets = document.createElement('div');
  facets.append(chipRow('class', classes, 'class'), chipRow('cat', categories, 'category'));
  if (eras.length > 1) facets.appendChild(chipRow('era', eras, 'era'));

  const count = document.createElement('div'); count.style.cssText = 'opacity:0.55;margin:2px 0';
  const list = document.createElement('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:1px';

  // ── variant pickers: descriptor axes for the CURRENT subject ──
  const variant = document.createElement('div');
  variant.style.cssText = 'border-top:1px solid #2a2a3a;margin-top:6px;padding-top:5px';
  const byType = new Map(entries.map(e => [e.type, e]));
  function renderVariant(): void {
    variant.innerHTML = '';
    const e: CatalogueEntry | undefined = byType.get(deps.getCurrent());
    const axes = e?.descriptorAxes ?? {};
    const keys = Object.keys(axes) as ('wealth' | 'quality' | 'condition')[];
    if (!keys.length) { variant.style.display = 'none'; return; }
    variant.style.display = 'block';
    const hdr = document.createElement('div'); hdr.textContent = 'variant'; hdr.style.cssText = 'opacity:0.55;margin-bottom:3px';
    variant.appendChild(hdr);
    const cur = deps.getDescriptors();
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
    for (const key of keys) {
      const sel = document.createElement('select');
      sel.style.cssText = 'flex:1 1 80px;background:#11111a;color:#cfe;border:1px solid #3a3a52;padding:2px;font:10px monospace';
      const def = document.createElement('option'); def.value = ''; def.textContent = key; sel.appendChild(def);
      for (const v of axes[key] ?? []) { const o = document.createElement('option'); o.value = v; o.textContent = v; o.selected = cur[key] === v; sel.appendChild(o); }
      sel.onchange = () => {
        const next: Descriptors = { ...deps.getDescriptors() };
        if (sel.value) next[key] = sel.value as never; else delete next[key];
        deps.onVariant(next);
      };
      row.appendChild(sel);
    }
    variant.appendChild(row);
  }

  const ICON: Record<string, string> = { building: '🏠', prop: '🪧', plant: '🌳', barrier: '🧱', terrain_feature: '⛰' };
  function renderList(): void {
    const matches = queryCatalogue(entries, filter);
    count.textContent = `${matches.length} / ${entries.length}`;
    list.innerHTML = '';
    const cur = deps.getCurrent();
    for (const e of matches) {
      const item = document.createElement('div');
      const on = e.type === cur;
      item.style.cssText = `cursor:pointer;padding:2px 5px;border-radius:3px;display:flex;justify-content:space-between;gap:6px;background:${on ? '#2a3a5a' : 'transparent'}`;
      const name = document.createElement('span'); name.textContent = `${ICON[e.class] ?? '•'} ${e.type}`;
      const meta = document.createElement('span'); meta.textContent = e.category + (e.era ? ` · ${e.era}` : ''); meta.style.cssText = 'opacity:0.5';
      item.append(name, meta);
      item.onmouseenter = () => { if (!on) item.style.background = '#1c1c28'; };
      item.onmouseleave = () => { if (!on) item.style.background = 'transparent'; };
      item.onclick = () => deps.onSelect(e.type);
      list.appendChild(item);
    }
  }
  host.append(search, facets, count, list, variant);
  const refresh = () => { renderList(); renderVariant(); };
  refresh();
  return { refresh };
}
