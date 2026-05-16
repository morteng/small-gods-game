import type { PixelLabBalance, PixelLabKeyStatus } from '@/core/types';
import {
  clearApiKey,
  fetchBalance,
  generate,
  loadApiKey,
  saveApiKey,
} from '@/services/pixellab';

const STYLE = `
.sg-set-overlay { all: initial; position: absolute; inset: 0;
  background: rgba(0,0,0,0.55); z-index: 20;
  display: flex; align-items: center; justify-content: center;
  font: 13px -apple-system, system-ui, sans-serif; color: #e6e6ea;
  pointer-events: auto; }
.sg-set-modal { width: 420px; max-width: calc(100vw - 32px);
  background: #181820; border: 1px solid #2b2b36; border-radius: 8px;
  padding: 20px 22px; box-shadow: 0 16px 48px rgba(0,0,0,0.6);
  display: flex; flex-direction: column; gap: 14px; }
.sg-set-head { display: flex; justify-content: space-between; align-items: baseline; }
.sg-set-title { font-size: 15px; font-weight: 600; }
.sg-set-close { all: unset; cursor: pointer; padding: 2px 8px;
  color: rgba(255,255,255,0.55); font-size: 18px; line-height: 1;
  border-radius: 4px; }
.sg-set-close:hover { background: rgba(255,255,255,0.08); color: #fff; }
.sg-set-sub { font-size: 11.5px; color: #9ea0aa; line-height: 1.5; }
.sg-set-sub code { background: #20202a; padding: 1px 5px; border-radius: 3px;
  font: 11px ui-monospace,monospace; color: #ffd54f; }
.sg-set-row { display: flex; flex-direction: column; gap: 6px; }
.sg-set-label { font-size: 11px; color: #9ea0aa; letter-spacing: 0.04em;
  text-transform: uppercase; }
.sg-set-input { all: unset; background: #0e0e12; border: 1px solid #2b2b36;
  border-radius: 4px; padding: 8px 10px; font: 12px ui-monospace,monospace;
  color: #e6e6ea; flex: 1; }
.sg-set-input:focus { border-color: #4a4a5a; }
.sg-set-actions { display: flex; gap: 8px; }
.sg-set-btn { all: unset; cursor: pointer; padding: 7px 14px; border-radius: 4px;
  font-size: 12px; font-weight: 500; }
.sg-set-btn.primary { background: #FFD54F; color: #1a1a1f; }
.sg-set-btn.primary:hover { background: #FFE082; }
.sg-set-btn.primary[disabled] { background: #555; color: #aaa; cursor: not-allowed; }
.sg-set-btn.ghost { background: rgba(255,255,255,0.06); color: #e6e6ea; }
.sg-set-btn.ghost:hover { background: rgba(255,255,255,0.12); }
.sg-set-status { font-size: 11.5px; padding: 8px 10px; border-radius: 4px;
  font-family: ui-monospace,monospace; }
.sg-set-status.ok   { background: rgba(74,222,128,0.10); color: #4ade80; }
.sg-set-status.bad  { background: rgba(239,68,68,0.10);  color: #ef4444; }
.sg-set-status.info { background: rgba(159,216,255,0.08); color: #9fd8ff; }
.sg-set-preview { display: flex; flex-direction: column; align-items: center;
  gap: 6px; padding: 12px; border: 1px solid #2b2b36; border-radius: 6px;
  background:
    repeating-conic-gradient(#1e1e26 0% 25%, #14141a 0% 50%) 50% / 8px 8px; }
.sg-set-preview img { image-rendering: pixelated; image-rendering: crisp-edges; }
.sg-set-preview-meta { font-size: 10px; color: #9ea0aa; font-family: ui-monospace,monospace; }
.sg-set-link { color: #9fd8ff; text-decoration: none; }
.sg-set-link:hover { text-decoration: underline; }
`;

export interface SettingsPanelHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  destroy(): void;
}

interface UiRefs {
  input: HTMLInputElement;
  saveBtn: HTMLButtonElement;
  testBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  status: HTMLDivElement;
  preview: HTMLDivElement;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function setStatus(node: HTMLDivElement, kind: 'ok' | 'bad' | 'info' | null, text: string): void {
  node.className = kind ? `sg-set-status ${kind}` : 'sg-set-status';
  node.textContent = text;
  node.style.display = text ? '' : 'none';
}

function formatBalance(b: PixelLabBalance): string {
  return `${b.generationsRemaining}/${b.generationsTotal} free gens · $${b.creditsUsd.toFixed(2)} credits`;
}

/** Status text for a known-status key (without re-hitting the API). */
function statusForKey(status: PixelLabKeyStatus, key: string | null): string {
  if (status === 'missing') return 'No key saved.';
  if (status === 'unverified') return `Key saved (…${key?.slice(-6)}). Click Verify to check balance.`;
  if (status === 'invalid') return 'Saved key rejected by PixelLab.';
  return 'Key verified.';
}

export function createSettingsPanel(container: HTMLElement): SettingsPanelHandle {
  // Ensure styles are injected once per container
  if (!document.querySelector('style[data-sg-settings]')) {
    const style = document.createElement('style');
    style.setAttribute('data-sg-settings', '');
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const overlay = el('div', 'sg-set-overlay');
  overlay.style.display = 'none';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });

  const modal = el('div', 'sg-set-modal');
  overlay.appendChild(modal);

