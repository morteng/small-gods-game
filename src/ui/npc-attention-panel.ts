import type { NpcSimState } from '@/core/types';
import { npcStatusHint } from '@/sim/believers';
import { mountWhisperInput, type WhisperInputHandle } from '@/ui/npc-whisper-mode';
import { mountMindMode, type MindModeHandle } from '@/ui/npc-mind-mode';
import { mindProbeCost } from '@/sim/mind-probe';
import type { MindPage } from '@/llm/npc-attention-store';

const WHISPER_COST = 1;
const DREAM_COST = 4;
const ANSWER_PRAYER_COST = 2;
const OMEN_COST = 3;
const MIRACLE_COST = 10;

const NEED_COLORS = {
  safety: '#4CAF50', prosperity: '#FFC107', community: '#42A5F5', meaning: '#CE93D8',
} as const;
const FAITH_COLORS = {
  faith: '#FFD54F', understanding: '#42A5F5', devotion: '#FF8A65',
} as const;

const STYLE = `
.sg-header { display: flex; justify-content: flex-end; margin: -6px -6px 6px 0; }
.sg-pin { all: unset; cursor: pointer; pointer-events: auto; padding: 3px 8px; border-radius: var(--r-2); color: var(--ink-3); font-size: var(--t-md); }
.sg-pin:hover { background: var(--paper-2); color: var(--ink); }
.sg-pin[aria-pressed="true"] { color: var(--faith); background: var(--faith-soft); }
.sg-section { margin-bottom: 12px; }
.sg-section-title { font-size: var(--t-micro); letter-spacing: 0.1em; color: var(--ink-3); margin-bottom: 6px; text-transform: uppercase; font-weight: 600; }
.sg-id-name { font-family: var(--f-sans); font-weight: 700; font-size: var(--t-xl); color: var(--ink); line-height: 1.1; }
.sg-id-meta { font-size: var(--t-small); color: var(--ink-3); margin-top: 4px; }
.sg-row { display: flex; align-items: center; font-size: var(--t-small); color: var(--ink); margin-bottom: 5px; }
.sg-row-label { flex: 0 0 92px; color: var(--ink-2); }
.sg-row-num { flex: 0 0 38px; text-align: right; color: var(--ink-3); font-family: var(--f-mono); font-variant-numeric: tabular-nums; }
.sg-track { flex: 1 1 auto; height: 8px; background: var(--paper-2); border: 1px solid var(--line); border-radius: var(--r-pill); overflow: hidden; margin: 0 8px; }
.sg-fill { height: 100%; border-radius: var(--r-pill); }
.sg-status-hint { font-style: italic; font-size: var(--t-small); color: var(--faith); margin-bottom: 6px; }
.sg-top { display: flex; gap: 14px; align-items: flex-start; }
.sg-portrait { flex: 0 0 104px; width: 104px; height: 104px; border-radius: var(--r-4); box-sizing: border-box;
  display: flex; align-items: center; justify-content: center; font-family: var(--f-sans); font-weight: 700; font-size: 48px; color: var(--ink);
  text-shadow: 0 1px 3px oklch(0 0 0 / 0.5); border: 1px solid var(--line-2); image-rendering: pixelated; }
.sg-top-col { flex: 1 1 auto; min-width: 0; }
.sg-body { min-height: 56px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
.sg-body-placeholder { font-style: italic; font-size: var(--t-small); color: var(--ink-4); padding: 10px 0; }
.sg-actions { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
.sg-action { all: unset; cursor: pointer; pointer-events: auto; padding: 6px 12px; border-radius: var(--r-2);
  font-family: var(--f-sans); font-weight: 600; font-size: var(--t-small); letter-spacing: 0.3px;
  background: var(--paper-2); border: 1px solid var(--line); color: var(--ink-2); }
.sg-action:hover { background: var(--paper); border-color: var(--line-2); color: var(--ink); }
.sg-action:disabled { opacity: 0.35; cursor: default; }
.sg-action-cost { color: var(--faith); font-weight: 500; margin-left: 4px; }
`;

