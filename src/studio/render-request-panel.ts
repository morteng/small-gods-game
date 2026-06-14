// src/studio/render-request-panel.ts
// Outgoing-request review panel (shown BEFORE the paid call) + the view-pane
// "live" badge.
import { h } from './theme';

// ── view-pane "live" badge ───────────────────────────────────────────────────
export function makeLiveButton(viewPane: HTMLElement, onLive: () => void): { show: (l: string) => void; hide: () => void } {
  const label = h('span');
  const btn = h('button', { class: 'sg-btn', style: 'padding:3px 10px', text: '▶ Live', on: { click: onLive } });
  const bar = h('div', { class: 'sg-float', style: 'top:12px;left:12px;display:none' }, label, btn);
  viewPane.appendChild(bar);
  return {
    show: (l) => { label.textContent = `viewing: ${l}`; bar.style.display = 'flex'; },
    hide: () => { bar.style.display = 'none'; },
  };
}

// ── outgoing-request review panel (shown BEFORE the paid call) ───────────────
interface MetadataOpts {
  kind: string; model: string; prompt: string; initDataUri: string;
  size: number; bbox: { x: number; y: number; w: number; h: number };
  anchors: unknown; body: unknown; keyStatus: string;
  onSend: (status: (m: string) => void, finishOk: (m: string) => void) => Promise<void> | void;
}
export function openMetadataPanel(host: HTMLElement, o: MetadataOpts): void {
  host.querySelector('#studio-meta')?.remove();
  const wrap = h('div', {
    class: 'sg-panel',
    style: [
      'position:absolute', 'top:12px', 'left:12px', 'width:420px', 'max-height:calc(100% - 24px)',
      'overflow:auto', 'padding:13px 15px', 'border:1px solid var(--line-2)', 'border-radius:var(--r-lg)',
      'box-shadow:var(--shadow)', 'font:400 12px/1.4 var(--font-mono)', 'color:var(--ink-0)', 'z-index:20',
    ].join(';'),
  });
  wrap.id = 'studio-meta';

  const heading = (t: string) => h('div', { class: 'sg-eyebrow', style: 'margin:11px 0 4px', text: t });
  const pre = (t: string) => h('pre', { class: 'sg-pre', style: 'max-height:180px;overflow:auto', text: t });
  const line = (t: string) => h('div', { class: 'sg-dim', style: 'margin:2px 0', text: t });

  const status = h('div', { class: 'sg-info', style: 'margin-top:9px;min-height:16px' });
  const setStatus = (m: string) => { status.textContent = m; };

  const sendBtn = h('button', { class: 'sg-btn sg-btn-go', style: 'margin-right:8px', text: '⬆ Send (paid)' });
  const closeBtn = h('button', { class: 'sg-btn', text: 'Close', on: { click: () => wrap.remove() } });
  sendBtn.onclick = async () => { sendBtn.classList.add('is-busy'); await o.onSend(setStatus, setStatus); };

  wrap.append(
    h('div', { class: 'sg-title', style: 'font-size:13px;color:var(--accent);margin-bottom:6px', text: '🎨 Outgoing OpenRouter request' }),
    line(`subject:  ${o.kind}`),
    line(`model:    ${o.model}`),
    line(`init:     ${o.size}² PNG · crop ${o.bbox.w}×${o.bbox.h} · key: ${o.keyStatus}`),
    heading('prompt'), pre(o.prompt),
    heading('init image (magenta-backed)'),
    h('img', { style: 'max-width:160px;image-rendering:pixelated;border:1px solid var(--line-2);border-radius:4px;background:var(--bg-0)', attrs: { src: o.initDataUri } }),
    heading('request body'), pre(JSON.stringify(o.body, null, 2)),
    heading('anchors'), pre(JSON.stringify(o.anchors)),
    h('div', { style: 'margin-top:10px' }, sendBtn, closeBtn), status,
  );
  host.appendChild(wrap);
}
