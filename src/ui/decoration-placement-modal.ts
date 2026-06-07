import type { AssetSummary } from '@/core/types';
import {
  findAssets,
  generate,
  getAssetBlob,
  loadApiKey,
} from '@/services/pixellab';

/**
 * Right-click decoration placement modal.
 *
 * Shows up to N most recent kept decorations as thumbnails plus a "Generate
 * New" form (prompt + tags). Resolves with the chosen asset id or null on
 * cancel. The blob is loaded lazily by the caller via `getAssetBlob`.
 */

const RECENT_LIMIT = 10;
const DECORATION_TILE_PX = 32;

const STYLE = `
.sg-dec-overlay { all: initial; position: absolute; inset: 0;
  background: oklch(0.20 0.02 60 / 0.45); z-index: 30;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--f-sans); font-size: var(--t-base); color: var(--ink);
  pointer-events: auto; }
.sg-dec-modal { width: 460px; max-width: calc(100vw - 32px);
  max-height: calc(100vh - 40px); overflow-y: auto;
  background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-4);
  padding: 20px 22px; box-shadow: var(--lift-2);
  display: flex; flex-direction: column; gap: 14px;
  box-sizing: border-box; }
.sg-dec-head { display: flex; justify-content: space-between; align-items: baseline; }
.sg-dec-title { font-size: var(--t-lg); font-weight: 600; }
.sg-dec-close { all: unset; cursor: pointer; padding: 2px 8px;
  color: var(--ink-3); font-size: var(--t-lg); line-height: 1;
  border-radius: var(--r-2); }
.sg-dec-close:hover { background: var(--paper-2); color: var(--ink); }
.sg-dec-sub { font-size: var(--t-small); color: var(--ink-3); line-height: 1.5; }
.sg-dec-section-title { font-size: var(--t-small); font-weight: 600; color: var(--ink); }
.sg-dec-divider { height: 1px; background: var(--line); margin: 4px 0; }
.sg-dec-grid { display: grid;
  grid-template-columns: repeat(5, 1fr); gap: 8px; }
.sg-dec-cell { all: unset; cursor: pointer; padding: 6px;
  border: 1px solid var(--line); border-radius: var(--r-2); background: var(--paper-2);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  text-align: center; }
.sg-dec-cell:hover { border-color: var(--faith); background: var(--paper); }
.sg-dec-cell img { image-rendering: pixelated; image-rendering: crisp-edges;
  width: 48px; height: 48px; background:
    repeating-conic-gradient(var(--paper) 0% 25%, var(--paper-2) 0% 50%) 50% / 6px 6px; }
.sg-dec-cell-prompt { font-size: var(--t-micro); color: var(--ink-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  width: 100%; }
.sg-dec-empty { font-size: var(--t-tiny); color: var(--ink-3); font-style: italic;
  padding: 12px 6px; }
.sg-dec-row { display: flex; flex-direction: column; gap: 6px; }
.sg-dec-label { font-size: var(--t-tiny); color: var(--ink-3); letter-spacing: 0.04em;
  text-transform: uppercase; }
.sg-dec-input, .sg-dec-textarea { all: unset; background: var(--paper-2);
  border: 1px solid var(--line); border-radius: var(--r-2); padding: 8px 10px;
  font-family: var(--f-mono); font-size: var(--t-small); color: var(--ink);
  box-sizing: border-box; width: 100%; }
.sg-dec-textarea { min-height: 24px; resize: vertical; }
.sg-dec-input:focus, .sg-dec-textarea:focus { border-color: var(--you-line); }
.sg-dec-actions { display: flex; gap: 8px; justify-content: flex-end; }
.sg-dec-btn { all: unset; cursor: pointer; padding: 7px 14px; border-radius: var(--r-2);
  font-size: var(--t-small); font-weight: 500; }
.sg-dec-btn.primary { background: var(--faith); color: var(--bg); }
.sg-dec-btn.primary:hover { filter: brightness(1.1); }
.sg-dec-btn.primary[disabled] { opacity: 0.4; cursor: not-allowed; }
.sg-dec-btn.ghost { background: var(--paper-2); color: var(--ink); }
.sg-dec-btn.ghost:hover { background: var(--paper); }
.sg-dec-status { font-size: var(--t-small); padding: 8px 10px; border-radius: var(--r-2);
  font-family: var(--f-mono); }
.sg-dec-status.ok   { background: var(--life-soft);   color: var(--w-leaf); }
.sg-dec-status.bad  { background: var(--danger-soft); color: var(--danger); }
.sg-dec-status.info { background: var(--time-soft);   color: var(--time); }
`;

