// src/studio/ab-section.ts
// A/B model comparison (inline left-pane section). Moved out of studio.ts (pure
// refactor).
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';
import { type AbResult, AB_MIN_BORDER, AB_MIN_IOU } from './types';

// ── A/B model comparison (inline left-pane section) ──────────────────────────
interface AbSectionOpts {
  models: { id: string; label: string }[];
  defaultA: string; defaultB: string;
  keyStatus: () => string;
  getKind: () => string;
  run: (modelA: string, modelB: string) => Promise<[AbResult, AbResult]>;
  onView: (c: SpriteCanvas, label: string) => void;
}
export function buildAbSection(host: HTMLElement, o: AbSectionOpts): void {
  host.style.cssText += ';padding:8px 10px;font:12px monospace;color:#cfe';
  const sub = document.createElement('div'); sub.style.cssText = 'opacity:0.6;margin-bottom:4px';
  const refreshSub = () => { sub.textContent = `subject: ${o.getKind()} · key: ${o.keyStatus()}`; };

  const modelSelect = (selected: string): HTMLSelectElement => {
    const s = document.createElement('select');
    s.style.cssText = 'width:100%;box-sizing:border-box;background:#11111a;color:#cfe;border:1px solid #3a3a52;padding:3px;margin:2px 0';
    for (const m of o.models) { const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.label; opt.selected = m.id === selected; s.appendChild(opt); }
    return s;
  };
  const selA = modelSelect(o.defaultA), selB = modelSelect(o.defaultB);
  const lblA = document.createElement('div'); lblA.textContent = 'Model A'; lblA.style.opacity = '0.7';
  const lblB = document.createElement('div'); lblB.textContent = 'Model B'; lblB.style.opacity = '0.7';

  const status = document.createElement('div'); status.style.cssText = 'margin:8px 0;color:#9fd;min-height:16px;white-space:pre-wrap';
  const results = document.createElement('div'); results.style.cssText = 'display:flex;gap:10px;margin-top:8px;flex-wrap:wrap';

  const checker = (cx: CanvasRenderingContext2D, w: number, h: number) => {
    for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { cx.fillStyle = ((x + y) / 8) % 2 ? '#2a2a3a' : '#1c1c28'; cx.fillRect(x, y, 8, 8); }
  };
  const thumb = (src: SpriteCanvas, max: number, onClick: () => void): HTMLCanvasElement => {
    const s = Math.max(0.05, Math.min(max / src.width, max / src.height));
    const tw = Math.max(1, Math.round(src.width * s)), th = Math.max(1, Math.round(src.height * s));
    const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
    const cx = cv.getContext('2d')!; checker(cx, tw, th); cx.imageSmoothingEnabled = false;
    cx.drawImage(src as CanvasImageSource, 0, 0, tw, th);
    cv.style.cssText = 'border:1px solid #3a3a52;image-rendering:pixelated;background:#11111a;cursor:pointer';
    cv.onclick = onClick;
    return cv;
  };
  function renderCol(r: AbResult, tag: string): HTMLElement {
    const col = document.createElement('div');
    col.style.cssText = `flex:1 1 120px;min-width:0;border:1px solid ${r.ok ? '#3a6a3a' : '#6a3a3a'};border-radius:6px;padding:8px`;
    const head = document.createElement('div'); head.style.cssText = `font-weight:bold;color:${r.ok ? '#9f9' : '#f99'}`; head.textContent = `${tag} · ${r.ok ? 'PASS' : 'FAIL'}`;
    const id = document.createElement('div'); id.style.cssText = 'font:10px monospace;opacity:0.7;word-break:break-all;margin:2px 0'; id.textContent = r.model;
    const metrics = document.createElement('div'); metrics.style.cssText = 'font:11px monospace;margin:4px 0';
    metrics.innerHTML = `cost <b>$${r.costUsd.toFixed(4)}</b> · <b>${(r.ms / 1000).toFixed(1)}s</b><br>border ${r.border.toFixed(2)} (≥${AB_MIN_BORDER})<br>IoU ${r.iou.toFixed(2)} (≥${AB_MIN_IOU})`;
    const verdict = document.createElement('div'); verdict.style.cssText = 'font:10px monospace;opacity:0.85;margin:3px 0;white-space:pre-wrap;word-break:break-word';
    verdict.textContent = r.error ? `⛔ ${r.error}` : r.verdict;
    col.append(head, id, metrics, verdict);
    const imgs = document.createElement('div'); imgs.style.cssText = 'display:flex;gap:6px;margin-top:4px;flex-wrap:wrap';
    if (r.final) imgs.appendChild(thumb(r.final, 120, () => o.onView(r.final!, `${tag} final · ${r.model}`)));
    else if (r.raw) imgs.appendChild(thumb(r.raw, 120, () => o.onView(r.raw!, `${tag} raw · ${r.model}`)));
    col.appendChild(imgs);
    return col;
  }

  const runBtn = document.createElement('button');
  runBtn.textContent = '⬆ Run A/B (paid ×2)';
  runBtn.style.cssText = 'background:#2a4a2a;color:#cfe;border:1px solid #4a6a4a;border-radius:4px;padding:5px 12px;cursor:pointer;font:12px monospace;margin-top:6px';
  runBtn.onclick = async () => {
    refreshSub();
    if (selA.value === selB.value) { status.textContent = 'Pick two different models.'; return; }
    runBtn.disabled = true; runBtn.style.opacity = '0.5';
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
      runBtn.disabled = false; runBtn.style.opacity = '1';
    }
  };

  refreshSub();
  host.append(sub, lblA, selA, lblB, selB, runBtn, status, results);
}
