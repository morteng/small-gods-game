/**
 * Model picker — an OpenRouter.ai-style master/detail browser.
 *
 * A dark, searchable overlay: a scrollable list of models on the left, a detail
 * pane on the right. A Verified/All segmented toggle decides whether players see
 * only the curated allowlist or the full live tool-calling catalog (the pikkolo
 * "verified for players, any model for devs" split). A Free filter pill and a
 * search box narrow the list.
 *
 * Self-contained dark styling (scoped under `.sg-mp`) so it matches the
 * reference UI regardless of the surrounding light chrome.
 */

import {
  fetchOpenRouterModels,
  formatPrice,
  type OpenRouterModel,
  type CuratedModel,
} from '@/llm/openrouter-catalog';

export interface ModelPickerOptions {
  /** Positioned element the overlay attaches to (inset:0 within it). */
  mount: HTMLElement;
  /** Curated allowlist shown in "Verified" mode. */
  verified: readonly CuratedModel[];
  /** Currently-selected model id (highlighted, opens its detail). */
  current: string;
  /** OpenRouter key, forwarded to the catalog fetch (optional). */
  apiKey?: string;
  title: string;
  onPick: (id: string) => void;
}

// All colors come from design tokens (see tokens.css). The picker is fully
// themeable: it inherits whatever theme scope wraps it (`.sg-theme-dark` etc.),
// so the same markup renders dark or light with no per-color overrides here.
const STYLE = `
.sg-mp-overlay {
  position: absolute; inset: 0; z-index: 60;
  background: oklch(0.20 0.02 60 / 0.55);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--f-sans, system-ui, sans-serif);
  animation: sg-fade-in 160ms ease-out;
}
.sg-mp {
  width: 760px; max-width: calc(100vw - 32px);
  height: 480px; max-height: calc(100vh - 48px);
  display: grid; grid-template-columns: 1fr 300px; grid-template-rows: auto 1fr;
  background: var(--paper); color: var(--ink);
  border: 1px solid var(--line); border-radius: var(--r-4); overflow: hidden;
  box-shadow: var(--lift-2);
  animation: sg-scale-in 160ms ease-out;
}
.sg-mp__bar {
  grid-column: 1 / 3;
  display: flex; align-items: center; gap: var(--s-2);
  padding: var(--s-3) var(--s-3); border-bottom: 1px solid var(--line);
}
.sg-mp__search {
  flex: 1; display: flex; align-items: center; gap: var(--s-2);
  background: var(--paper-2); border: 1px solid var(--line); border-radius: var(--r-2);
  padding: 7px 10px;
}
.sg-mp__search input {
  all: unset; flex: 1; color: var(--ink); font-size: var(--t-base);
}
.sg-mp__search input::placeholder { color: var(--ink-4); }
.sg-mp__count { color: var(--ink-3); font-size: var(--t-small); }
.sg-mp__pill {
  all: unset; cursor: pointer; font-size: var(--t-small); font-weight: 500;
  padding: 6px 11px; border-radius: var(--r-pill); color: var(--ink-2);
  background: var(--paper-2); border: 1px solid var(--line); white-space: nowrap;
}
.sg-mp__pill:hover { background: var(--paper); border-color: var(--line-2); }
.sg-mp__pill.is-on {
  background: var(--you); border-color: var(--you); color: #fff;
}
.sg-mp__seg { display: inline-flex; background: var(--paper-2); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 2px; }
.sg-mp__seg button {
  all: unset; cursor: pointer; font-size: var(--t-small); font-weight: 500;
  padding: 5px 12px; border-radius: var(--r-pill); color: var(--ink-2);
}
.sg-mp__seg button.is-on { background: var(--you-soft); color: var(--you); }
.sg-mp__close { all: unset; cursor: pointer; color: var(--ink-3); font-size: 20px; line-height: 1; padding: 2px 6px; border-radius: var(--r-2); }
.sg-mp__close:hover { background: var(--paper-2); color: var(--ink); }

.sg-mp__list { overflow-y: auto; border-right: 1px solid var(--line); }
.sg-mp__row {
  display: flex; align-items: center; gap: var(--s-2);
  padding: 10px var(--s-3); cursor: pointer; border-bottom: 1px solid var(--line);
}
.sg-mp__row:hover { background: var(--paper-2); }
.sg-mp__row.is-sel { background: var(--you-soft); }
.sg-mp__dot {
  width: 18px; height: 18px; border-radius: var(--r-1); flex: 0 0 auto;
  display: grid; place-items: center; font-size: 10px; font-weight: 700;
  background: var(--paper-2); color: var(--ink-2); text-transform: uppercase;
}
.sg-mp__row-main { flex: 1; min-width: 0; }
.sg-mp__row-name { font-size: var(--t-base); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sg-mp__row-prov { font-size: var(--t-tiny); color: var(--ink-3); }
.sg-mp__row-price { font-size: var(--t-tiny); color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sg-mp__row--verified .sg-mp__dot { background: var(--life-soft); color: var(--w-leaf); }
.sg-mp__empty { padding: var(--s-5) var(--s-3); color: var(--ink-3); font-size: var(--t-base); text-align: center; }

.sg-mp__detail { overflow-y: auto; padding: var(--s-4); display: flex; flex-direction: column; gap: var(--s-3); }
.sg-mp__detail-name { font-size: var(--t-lg); font-weight: 700; color: var(--ink); }
.sg-mp__detail-desc { font-size: var(--t-small); line-height: 1.5; color: var(--ink-2); }
.sg-mp__stats { display: flex; flex-direction: column; gap: 0; border-top: 1px solid var(--line); }
.sg-mp__stat { display: flex; justify-content: space-between; padding: var(--s-2) 0; border-bottom: 1px solid var(--line); font-size: var(--t-small); }
.sg-mp__stat span:first-child { color: var(--ink-3); }
.sg-mp__stat span:last-child { color: var(--ink); font-variant-numeric: tabular-nums; }
.sg-mp__id { font-family: var(--f-mono, monospace); font-size: var(--t-tiny); color: var(--ink-2); background: var(--paper-2); border: 1px solid var(--line); border-radius: var(--r-2); padding: 7px 9px; word-break: break-all; }
.sg-mp__select {
  all: unset; cursor: pointer; text-align: center; margin-top: auto;
  background: var(--you); color: #fff; font-size: var(--t-base); font-weight: 600;
  padding: 9px; border-radius: var(--r-2);
}
.sg-mp__select:hover { filter: brightness(1.08); }
.sg-mp__select.is-current { background: var(--life); }
.sg-mp__detail-empty { color: var(--ink-3); font-size: var(--t-base); margin: auto; text-align: center; }
`;

