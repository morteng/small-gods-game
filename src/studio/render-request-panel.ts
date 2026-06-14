// src/studio/render-request-panel.ts
// Outgoing-request review panel (shown BEFORE the paid call) + the view-pane
// "live" badge. Moved out of studio.ts (pure refactor).

// ── view-pane "live" badge ───────────────────────────────────────────────────
export function makeLiveButton(viewPane: HTMLElement, onLive: () => void): { show: (l: string) => void; hide: () => void } {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;top:10px;left:10px;display:none;align-items:center;gap:8px;z-index:11;font:12px monospace;color:#cfe';
  const label = document.createElement('span');
  label.style.cssText = 'background:rgba(20,20,32,0.9);border:1px solid #3a3a52;border-radius:4px;padding:3px 8px';
  const btn = document.createElement('button');
  btn.textContent = '▶ Live';
  btn.style.cssText = 'background:#21213a;color:#ffd35a;border:1px solid #3a3a52;border-radius:4px;padding:3px 10px;cursor:pointer;font:12px monospace';
  btn.onclick = onLive;
  bar.append(label, btn);
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
  const wrap = document.createElement('div');
  wrap.id = 'studio-meta';
  wrap.style.cssText = [
    'position:absolute', 'top:12px', 'left:12px', 'width:420px', 'max-height:calc(100% - 24px)',
    'overflow:auto', 'padding:12px 14px', 'background:rgba(14,14,22,0.97)', 'border:1px solid #4a4a6a',
    'border-radius:8px', 'font:12px monospace', 'color:#cfe', 'z-index:20',
  ].join(';');

  const h = (t: string) => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'color:#ffd35a;margin:8px 0 3px;font-weight:bold'; return d; };
  const pre = (t: string) => { const p = document.createElement('pre'); p.textContent = t; p.style.cssText = 'white-space:pre-wrap;word-break:break-word;background:#11111a;border:1px solid #2a2a3a;border-radius:4px;padding:6px;margin:0;max-height:180px;overflow:auto'; return p; };
  const line = (t: string) => { const d = document.createElement('div'); d.textContent = t; d.style.margin = '2px 0'; return d; };

  const title = document.createElement('div');
  title.textContent = '🎨 Outgoing OpenRouter request — review before sending';
  title.style.cssText = 'font-weight:bold;color:#ffd35a;margin-bottom:6px';

  const img = document.createElement('img');
  img.src = o.initDataUri;
  img.style.cssText = 'max-width:160px;image-rendering:pixelated;border:1px solid #3a3a52;background:#11111a';

  const status = document.createElement('div');
  status.style.cssText = 'margin-top:8px;color:#9fd;min-height:16px';
  const setStatus = (m: string) => { status.textContent = m; };

  const sendBtn = document.createElement('button');
  sendBtn.textContent = '⬆ Send (paid)';
  sendBtn.style.cssText = 'background:#2a4a2a;color:#cfe;border:1px solid #4a6a4a;border-radius:4px;padding:5px 12px;cursor:pointer;font:12px monospace;margin-right:8px';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'background:#21213a;color:#cfe;border:1px solid #3a3a52;border-radius:4px;padding:5px 12px;cursor:pointer;font:12px monospace';
  closeBtn.onclick = () => wrap.remove();
  sendBtn.onclick = async () => {
    sendBtn.disabled = true; sendBtn.style.opacity = '0.5';
    await o.onSend(setStatus, (m) => { setStatus(m); });
  };
  const btns = document.createElement('div'); btns.style.marginTop = '8px'; btns.append(sendBtn, closeBtn);

  wrap.append(
    title,
    line(`subject:  ${o.kind}`),
    line(`model:    ${o.model}`),
    line(`init:     ${o.size}² PNG · crop ${o.bbox.w}×${o.bbox.h} · key: ${o.keyStatus}`),
    h('prompt'), pre(o.prompt),
    h('init image (magenta-backed)'), img,
    h('request body'), pre(JSON.stringify(o.body, null, 2)),
    h('anchors'), pre(JSON.stringify(o.anchors)),
    btns, status,
  );
  host.appendChild(wrap);
}
