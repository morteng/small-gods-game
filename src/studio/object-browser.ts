// src/studio/object-browser.ts
// Object browser: search + faceted filter over the asset catalogue, plus a VARIANT
// row (era + wealth/quality/condition descriptors + a lifecycle scrubber) that
// rebuilds the current subject through resolveAsset.
import { assetCatalogue, queryCatalogue, type CatalogueEntry } from '@/blueprint/catalogue';
import type { Descriptors, Era } from '@/blueprint/types';
import { ERA_LEVELS } from '@/blueprint/eras';
import { stagesFor, defaultStageFor } from '@/blueprint/lifecycle';
import { h } from './theme';

interface BrowserDeps {
  getCurrent: () => string;
  onSelect: (kind: string) => void;
  getDescriptors: () => Descriptors;
  onVariant: (d: Descriptors) => void;
  getEra: () => Era | undefined;
  onEra: (era: Era | undefined) => void;
  getStage: () => string | undefined;
  onStage: (stage: string | undefined) => void;
}
export function buildObjectBrowser(host: HTMLElement, deps: BrowserDeps): { refresh: () => void } {
  host.style.cssText += ';padding:8px 9px;font:400 11px/1.4 var(--font-mono);color:var(--ink-0)';
  const entries = assetCatalogue();
  // Facet values present in the catalogue (only show filters that exist).
  const classes = [...new Set(entries.map(e => e.class))].sort();
  const categories = [...new Set(entries.map(e => e.category))].sort();
  const eras = [...new Set(entries.map(e => e.era).filter(Boolean) as string[])].sort();
  const filter = { text: '', class: '', category: '', era: '' };

  const search = h('input', { class: 'sg-search', style: 'margin-bottom:6px', attrs: { type: 'search', placeholder: 'search name / category / tag…' } }) as HTMLInputElement;
  search.oninput = () => { filter.text = search.value.trim().toLowerCase(); renderList(); };

  // A chip-row facet: clicking a chip toggles it (single-select per facet).
  function chipRow(label: string, values: string[], key: 'class' | 'category' | 'era'): HTMLElement {
    const wrap = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin:3px 0 5px;align-items:center' },
      h('span', { class: 'sg-muted', style: 'margin-right:2px', text: label }));
    const chips: { v: string; el: HTMLElement }[] = [];
    const paint = () => { for (const c of chips) c.el.classList.toggle('is-on', filter[key] === c.v); };
    for (const v of values) {
      const c = h('span', { class: 'sg-chip', text: v, on: { click: () => { filter[key] = filter[key] === v ? '' : v; paint(); renderList(); } } });
      chips.push({ v, el: c }); wrap.appendChild(c);
    }
    paint();
    return wrap;
  }

  const facets = h('div', {}, chipRow('class', classes, 'class'), chipRow('cat', categories, 'category'));
  if (eras.length > 1) facets.appendChild(chipRow('era', eras, 'era'));

  const count = h('div', { class: 'sg-muted', style: 'margin:2px 0' });
  const list = h('div', { style: 'display:flex;flex-direction:column;gap:1px' });

  // ── variant pickers: descriptor axes for the CURRENT subject ──
  const variant = h('div', { style: 'border-top:1px solid var(--line);margin-top:8px;padding-top:7px' });
  const byType = new Map(entries.map(e => [e.type, e]));
  function renderVariant(): void {
    variant.innerHTML = '';
    const e: CatalogueEntry | undefined = byType.get(deps.getCurrent());
    const axes = e?.descriptorAxes ?? {};
    const keys = Object.keys(axes) as ('wealth' | 'quality' | 'condition')[];
    const stages = e ? stagesFor(e.class) : [];
    if (!keys.length && !stages.length) { variant.style.display = 'none'; return; }
    variant.style.display = 'block';
    variant.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin-bottom:5px', text: 'Variant' }));

    // Era picker + descriptor axes apply to built structures (buildings/props).
    if (keys.length) {
      const eraSel = h('select', { class: 'sg-select', style: 'width:100%;margin-bottom:4px' }) as HTMLSelectElement;
      eraSel.append(h('option', { text: `era: ${e?.era ?? 'base'} (default)`, attrs: { value: '' } }));
      for (const era of ERA_LEVELS) { const o = h('option', { text: era, attrs: { value: era } }) as HTMLOptionElement; o.selected = deps.getEra() === era; eraSel.appendChild(o); }
      eraSel.onchange = () => deps.onEra(eraSel.value ? (eraSel.value as Era) : undefined);
      variant.appendChild(eraSel);

      const cur = deps.getDescriptors();
      const row = h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' });
      for (const key of keys) {
        const sel = h('select', { class: 'sg-select', style: 'flex:1 1 80px' }) as HTMLSelectElement;
        sel.append(h('option', { text: key, attrs: { value: '' } }));
        for (const v of axes[key] ?? []) { const o = h('option', { text: v, attrs: { value: v } }) as HTMLOptionElement; o.selected = cur[key] === v; sel.appendChild(o); }
        sel.onchange = () => {
          const next: Descriptors = { ...deps.getDescriptors() };
          if (sel.value) next[key] = sel.value as never; else delete next[key];
          deps.onVariant(next);
        };
        row.appendChild(sel);
      }
      variant.appendChild(row);
    }

    // Lifecycle scrubber: a slider over the asset's stage timeline (sapling→stub,
    // or cleared→ruin for buildings). The default stage resolves byte-identically
    // to the stageless asset.
    if (stages.length) {
      const def = e ? defaultStageFor(e.class) : undefined;
      const lbl = h('span', { class: 'sg-accent', style: 'min-width:74px;font-size:11px' });
      const idxOf = (s: string | undefined): number => { const i = s ? stages.indexOf(s) : -1; return i >= 0 ? i : (def ? stages.indexOf(def) : 0); };
      const slider = h('input', { class: 'sg-range', style: 'flex:1', attrs: { type: 'range', min: '0', max: String(stages.length - 1), step: '1' } }) as HTMLInputElement;
      slider.value = String(idxOf(deps.getStage()));
      lbl.textContent = `🌱 ${stages[+slider.value]}`;
      slider.oninput = () => {
        const stage = stages[+slider.value];
        lbl.textContent = `🌱 ${stage}`;
        deps.onStage(stage === def ? undefined : stage);
      };
      variant.appendChild(h('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:7px' }, lbl, slider));
    }
  }

  const ICON: Record<string, string> = { building: '🏠', prop: '🪧', plant: '🌳', barrier: '🧱', terrain_feature: '⛰' };
  function renderList(): void {
    const matches = queryCatalogue(entries, filter);
    count.textContent = `${matches.length} / ${entries.length}`;
    list.innerHTML = '';
    const cur = deps.getCurrent();
    for (const e of matches) {
      const on = e.type === cur;
      const item = h('div', {
        style: `cursor:pointer;padding:3px 6px;border-radius:var(--r-sm);display:flex;justify-content:space-between;gap:6px;${on ? 'background:rgba(255,194,75,.13);color:var(--accent)' : 'color:var(--ink-0)'}`,
        on: {
          click: () => deps.onSelect(e.type),
          mouseenter: () => { if (!on) item.style.background = 'var(--bg-2)'; },
          mouseleave: () => { if (!on) item.style.background = 'transparent'; },
        },
      },
        h('span', { text: `${ICON[e.class] ?? '•'} ${e.type}` }),
        h('span', { class: 'sg-muted', text: e.category + (e.era ? ` · ${e.era}` : '') }),
      );
      list.appendChild(item);
    }
  }
  host.append(search, facets, count, list, variant);
  const refresh = () => { renderList(); renderVariant(); };
  refresh();
  return { refresh };
}