export interface NpcAttentionPanelOptions {
  pinned?: boolean;
  power?: number;
  onTogglePin?: () => void;
  onDream?: () => void;
  onAnswerPrayer?: () => void;
  onOmen?: () => void;
  onMiracle?: () => void;
  onLlmBackfill?: () => void;
  /** The selected NPC's LPC sprite sheet; the portrait draws its down-idle frame. Null → avatar fallback. */
  portraitSheet?: HTMLCanvasElement | null;
}

export interface NpcAttentionPanelDeps {
  onWhisperSend(npcId: string, text: string): void;
  onMindOpen(npcId: string, path: string[], depth: number): void;
  onMindCrossNav(entityId: string): void;
}

export interface NpcAttentionPanelHandle {
  update(sim: NpcSimState, opts?: NpcAttentionPanelOptions): void;
  setNpc(npcId: string): void;
  showMindPage(path: string[], page: MindPage): void;
  destroy(): void;
}

function barRow(label: string, value: number, color: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'sg-row';
  const l = document.createElement('div'); l.className = 'sg-row-label'; l.textContent = label;
  const track = document.createElement('div'); track.className = 'sg-track';
  const fill = document.createElement('div'); fill.className = 'sg-fill';
  fill.style.width = `${(Math.max(0, Math.min(1, value)) * 100).toFixed(0)}%`;
  fill.style.background = color;
  track.appendChild(fill);
  const num = document.createElement('div'); num.className = 'sg-row-num'; num.textContent = value.toFixed(2);
  row.append(l, track, num);
  return row;
}

function section(title: string, ...children: HTMLElement[]): HTMLDivElement {
  const sec = document.createElement('div'); sec.className = 'sg-section';
  const t = document.createElement('div'); t.className = 'sg-section-title'; t.textContent = title;
  sec.append(t, ...children);
  return sec;
}

