// src/studio/theme.ts
// Studio design system — a single scoped stylesheet + a handful of DOM helpers so
// every studio module pulls from ONE token set instead of scattering hex literals
// and inline cssText. The look is "professional game-engine editor chrome":
// warm-graphite surfaces, hairline borders, a single amber primary accent (the
// divine-light motif), a JetBrains Mono / Archivo type pairing, and crisp hover
// micro-states that bare inline styles can't express.
//
// Everything is scoped under `.sg-studio` so it can never leak into the game.

/** Canvas-drawing colours (the view-pane checker + sun gizmo paint with raw hex,
 *  so they must track the CSS tokens by hand). Keep in sync with `STUDIO_CSS`. */
export const COLORS = {
  bg0: '#0c0d11',
  bg1: '#14151b',
  bg2: '#1c1e26',
  checkerA: '#181a21',
  checkerB: '#121319',
  line: '#2a2d38',
  ink0: '#e7e9f0',
  ink1: '#9aa0b2',
  accent: '#ffc24b',
  info: '#5fd0de',
  ok: '#84dd96',
  bad: '#f2868d',
} as const;

const STYLE_ID = 'sg-studio-theme';

const STUDIO_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');

.sg-studio {
  --bg-0:#0c0d11; --bg-1:#14151b; --bg-2:#1c1e26; --bg-3:#252834;
  --line:#2a2d38; --line-2:#383c4a;
  --ink-0:#e7e9f0; --ink-1:#9aa0b2; --ink-2:#646a7c;
  --accent:#ffc24b; --accent-ink:#1a1206; --accent-dim:#caa047;
  --info:#5fd0de; --ok:#84dd96; --bad:#f2868d;
  --r-sm:4px; --r-md:6px; --r-lg:9px;
  --font-mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace;
  --font-display:'Archivo',system-ui,sans-serif;
  --shadow:0 8px 28px -8px rgba(0,0,0,.7),0 2px 6px rgba(0,0,0,.4);
  font-family:var(--font-mono);
  color:var(--ink-0);
  -webkit-font-smoothing:antialiased;
}
.sg-studio, .sg-studio * { box-sizing:border-box; }

/* scrollbars — thin, dark, unobtrusive */
.sg-studio ::-webkit-scrollbar{width:9px;height:9px}
.sg-studio ::-webkit-scrollbar-track{background:transparent}
.sg-studio ::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:6px;border:2px solid transparent;background-clip:padding-box}
.sg-studio ::-webkit-scrollbar-thumb:hover{background:#4a4f60;background-clip:padding-box}

/* ── surfaces ─────────────────────────────────────────────── */
.sg-panel{background:var(--bg-1)}
.sg-bar{background:linear-gradient(var(--bg-2),var(--bg-1));border-bottom:1px solid var(--line)}
.sg-splitter{background:var(--line);transition:background .12s}
.sg-splitter:hover{background:var(--accent-dim)}
.sg-splitter-col{cursor:col-resize}
.sg-splitter-row{cursor:row-resize}

/* ── typography ───────────────────────────────────────────── */
.sg-title{font-family:var(--font-display);font-weight:700;letter-spacing:.02em;color:var(--ink-0)}
.sg-eyebrow{font-family:var(--font-display);font-weight:600;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2)}
.sg-muted{color:var(--ink-2)}
.sg-dim{color:var(--ink-1)}
.sg-accent{color:var(--accent)}
.sg-info{color:var(--info)}