  const head = el('div', 'sg-set-head');
  head.appendChild(el('div', 'sg-set-title', 'PixelLab API key'));
  const closeBtn = el('button', 'sg-set-close', '×');
  closeBtn.addEventListener('click', () => hide());
  head.appendChild(closeBtn);
  modal.appendChild(head);

  const sub = el('div', 'sg-set-sub');
  sub.append(
    'Paste your key from ',
    Object.assign(el('a', 'sg-set-link', 'pixellab.ai/account'),
      { href: 'https://www.pixellab.ai/account', target: '_blank', rel: 'noopener' }),
    '. Free tier is 40 generations/month, no card required. Keys are stored locally in your browser only. Set ',
    el('code', undefined, 'SMALL_GODS_KEY'), '? No — just paste below.',
  );
  modal.appendChild(sub);

  const row = el('div', 'sg-set-row');
  row.appendChild(el('label', 'sg-set-label', 'API key'));
  const input = el('input', 'sg-set-input') as HTMLInputElement;
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'e.g. 684533a5-f005-…';
  row.appendChild(input);
  modal.appendChild(row);

  const actions = el('div', 'sg-set-actions');
  const saveBtn  = el('button', 'sg-set-btn primary', 'Save & verify') as HTMLButtonElement;
  const testBtn  = el('button', 'sg-set-btn ghost',   'Test generate')  as HTMLButtonElement;
  const clearBtn = el('button', 'sg-set-btn ghost',   'Clear')          as HTMLButtonElement;
  testBtn.disabled = true;
  actions.append(saveBtn, testBtn, clearBtn);
  modal.appendChild(actions);

  const status = el('div', 'sg-set-status');
  status.style.display = 'none';
  modal.appendChild(status);

  const preview = el('div', 'sg-set-preview');
  preview.style.display = 'none';
  modal.appendChild(preview);

  container.appendChild(overlay);

  const refs: UiRefs = { input, saveBtn, testBtn, clearBtn, status, preview };

  // Restore saved key on mount
  const saved = loadApiKey();
  if (saved) {
    input.value = saved;
    refs.testBtn.disabled = false;
    setStatus(status, 'info', statusForKey('unverified', saved));
  } else {
    setStatus(status, null, '');
  }

  saveBtn.addEventListener('click', () => onSave(refs));
  testBtn.addEventListener('click', () => onTest(refs));
  clearBtn.addEventListener('click', () => onClear(refs));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSave(refs); });

  function show(): void {
    overlay.style.display = '';
    setTimeout(() => input.focus(), 0);
  }
  function hide(): void { overlay.style.display = 'none'; }
  function toggle(): void { if (overlay.style.display === 'none') show(); else hide(); }
  function isVisible(): boolean { return overlay.style.display !== 'none'; }

  return {
    show, hide, toggle, isVisible,
    destroy: () => overlay.remove(),
  };
}

async function onSave(refs: UiRefs): Promise<void> {
  const key = refs.input.value.trim();
  if (!key) {
    setStatus(refs.status, 'bad', 'Empty key.');
    return;
  }
  setStatus(refs.status, 'info', 'Verifying…');
  refs.saveBtn.disabled = true;
  try {
    const bal = await fetchBalance(key);
    saveApiKey(key);
    refs.testBtn.disabled = false;
    setStatus(refs.status, 'ok', `Valid · ${formatBalance(bal)}`);
  } catch (err) {
    setStatus(refs.status, 'bad', `Rejected: ${(err as Error).message}`);
  } finally {
    refs.saveBtn.disabled = false;
  }
}

async function onTest(refs: UiRefs): Promise<void> {
  const key = refs.input.value.trim() || loadApiKey();
  if (!key) {
    setStatus(refs.status, 'bad', 'Save a key first.');
    return;
  }
  setStatus(refs.status, 'info', 'Generating sample sprite (priest, 64×64)…');
  refs.testBtn.disabled = true;
  try {
    const t0 = performance.now();
    const result = await generate(key, {
      prompt: 'medieval village priest, brown robe, holding a staff, side view',
      width:  64,
      height: 64,
    });
    const ms = Math.round(performance.now() - t0);
    const url = URL.createObjectURL(result.blob);

    // Reset preview
    while (refs.preview.firstChild) refs.preview.removeChild(refs.preview.firstChild);
    const img = new Image(256, 256);
    img.src = url;
    refs.preview.appendChild(img);
    const meta = el('div', 'sg-set-preview-meta',
      `${result.cached ? 'cache hit' : 'fresh'} · ${ms}ms · key…${result.key.slice(0, 8)}`);
    refs.preview.appendChild(meta);
    refs.preview.style.display = '';

    const bal = await fetchBalance(key).catch(() => null);
    setStatus(refs.status, 'ok',
      `OK${result.cached ? ' (from cache)' : ''}${bal ? ' · ' + formatBalance(bal) : ''}`);
  } catch (err) {
    setStatus(refs.status, 'bad', `Failed: ${(err as Error).message}`);
  } finally {
    refs.testBtn.disabled = false;
  }
}

function onClear(refs: UiRefs): void {
  clearApiKey();
  refs.input.value = '';
  refs.testBtn.disabled = true;
  refs.preview.style.display = 'none';
  setStatus(refs.status, 'info', 'Cleared. Key removed from local storage.');
}