/** Deterministic avatar background from an npc id — stable per NPC, no asset needed. */
function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 45%, 38%)`;
}

/** LPC sheet geometry: 64×64 frames; "down" walk row = 10, idle frame = 0. */
const LPC_FRAME = 64;
const LPC_DOWN_ROW = 10;
const PORTRAIT_PX = 104;

/**
 * Fill the portrait box with the NPC's down-idle sprite frame when a sheet is
 * available; otherwise fall back to a deterministic colored avatar with the
 * NPC's initial. Idempotent — safe to call every panel update.
 */
function renderPortrait(box: HTMLDivElement, sim: NpcSimState, sheet: HTMLCanvasElement | null): void {
  box.title = `${sim.name} · ${sim.role}`;
  const sy = LPC_DOWN_ROW * LPC_FRAME;
  const hasFrame = !!sheet && sheet.width >= LPC_FRAME && sheet.height >= sy + LPC_FRAME;
  if (hasFrame) {
    let canvas = box.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      box.textContent = '';
      canvas = document.createElement('canvas');
      canvas.width = PORTRAIT_PX; canvas.height = PORTRAIT_PX;
      canvas.style.cssText = 'width:100%;height:100%;image-rendering:pixelated;border-radius:7px;';
      box.appendChild(canvas);
    }
    const c2d = canvas.getContext('2d');
    if (c2d) {
      c2d.clearRect(0, 0, PORTRAIT_PX, PORTRAIT_PX);
      c2d.imageSmoothingEnabled = false;
      c2d.drawImage(sheet!, 0, sy, LPC_FRAME, LPC_FRAME, 0, 0, PORTRAIT_PX, PORTRAIT_PX);
    }
    box.style.background = 'rgba(0,0,0,0.25)';
    return;
  }
  // Avatar fallback.
  const existing = box.querySelector('canvas');
  if (existing) box.removeChild(existing);
  box.textContent = (sim.name?.[0] ?? '?').toUpperCase();
  box.style.background = avatarColor(sim.npcId);
}

function actionBtn(key: string, label: string, costLabel: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'sg-action'; b.type = 'button';
  b.dataset.sgAction = key;
  b.innerHTML = `${label}<span class="sg-action-cost">${costLabel}</span>`;
  return b;
}

export function mountNpcAttentionPanel(
  panel: HTMLElement,
  deps: NpcAttentionPanelDeps,
): NpcAttentionPanelHandle {
  let currentNpcId: string | null = null;
  let mindPath: string[] = ['surface'];
  // npcId|pathKey the mind view currently shows, so we lazy-open exactly once.
  let mindLoadedFor: string | null = null;

  function pathKeyLocal(p: string[]): string { return p.join(' ▸ '); }
  function mindKeyFor(npcId: string, p: string[]): string { return npcId + '|' + pathKeyLocal(p); }

  while (panel.firstChild) panel.removeChild(panel.firstChild);

  const style = document.createElement('style'); style.textContent = STYLE; panel.appendChild(style);

  const header = document.createElement('div'); header.className = 'sg-header';
  const pin = document.createElement('button');
  pin.className = 'sg-pin'; pin.type = 'button'; pin.textContent = '📌'; pin.dataset.sg = 'pin';
  header.appendChild(pin);

  const idSection = section('identity');
  const idName = document.createElement('div'); idName.className = 'sg-id-name';
  const idMeta = document.createElement('div'); idMeta.className = 'sg-id-meta';
  idSection.append(idName, idMeta);

  const needsHost = section('needs');
  const faithHost = section('faith in you');

  // Portrait (left) beside the identity + stats column (right).
  const portrait = document.createElement('div'); portrait.className = 'sg-portrait';
  const topCol = document.createElement('div'); topCol.className = 'sg-top-col';
  topCol.append(idSection, needsHost, faithHost);
  const topRow = document.createElement('div'); topRow.className = 'sg-top';
  topRow.append(portrait, topCol);

  const mindBody = document.createElement('div');
  mindBody.className = 'sg-body'; mindBody.dataset.sgBody = 'mind';
  const mindMode = mountMindMode(mindBody, {
    onDrill: (label) => {
      mindPath = [...mindPath, label];
      mindMode.showLoading(mindPath);
      if (currentNpcId) deps.onMindOpen(currentNpcId, mindPath, mindPath.length - 1);
    },
    onCrumb: (i) => {
      mindPath = mindPath.slice(0, i + 1);
      mindMode.showLoading(mindPath);
      if (currentNpcId) deps.onMindOpen(currentNpcId, mindPath, mindPath.length - 1);
    },
    onCrossNav: (id) => { deps.onMindCrossNav(id); },
    nextCost: () => mindProbeCost(mindPath.length), // next depth = current path length
  });

  const whisperHost = document.createElement('div');
  const whisperInput: WhisperInputHandle = mountWhisperInput(whisperHost, {
    onSend: (text) => {
      if (!currentNpcId) return;
      // A whisper re-shapes the surface: snap back to it and show the "stir" state;
      // game.ts re-reads the surface after the whisper resolves and pushes it via showMindPage.
      mindPath = ['surface'];
      mindLoadedFor = mindKeyFor(currentNpcId, mindPath);
      mindMode.showLoading(mindPath);
      deps.onWhisperSend(currentNpcId, text);
    },
  });

  const actions = document.createElement('div'); actions.className = 'sg-actions';
  const backfillBtn = actionBtn('backfill', '💭 Backfill', 'LLM');
  backfillBtn.title = 'Backfill — have the LLM narrate this mortal’s inner life from their current state. Needs at least 1 power.';
  const dreamBtn = actionBtn('dream', '🌙 Dream', `${DREAM_COST}p`);
  dreamBtn.title = `Send a dream — plant an idea while they sleep. Costs ${DREAM_COST} power.`;
  const prayBtn = actionBtn('answer', '🙏 Answer', `${ANSWER_PRAYER_COST}p`);
  prayBtn.title = `Answer their prayer — reward devotion when they worship. Costs ${ANSWER_PRAYER_COST} power.`;
  const omenBtn = actionBtn('omen', '⛈ Omen', `${OMEN_COST}p`);
  omenBtn.title = `Send an omen — a sign over their home that the faithful will read. Costs ${OMEN_COST} power.`;
  const miracleBtn = actionBtn('miracle', '✨ Miracle', `${MIRACLE_COST}p`);
  miracleBtn.title = `Work a miracle — an unmistakable act of divine power. Costs ${MIRACLE_COST} power.`;
  actions.append(backfillBtn, dreamBtn, prayBtn, omenBtn, miracleBtn);

  panel.append(header, topRow, mindBody, whisperHost, actions);

  // Open the current mind page exactly once per (npc, path).
  function ensureMindLoaded(): void {
    if (currentNpcId && mindLoadedFor !== mindKeyFor(currentNpcId, mindPath)) {
      mindMode.showLoading(mindPath);
      deps.onMindOpen(currentNpcId, mindPath, mindPath.length - 1);
    }
  }

  let opts: NpcAttentionPanelOptions = {};
  pin.addEventListener('click', (e) => { e.stopPropagation(); opts.onTogglePin?.(); });
  backfillBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onLlmBackfill?.(); });
  dreamBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onDream?.(); });
  prayBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onAnswerPrayer?.(); });
  omenBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onOmen?.(); });
  miracleBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onMiracle?.(); });

  function replaceChildren(host: HTMLElement, keepTitle: boolean, ...rows: HTMLElement[]): void {
    const title = keepTitle ? host.querySelector('.sg-section-title') : null;
    while (host.firstChild) host.removeChild(host.firstChild);
    if (title) host.appendChild(title);
    host.append(...rows);
  }

  return {
    update(sim, nextOpts = {}) {
      opts = nextOpts;
      const belief = sim.beliefs['player'] ?? { faith: 0, understanding: 0, devotion: 0 };
      const power = nextOpts.power ?? 0;

      idName.textContent = sim.name;
      idMeta.textContent = `${sim.role} · home: ${sim.homePoiId ?? '—'}`;

      renderPortrait(portrait, sim, nextOpts.portraitSheet ?? null);

      replaceChildren(needsHost, true,
        barRow('safety', sim.needs.safety, NEED_COLORS.safety),
        barRow('prosperity', sim.needs.prosperity, NEED_COLORS.prosperity),
        barRow('community', sim.needs.community, NEED_COLORS.community),
        barRow('meaning', sim.needs.meaning, NEED_COLORS.meaning),
      );

      const hintEl = document.createElement('div');
      hintEl.className = 'sg-status-hint';
      hintEl.textContent = npcStatusHint(sim.beliefs['player'], sim.needs, sim.activity);
      replaceChildren(faithHost, true,
        hintEl,
        barRow('faith', belief.faith, FAITH_COLORS.faith),
        barRow('understanding', belief.understanding, FAITH_COLORS.understanding),
        barRow('devotion', belief.devotion, FAITH_COLORS.devotion),
      );

      const pinned = nextOpts.pinned === true;
      pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
      pin.title = pinned ? 'Unpin card' : 'Pin card open';

      backfillBtn.disabled = power < 1;
      dreamBtn.disabled = power < DREAM_COST;
      const isPraying = sim.activity === 'worship';
      prayBtn.disabled = power < ANSWER_PRAYER_COST || !isPraying;
      prayBtn.title = isPraying ? 'NPC is praying' : 'NPC must be praying';
      const hasHome = !!sim.homePoiId;
      omenBtn.style.display = hasHome ? '' : 'none';
      miracleBtn.style.display = hasHome ? '' : 'none';
      omenBtn.disabled = power < OMEN_COST;
      miracleBtn.disabled = power < MIRACLE_COST;

      whisperInput.setSendEnabled(power >= WHISPER_COST);
    },

    setNpc(npcId) {
      if (npcId === currentNpcId) return;
      currentNpcId = npcId;
      // Selecting an NPC (incl. gold-link cross-nav) opens their mind surface.
      mindPath = ['surface'];
      mindLoadedFor = null;
      whisperInput.setNpc(npcId);
      ensureMindLoaded();
    },

    showMindPage(path, page) {
      mindPath = path;
      mindLoadedFor = currentNpcId ? mindKeyFor(currentNpcId, path) : pathKeyLocal(path);
      mindMode.showPage(path, page);
    },

    destroy() {
      whisperInput.destroy();
      mindMode.destroy();
      while (panel.firstChild) panel.removeChild(panel.firstChild);
    },
  };
}
