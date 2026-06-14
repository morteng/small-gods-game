// src/studio/ab-section.ts
// A/B model comparison — lives in the bottom dock's "A/B Compare" tab. Generates
// the CURRENT subject through two models against one geometry init image and
// reports the runtime gate metrics (cost/ms/border/IoU/verdict) side by side.
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';
import { type AbResult, AB_MIN_BORDER, AB_MIN_IOU } from './types';
import { h } from './theme';

interface AbSectionOpts {
  models: { id: string; label: string }[];
  defaultA: string; defaultB: string;
  keyStatus: () => string;
  getKind: () => string;
  run: (modelA: string, modelB: string) => Promise<[AbResult, AbResult]>;
  onView: (c: SpriteCanvas, label: string) => void;
}
export function buildAbSection(host: HTMLElement, o: AbSectionOpts): void {
  host.style.cssText += ';padding:9px 11px;font:400 12px/1.4 var(--font-mono);color:var(--ink-0)';
  const sub = h('div', { class: 'sg-muted', style: 'margin-bottom:7px' });
  const refreshSub = () => { sub.textContent = `subject: ${o.getKind()} · key: ${o.keyStatus()}`; };

  const modelSelect = (selected: string): HTMLSelectElement => {
    const s = h('select', { class: 'sg-select', style: 'flex:1 1 160px;min-width:0' }) as HTMLSelectElement;
    for (const m of o.models) { const opt = h('option', { text: m.label, attrs: { value: m.id } }) as HTMLOptionElement; opt.selected = m.id === selected; s.appendChild(opt); }
    return s;
  };
  const selA = modelSelect(o.defaultA), selB = modelSelect(o.defaultB);

  const status = h('div', { class: 'sg-info', style: 'margin:8px 0;min-height:16px;white-space:pre-wrap' });
  const results = h('div', { style: 'display:flex;gap:10px;margin-top:8px;flex-wrap:wrap' });

  const checker = (cx: CanvasRenderingContext2D, w: number, hh: number) => {
    for (let y = 0; y < hh; y += 8) for (let x = 0; x < w; x += 8) { cx.fillStyle = ((x + y) / 8) % 2 ? '#181a21' : '#121319'; cx.fillRect(x, y, 8, 8); }
  };
  const thumb = (src: SpriteCanvas, max: number, onClick: () => void): HTMLCanvasElement => {
    const s = Math.max(0.05, Math.min(max / src.width, max / src.height));
    const tw = Math.max(1, Math.round(src.width * s)), th = Math.max(1, Math.round(src.height * s));
    const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
    const cx = cv.getContext('2d')!; checker(cx, tw, th); cx.imageSmoothingEnabled = false;
    cx.drawImage(src as CanvasImageSource, 0, 0, tw, th);
    cv.style.cssText = 'border:1px solid var(--line-2);border-radius:4px;image-rendering:pixelated;background:var(--bg-0);cursor:pointer';
    cv.onclick = onClick;
    return cv;
  };
  function renderCol(r: AbResult, tag: string): HTMLElement {
    const col = h('div', { style: `flex:1 1 150px;min-width:0;border:1px solid ${r.ok ? '#356b41' : '#7a3a40'};border-radius:var(--r-md);padding:9px;background:var(--bg-1)` });
    col.append(
      h('div', { style: `font-weight:700;color:${r.ok ? 'var(--ok)' : 'var(--bad)'}`, text: `${tag} · ${r.ok ? 'PASS' : 'FAIL'}` }),
      h('div', { class: 'sg-muted', style: 'font-size:10px;word-break:break-all;margin:2px 0', text: r.model }),
      h('div', { style: 'font-size:11px;margin:4px 0', html: `cost <b style="color:var(--ink-0)">$${r.costUsd.toFixed(4)}</b> · <b style="color:var(--ink-0)">${(r.ms / 1000).toFixed(1)}s</b><br>border ${r.border.toFixed(2)} (≥${AB_MIN_BORDER})<br>IoU ${r.iou.toFixed(2)} (≥${AB_MIN_IOU})` }),
      h('div', { class: 'sg-dim', style: 'font-size:10px;margin:3px 0;white-space:pre-wrap;word-break:break-word', text: r.error ? `⛔ ${r.error}` : r.verdict }),
    );
    const imgs = h('div', { style: 'display:flex;gap:6px;margin-top:5px;flex-wrap:wrap' });
    if (r.final) imgs.appendChild(thumb(r.final, 120, () => o.onView(r.final!, `${tag} final · ${r.model}`)));
    else if (r.raw) imgs.appendChild(thumb(r.raw, 120, () => o.onView(r.raw!, `${tag} raw · ${r.model}`)));
    col.appendChild(imgs);
    return col;
  }

  const runBtn = h('button', { class: 'sg-btn sg-btn-go', text: '⬆ Run A/B (paid ×2)' });
  runBtn.onclick = async () => {
    refreshSub();
    if (selA.value === selB.value) { status.textContent = 'Pick two different models.'; return; }
    runBtn.classList.add('is-busy');
    status.textContent = `generating with\n  A ${selA.value}\n  B ${selB.value}…`;
    results.innerHTML = '';
    try {
      const [a, b] = await o.run(selA.value, selB.value);
      results.append(renderCol(a, 'A'), renderCol(b, 'B'));
      const cheaper = a.costUsd <= b.costUsd ? 'A' : 'B';
      const faster = a.ms <= b.ms ? 'A' : 'B';
      status.textContent = (a.ok && b.ok)
        ? `Both PASS · $${(a.costUsd + b.costUsd).toFixed(4)} total · ${cheaper} cheaper (Δ$${Math.abs(a.costUsd - b.costUsd).toFixed(4)}) · ${faster} faster (Δ${(Math.abs(a.ms - b.ms) / 1000).toFixed(1)}s)`
        : `$${(a.costUsd + b.costUsd).toFixed(4)} total · click a sprite to view it large`;
    } catch (err) {
      status.textContent = `error: ${(err as Error).message}`;
    } finally {
      runBtn.classList.remove('is-busy');
    }
  };

  const controls = h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' },
    h('span', { class: 'sg-eyebrow', text: 'A' }), selA,
    h('span', { class: 'sg-muted', text: 'vs' }),
    h('span', { class: 'sg-eyebrow', text: 'B' }), selB,
    runBtn,
  );

  refreshSub();
  host.append(sub, controls, status, results);
}