function injectStyle(): void {
  if (document.querySelector('#sg-model-picker-styles')) return;
  const el = document.createElement('style');
  el.id = 'sg-model-picker-styles';
  el.textContent = STYLE;
  document.head.appendChild(el);
}

function ctxLen(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export function openModelPicker(opts: ModelPickerOptions): void {
  injectStyle();

  const overlay = document.createElement('div');
  overlay.className = 'sg-mp-overlay';
  const modal = document.createElement('div');
  // Inherit the host's theme scope if it has one; otherwise default to dark so
  // the picker matches the reference UI. Either way it's token-driven, so a
  // future theme swap needs no change here.
  modal.className = opts.mount.closest('.sg-theme-dark') ? 'sg-mp' : 'sg-mp sg-theme-dark';
  overlay.appendChild(modal);

  // ── State ──────────────────────────────────────────────
  const verifiedIds = new Set(opts.verified.map(m => m.id));
  let catalog: OpenRouterModel[] = [];
  let mode: 'verified' | 'all' = 'verified';
  let freeOnly = false;
  let search = '';
  let selectedId = opts.current;

  // Verified models as OpenRouterModel placeholders until the catalog enriches them.
  const verifiedFallback: OpenRouterModel[] = opts.verified.map(m => ({
    id: m.id, name: m.name, provider: m.id.split('/')[0] ?? '',
    description: '', contextLength: null, promptPrice: null, completionPrice: null, free: false,
  }));

  // ── Top bar ────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'sg-mp__bar';

  const searchBox = document.createElement('div');
  searchBox.className = 'sg-mp__search';
  const searchInput = document.createElement('input');
  searchInput.placeholder = 'Search models';
  const countEl = document.createElement('span');
  countEl.className = 'sg-mp__count';
  searchBox.appendChild(searchInput);
  searchBox.appendChild(countEl);

  const seg = document.createElement('div');
  seg.className = 'sg-mp__seg';
  const segVerified = document.createElement('button');
  segVerified.textContent = 'Verified';
  segVerified.className = 'is-on';
  const segAll = document.createElement('button');
  segAll.textContent = 'All';
  seg.appendChild(segVerified);
  seg.appendChild(segAll);

  const freePill = document.createElement('button');
  freePill.className = 'sg-mp__pill';
  freePill.textContent = 'Free';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sg-mp__close';
  closeBtn.textContent = '×';

  bar.append(searchBox, seg, freePill, closeBtn);
  modal.appendChild(bar);

  // ── List + detail ──────────────────────────────────────
  const list = document.createElement('div');
  list.className = 'sg-mp__list sg-scroll';
  const detail = document.createElement('div');
  detail.className = 'sg-mp__detail sg-scroll';
  modal.appendChild(list);
  modal.appendChild(detail);

  function visibleModels(): OpenRouterModel[] {
    let base: OpenRouterModel[];
    if (mode === 'verified') {
      // Prefer enriched catalog rows for verified ids; fall back to placeholders.
      base = opts.verified.map(v => catalog.find(c => c.id === v.id)
        ?? verifiedFallback.find(f => f.id === v.id)!);
    } else {
      base = catalog.length ? catalog : verifiedFallback;
    }
    const q = search.trim().toLowerCase();
    return base.filter(m => {
      if (freeOnly && !m.free) return false;
      if (q && !(m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function renderDetail(m: OpenRouterModel | undefined): void {
    detail.innerHTML = '';
    if (!m) {
      const empty = document.createElement('div');
      empty.className = 'sg-mp__detail-empty';
      empty.textContent = 'Select a model';
      detail.appendChild(empty);
      return;
    }
    const name = document.createElement('div');
    name.className = 'sg-mp__detail-name';
    name.textContent = m.name;
    detail.appendChild(name);

    if (m.description) {
      const desc = document.createElement('div');
      desc.className = 'sg-mp__detail-desc';
      desc.textContent = m.description.length > 320 ? m.description.slice(0, 320) + '…' : m.description;
      detail.appendChild(desc);
    }

    const stats = document.createElement('div');
    stats.className = 'sg-mp__stats';
    const rows: [string, string][] = [
      ['Context', ctxLen(m.contextLength)],
      ['Input', m.promptPrice == null ? '—' : (m.free ? 'free' : `$${m.promptPrice.toFixed(2)}/M`)],
      ['Output', m.completionPrice == null ? '—' : (m.free ? 'free' : `$${m.completionPrice.toFixed(2)}/M`)],
    ];
    for (const [k, v] of rows) {
      const r = document.createElement('div');
      r.className = 'sg-mp__stat';
      const a = document.createElement('span'); a.textContent = k;
      const b = document.createElement('span'); b.textContent = v;
      r.append(a, b);
      stats.appendChild(r);
    }
    detail.appendChild(stats);

    const id = document.createElement('div');
    id.className = 'sg-mp__id';
    id.textContent = m.id;
    detail.appendChild(id);

    const sel = document.createElement('button');
    sel.className = 'sg-mp__select';
    const isCurrent = m.id === opts.current;
    sel.textContent = isCurrent ? 'Selected ✓' : 'Use this model';
    if (isCurrent) sel.classList.add('is-current');
    sel.addEventListener('click', () => {
      opts.onPick(m.id);
      close();
    });
    detail.appendChild(sel);
  }

  function render(): void {
    const models = visibleModels();
    countEl.textContent = `${models.length} model${models.length === 1 ? '' : 's'}`;
    list.innerHTML = '';
    if (!models.length) {
      const empty = document.createElement('div');
      empty.className = 'sg-mp__empty';
      empty.textContent = 'No models match.';
      list.appendChild(empty);
    }
    for (const m of models) {
      const row = document.createElement('div');
      row.className = 'sg-mp__row';
      if (verifiedIds.has(m.id)) row.classList.add('sg-mp__row--verified');
      if (m.id === selectedId) row.classList.add('is-sel');

      const dot = document.createElement('div');
      dot.className = 'sg-mp__dot';
      dot.textContent = (m.provider || m.id)[0] ?? '?';

      const main = document.createElement('div');
      main.className = 'sg-mp__row-main';
      const nm = document.createElement('div');
      nm.className = 'sg-mp__row-name';
      nm.textContent = m.name;
      const pv = document.createElement('div');
      pv.className = 'sg-mp__row-prov';
      pv.textContent = m.provider;
      main.append(nm, pv);

      const price = document.createElement('div');
      price.className = 'sg-mp__row-price';
      price.textContent = formatPrice(m);

      row.append(dot, main, price);
      row.addEventListener('click', () => {
        selectedId = m.id;
        render();
        renderDetail(m);
      });
      list.appendChild(row);
    }
    renderDetail(models.find(m => m.id === selectedId) ?? models[0]);
    if (models.length && !models.some(m => m.id === selectedId)) selectedId = models[0].id;
  }

  // ── Wiring ─────────────────────────────────────────────
  searchInput.addEventListener('input', () => { search = searchInput.value; render(); });
  segVerified.addEventListener('click', () => {
    mode = 'verified'; segVerified.classList.add('is-on'); segAll.classList.remove('is-on'); render();
  });
  segAll.addEventListener('click', () => {
    mode = 'all'; segAll.classList.add('is-on'); segVerified.classList.remove('is-on'); render();
  });
  freePill.addEventListener('click', () => {
    freeOnly = !freeOnly; freePill.classList.toggle('is-on', freeOnly); render();
  });

  function close(): void {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  opts.mount.appendChild(overlay);
  render();
  searchInput.focus();

  // Enrich with the live catalog, then re-render in place.
  void fetchOpenRouterModels(opts.apiKey).then(models => {
    if (!overlay.isConnected) return;
    catalog = models;
    render();
  });
}