/* ── buttons ──────────────────────────────────────────────── */
.sg-btn{
  display:inline-flex;align-items:center;gap:6px;
  font:500 12px/1 var(--font-mono);color:var(--ink-0);
  background:var(--bg-2);border:1px solid var(--line-2);border-radius:var(--r-sm);
  padding:6px 11px;cursor:pointer;user-select:none;white-space:nowrap;
  transition:background .12s,border-color .12s,color .12s,transform .04s;
}
.sg-btn:hover{background:var(--bg-3);border-color:#474c5e}
.sg-btn:active{transform:translateY(1px)}
.sg-btn[disabled],.sg-btn.is-busy{opacity:.45;cursor:default;pointer-events:none}
.sg-btn.is-on{background:rgba(255,194,75,.14);border-color:var(--accent-dim);color:var(--accent)}
.sg-btn-primary{
  background:linear-gradient(180deg,#ffce67,#f4b13a);color:var(--accent-ink);
  border:1px solid #ffd87e;font-weight:700;
  box-shadow:0 1px 0 rgba(255,255,255,.25) inset,0 2px 8px -2px rgba(255,194,75,.5);
}
.sg-btn-primary:hover{background:linear-gradient(180deg,#ffd97c,#ffbb46)}
.sg-btn-go{background:#1f3a26;border-color:#356b41;color:#bdf0c8}
.sg-btn-go:hover{background:#264a30}
.sg-icon-btn{
  display:inline-flex;align-items:center;justify-content:center;
  width:30px;height:28px;padding:0;font-size:14px;
  background:var(--bg-2);border:1px solid var(--line-2);border-radius:var(--r-sm);
  color:var(--ink-1);cursor:pointer;transition:background .12s,color .12s,border-color .12s;
}
.sg-icon-btn:hover{background:var(--bg-3);color:var(--ink-0)}

/* segmented toolbar group: buttons fused with hairline seams */
.sg-group{display:inline-flex;align-items:center;background:var(--bg-2);border:1px solid var(--line-2);border-radius:var(--r-md);overflow:hidden}
.sg-group>*{border:0!important;border-radius:0!important;background:transparent!important}
.sg-group>*+*{border-left:1px solid var(--line-2)!important}
.sg-group .sg-btn,.sg-group .sg-icon-btn{padding:6px 10px}
.sg-group .sg-btn:hover,.sg-group .sg-icon-btn:hover{background:var(--bg-3)!important}
.sg-group .sg-read{font:500 12px/1 var(--font-mono);color:var(--ink-0);padding:0 12px;min-width:54px;text-align:center}

.sg-vsep{width:1px;align-self:stretch;background:var(--line);margin:0 2px}

/* ── inputs ───────────────────────────────────────────────── */
.sg-input,.sg-select,.sg-search{
  font:400 12px/1.2 var(--font-mono);color:var(--ink-0);
  background:var(--bg-0);border:1px solid var(--line-2);border-radius:var(--r-sm);
  padding:5px 7px;outline:none;transition:border-color .12s,box-shadow .12s;
}
.sg-input:focus,.sg-select:focus,.sg-search:focus{border-color:var(--accent-dim);box-shadow:0 0 0 2px rgba(255,194,75,.18)}
.sg-select{cursor:pointer;appearance:none;padding-right:22px;
  background-image:linear-gradient(45deg,transparent 50%,var(--ink-1) 50%),linear-gradient(135deg,var(--ink-1) 50%,transparent 50%);
  background-position:calc(100% - 11px) 52%,calc(100% - 7px) 52%;background-size:4px 4px,4px 4px;background-repeat:no-repeat}
.sg-search{width:100%}
.sg-num{width:62px}
.sg-range{appearance:none;-webkit-appearance:none;height:4px;border-radius:3px;background:var(--line-2);outline:none;accent-color:var(--accent)}
.sg-range::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:var(--accent);border:2px solid var(--bg-1);cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.sg-range::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:var(--accent);border:2px solid var(--bg-1);cursor:pointer}
.sg-check{accent-color:var(--accent);width:13px;height:13px;cursor:pointer}
.sg-field{display:flex;flex-direction:column;gap:5px}
.sg-field>label{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-2)}
.sg-toggle{display:flex;align-items:center;gap:7px;cursor:pointer;user-select:none;color:var(--ink-1);font-size:12px}
.sg-toggle:hover{color:var(--ink-0)}

/* ── chips (facets) ───────────────────────────────────────── */
.sg-chip{
  cursor:pointer;font:500 11px/1 var(--font-mono);color:var(--ink-1);
  background:var(--bg-2);border:1px solid var(--line);border-radius:999px;
  padding:3px 9px;transition:all .12s;
}
.sg-chip:hover{border-color:var(--line-2);color:var(--ink-0)}
.sg-chip.is-on{background:rgba(255,194,75,.15);border-color:var(--accent-dim);color:var(--accent)}

/* ── tabs ─────────────────────────────────────────────────── */
.sg-tabs{display:flex;align-items:stretch;gap:2px;background:var(--bg-2);border-bottom:1px solid var(--line);padding:0 6px;flex:0 0 auto}
.sg-tab{
  font:600 11px/1 var(--font-display);letter-spacing:.05em;text-transform:uppercase;
  color:var(--ink-2);background:transparent;border:0;border-bottom:2px solid transparent;
  padding:9px 13px 7px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:color .12s,border-color .12s;
}
.sg-tab:hover{color:var(--ink-0)}
.sg-tab.is-active{color:var(--accent);border-bottom-color:var(--accent)}
.sg-tab .sg-badge{font-family:var(--font-mono);font-size:9px;color:var(--ink-2);background:var(--bg-0);border-radius:4px;padding:1px 5px}

/* ── popover (toolbar dropdowns) ──────────────────────────── */
.sg-pop{
  position:fixed;z-index:9999;min-width:200px;max-width:340px;
  background:var(--bg-1);border:1px solid var(--line-2);border-radius:var(--r-lg);
  box-shadow:var(--shadow);padding:12px;font:400 12px/1.4 var(--font-mono);color:var(--ink-0);
  animation:sg-pop-in .12s ease-out;
}
@keyframes sg-pop-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.sg-pop .sg-pop-title{font-family:var(--font-display);font-weight:600;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin-bottom:8px}
.sg-menu{display:flex;flex-direction:column;gap:1px;min-width:200px}
.sg-menu-item{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:var(--r-sm);cursor:pointer;color:var(--ink-0);transition:background .1s}
.sg-menu-item:hover{background:var(--bg-3)}
.sg-menu-item .sg-kbd{margin-left:auto;font-size:10px;color:var(--ink-2);background:var(--bg-0);border:1px solid var(--line);border-radius:3px;padding:1px 5px}
.sg-menu-sep{height:1px;background:var(--line);margin:5px 2px}

/* ── accordion (left pane) ────────────────────────────────── */
.sg-acc-head{
  flex:0 0 auto;display:flex;align-items:center;gap:7px;cursor:pointer;user-select:none;
  padding:8px 11px;background:var(--bg-2);border-bottom:1px solid var(--line);
  font-family:var(--font-display);font-weight:600;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-1);
  transition:color .12s;
}
.sg-acc-head:hover{color:var(--ink-0)}
.sg-acc-head .sg-caret{color:var(--ink-2);font-size:10px;width:9px}
.sg-acc-head .sg-acc-actions{margin-left:auto;display:flex;gap:5px}

/* ── badges / readouts ────────────────────────────────────── */
.sg-tag{display:inline-flex;align-items:center;gap:5px;font:500 11px/1 var(--font-mono);
  background:var(--bg-2);border:1px solid var(--line);border-radius:var(--r-sm);padding:4px 8px;color:var(--ink-1)}
.sg-tag b{color:var(--ink-0);font-weight:700}
.sg-pre{white-space:pre-wrap;word-break:break-word;background:var(--bg-0);border:1px solid var(--line);border-radius:var(--r-sm);padding:7px;margin:0;font:400 11px/1.5 var(--font-mono);color:var(--ink-1)}

/* ── floating view-pane badge ─────────────────────────────── */
.sg-float{position:absolute;display:inline-flex;align-items:center;gap:8px;z-index:11;
  background:rgba(14,15,20,.86);backdrop-filter:blur(6px);border:1px solid var(--line-2);
  border-radius:var(--r-md);padding:5px 9px;font:500 12px/1 var(--font-mono);color:var(--ink-1)}
`;

/** Inject the studio stylesheet once (idempotent) and tag the root container. */
export function injectStudioTheme(root: HTMLElement): void {
  root.classList.add('sg-studio');
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STUDIO_CSS;
  document.head.appendChild(style);
}

// ── DOM helpers ──────────────────────────────────────────────────────────────
type Handlers = { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
interface ElOpts {
  class?: string; text?: string; html?: string; style?: string; title?: string;
  attrs?: Record<string, string>; on?: Handlers;
}
type Child = Node | string | number | null | undefined | false;

/** Terse hyperscript: `h('button', { class:'sg-btn', text:'Go', on:{ click } })`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, opts: ElOpts = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (opts.class) el.className = opts.class;
  if (opts.text != null) el.textContent = opts.text;
  if (opts.html != null) el.innerHTML = opts.html;
  if (opts.style) el.style.cssText = opts.style;
  if (opts.title) el.title = opts.title;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) el.setAttribute(k, v);
  if (opts.on) for (const [k, fn] of Object.entries(opts.on)) el.addEventListener(k, fn as EventListener);
  for (const c of children) if (c != null && c !== false) el.append(c as Node | string);
  return el;
}

export interface PopoverHandle {
  el: HTMLElement;
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
}

/** A click-anchored popover (toolbar dropdown). The body builder runs once; the
 *  panel is fixed-positioned under the anchor, flips to right-align if it would
 *  overflow, and closes on outside-click / Esc. */
export function popover(anchor: HTMLElement, build: (body: HTMLElement) => void, opts: { align?: 'left' | 'right'; width?: number } = {}): PopoverHandle {
  const el = h('div', { class: 'sg-pop' });
  if (opts.width) el.style.width = `${opts.width}px`;
  el.style.display = 'none';
  build(el);
  document.body.appendChild(el);

  let open = false;
  const place = () => {
    const r = anchor.getBoundingClientRect();
    el.style.display = 'block';
    el.style.visibility = 'hidden';
    const pw = el.offsetWidth;
    const vw = window.innerWidth;
    let left = opts.align === 'right' ? r.right - pw : r.left;
    left = Math.max(8, Math.min(left, vw - pw - 8));
    el.style.top = `${Math.round(r.bottom + 6)}px`;
    el.style.left = `${Math.round(left)}px`;
    el.style.visibility = 'visible';
  };
  const onDown = (e: MouseEvent) => {
    if (el.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
    api.close();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') api.close(); };

  const api: PopoverHandle = {
    el,
    isOpen: () => open,
    open: () => {
      if (open) return;
      open = true; anchor.classList.add('is-on'); place();
      setTimeout(() => { window.addEventListener('mousedown', onDown); window.addEventListener('keydown', onKey); window.addEventListener('resize', place); }, 0);
    },
    close: () => {
      if (!open) return;
      open = false; anchor.classList.remove('is-on'); el.style.display = 'none';
      window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', place);
    },
    toggle: () => (open ? api.close() : api.open()),
  };
  anchor.addEventListener('click', (e) => { e.stopPropagation(); api.toggle(); });
  return api;
}