export interface DecorationPlacementResult {
  assetId: string;
}

export interface DecorationPlacementModalHandle {
  open(tile: { x: number; y: number }): Promise<DecorationPlacementResult | null>;
  destroy(): void;
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
  node.className = kind ? `sg-dec-status ${kind}` : 'sg-dec-status';
  node.textContent = text;
  node.style.display = text ? '' : 'none';
}

function parseTags(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function ensureStyles(): void {
  if (document.querySelector('style[data-sg-decoration]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-sg-decoration', '');
  style.textContent = STYLE;
  document.head.appendChild(style);
}

export function createDecorationPlacementModal(
  container: HTMLElement,
): DecorationPlacementModalHandle {
  ensureStyles();

  // Live state — at most one open() promise at a time.
  let resolveOpen: ((r: DecorationPlacementResult | null) => void) | null = null;
  /** Object URLs to revoke when the modal closes. */
  const liveUrls: string[] = [];

  const overlay = el('div', 'sg-dec-overlay');
  overlay.style.display = 'none';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });

  const modal = el('div', 'sg-dec-modal');
  overlay.appendChild(modal);

  const head = el('div', 'sg-dec-head');
  const title = el('div', 'sg-dec-title', 'Place a decoration');
  head.appendChild(title);
  const closeBtn = el('button', 'sg-dec-close', '×');
  closeBtn.addEventListener('click', () => cancel());
  head.appendChild(closeBtn);
  modal.appendChild(head);

  const tileSub = el('div', 'sg-dec-sub', '');
  modal.appendChild(tileSub);

  // Recent library section
  modal.appendChild(el('div', 'sg-dec-section-title', 'Library'));
  const libSub = el('div', 'sg-dec-sub',
    `Pick from your recent ${RECENT_LIMIT} kept decorations, or generate a new one below.`);
  modal.appendChild(libSub);

  const grid = el('div', 'sg-dec-grid');
  modal.appendChild(grid);

  // Divider + Generate New section
  modal.appendChild(el('div', 'sg-dec-divider'));
  modal.appendChild(el('div', 'sg-dec-section-title', 'Generate new'));

  const promptRow = el('div', 'sg-dec-row');
  promptRow.appendChild(el('label', 'sg-dec-label', 'Prompt'));
  const promptInput = el('input', 'sg-dec-input') as HTMLInputElement;
  promptInput.placeholder = 'e.g. a mossy boulder with glowing runes';
  promptRow.appendChild(promptInput);
  modal.appendChild(promptRow);

  const tagsRow = el('div', 'sg-dec-row');
  tagsRow.appendChild(el('label', 'sg-dec-label', 'Tags (comma-separated)'));
  const tagsInput = el('input', 'sg-dec-input') as HTMLInputElement;
  tagsInput.placeholder = 'boulder, mossy, glowing';
  tagsRow.appendChild(tagsInput);
  modal.appendChild(tagsRow);

  const actions = el('div', 'sg-dec-actions');
  const cancelBtn = el('button', 'sg-dec-btn ghost', 'Cancel') as HTMLButtonElement;
  const genBtn    = el('button', 'sg-dec-btn primary', 'Generate & place') as HTMLButtonElement;
  cancelBtn.addEventListener('click', () => cancel());
  genBtn.addEventListener('click', () => void onGenerate());
  actions.append(cancelBtn, genBtn);
  modal.appendChild(actions);

  const status = el('div', 'sg-dec-status');
  status.style.display = 'none';
  modal.appendChild(status);

  container.appendChild(overlay);

  function revokeAllUrls(): void {
    while (liveUrls.length > 0) URL.revokeObjectURL(liveUrls.pop()!);
  }

  function clearGrid(): void {
    while (grid.firstChild) grid.removeChild(grid.firstChild);
  }

  async function refreshGrid(): Promise<void> {
    clearGrid();
    const items = await findAssets({ kind: 'decoration', limit: RECENT_LIMIT });
    if (items.length === 0) {
      const empty = el('div', 'sg-dec-empty', '(no decorations kept yet — generate one below)');
      grid.appendChild(empty);
      return;
    }
    for (const a of items) grid.appendChild(await renderCell(a));
  }

  async function renderCell(a: AssetSummary): Promise<HTMLElement> {
    const cell = el('button', 'sg-dec-cell') as HTMLButtonElement;
    cell.type = 'button';
    cell.title = a.prompt;
    const img = new Image(48, 48);
    const blob = await getAssetBlob(a.id);
    if (blob) {
      const url = URL.createObjectURL(blob);
      liveUrls.push(url);
      img.src = url;
    }
    cell.appendChild(img);
    const label = el('div', 'sg-dec-cell-prompt', a.prompt);
    cell.appendChild(label);
    cell.addEventListener('click', () => finish({ assetId: a.id }));
    return cell;
  }

  async function onGenerate(): Promise<void> {
    const key = loadApiKey();
    if (!key) {
      setStatus(status, 'bad', 'Save a PixelLab API key in settings (K) first.');
      return;
    }
    const prompt = promptInput.value.trim();
    if (!prompt) {
      setStatus(status, 'bad', 'Prompt is required.');
      return;
    }
    const tags = parseTags(tagsInput.value);
    setStatus(status, 'info', `Generating ${DECORATION_TILE_PX}×${DECORATION_TILE_PX}…`);
    genBtn.disabled = true;
    try {
      const t0 = performance.now();
      const result = await generate(key, {
        prompt,
        width:  DECORATION_TILE_PX,
        height: DECORATION_TILE_PX,
        kind: 'decoration',
        tags,
        origin: 'official',
      });
      const ms = Math.round(performance.now() - t0);
      setStatus(status, 'ok',
        `OK${result.cached ? ' (cache hit)' : ''} · ${ms}ms · placing…`);
      // Settle promise — caller is responsible for state mutation + render.
      finish({ assetId: result.key });
    } catch (err) {
      setStatus(status, 'bad', `Failed: ${(err as Error).message}`);
    } finally {
      genBtn.disabled = false;
    }
  }

  function finish(r: DecorationPlacementResult): void {
    const resolve = resolveOpen;
    resolveOpen = null;
    overlay.style.display = 'none';
    revokeAllUrls();
    resolve?.(r);
  }

  function cancel(): void {
    const resolve = resolveOpen;
    resolveOpen = null;
    overlay.style.display = 'none';
    revokeAllUrls();
    resolve?.(null);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (overlay.style.display === 'none') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }
  window.addEventListener('keydown', onKeyDown);

  function open(tile: { x: number; y: number }): Promise<DecorationPlacementResult | null> {
    // If something else is open, cancel it first.
    if (resolveOpen) cancel();
    tileSub.textContent = `Tile (${tile.x}, ${tile.y}). Pick a decoration or generate a new one.`;
    promptInput.value = '';
    tagsInput.value = '';
    setStatus(status, null, '');
    overlay.style.display = '';
    void refreshGrid();
    // Defer focus so the overlay is fully shown
    setTimeout(() => promptInput.focus(), 0);
    return new Promise<DecorationPlacementResult | null>((resolve) => {
      resolveOpen = resolve;
    });
  }

  function destroy(): void {
    window.removeEventListener('keydown', onKeyDown);
    if (resolveOpen) cancel();
    overlay.remove();
  }

  return { open, destroy };
}
