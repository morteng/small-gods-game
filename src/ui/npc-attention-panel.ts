import type { NpcSimState } from '@/core/types';
import { npcStatusHint } from '@/sim/believers';
import { mountWhisperMode, type WhisperModeHandle } from '@/ui/npc-whisper-mode';
import { mountMindMode, type MindModeHandle } from '@/ui/npc-mind-mode';
import { mindProbeCost } from '@/sim/mind-probe';
import type { NpcAttentionStore, MindPage } from '@/llm/npc-attention-store';

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
.sg-header { display: flex; justify-content: flex-end; margin: -4px -4px 4px 0; }
.sg-pin { all: unset; cursor: pointer; pointer-events: auto; padding: 2px 6px; border-radius: 3px; color: rgba(255,255,255,0.5); font: 12px sans-serif; }
.sg-pin:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85); }
.sg-pin[aria-pressed="true"] { color: #FFD54F; background: rgba(255,213,79,0.12); }
.sg-section { margin-bottom: 8px; }
.sg-section-title { font-size: 9px; letter-spacing: 1px; color: rgba(255,255,255,0.45); margin-bottom: 4px; text-transform: uppercase; }
.sg-id-name { font: bold 13px sans-serif; color: #fff; }
.sg-id-meta { font-size: 10px; color: rgba(255,255,255,0.55); margin-top: 2px; }
.sg-row { display: flex; align-items: center; font: 10px sans-serif; color: rgba(255,255,255,0.85); margin-bottom: 2px; }
.sg-row-label { flex: 0 0 78px; color: rgba(255,255,255,0.7); }
.sg-row-num { flex: 0 0 32px; text-align: right; color: rgba(255,255,255,0.55); font-variant-numeric: tabular-nums; }
.sg-track { flex: 1 1 auto; height: 6px; background: rgba(255,255,255,0.12); border-radius: 3px; overflow: hidden; margin: 0 6px; }
.sg-fill { height: 100%; }
.sg-status-hint { font: italic 10px sans-serif; color: rgba(255,213,79,0.85); margin-bottom: 4px; }
.sg-top { display: flex; gap: 10px; align-items: flex-start; }
.sg-portrait { flex: 0 0 56px; width: 56px; height: 56px; border-radius: 8px; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center; font: bold 26px sans-serif; color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.22); }
.sg-top-col { flex: 1 1 auto; min-width: 0; }
.sg-modes { display: flex; gap: 4px; margin: 6px 0; }
.sg-mode { all: unset; cursor: pointer; pointer-events: auto; flex: 1 1 auto; text-align: center; padding: 4px 0; border-radius: 4px;
  font: bold 10px sans-serif; letter-spacing: 0.5px; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6); }
.sg-mode[aria-selected="true"] { background: rgba(255,213,79,0.15); color: #FFD54F; }
.sg-body { min-height: 40px; }
.sg-body-placeholder { font: italic 10px sans-serif; color: rgba(255,255,255,0.4); padding: 8px 0; }
.sg-actions { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.sg-action { all: unset; cursor: pointer; pointer-events: auto; padding: 3px 8px; border-radius: 3px;
  font: bold 10px sans-serif; letter-spacing: 0.5px; text-transform: uppercase;
  background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }
.sg-action:hover { background: rgba(255,255,255,0.18); color: #fff; }
.sg-action:disabled { opacity: 0.3; cursor: default; }
.sg-action-cost { color: #FFD54F; font-weight: normal; margin-left: 2px; }
`;

export type AttentionMode = 'whisper' | 'mind';

export interface NpcAttentionPanelOptions {
  pinned?: boolean;
  power?: number;
  onTogglePin?: () => void;
  onWhisper?: () => void;
  onDream?: () => void;
  onAnswerPrayer?: () => void;
  onOmen?: () => void;
  onMiracle?: () => void;
  onLlmBackfill?: () => void;
  /** The selected NPC's LPC sprite sheet; the portrait draws its down-idle frame. Null → avatar fallback. */
  portraitSheet?: HTMLCanvasElement | null;
}

export interface NpcAttentionPanelDeps {
  store: NpcAttentionStore;
  onWhisperSend(npcId: string, text: string): void;
  onMindOpen(npcId: string, path: string[], depth: number): void;
  onMindCrossNav(entityId: string): void;
}

export interface NpcAttentionPanelHandle {
  update(sim: NpcSimState, opts?: NpcAttentionPanelOptions): void;
  setNpc(npcId: string): void;
  getActiveMode(): AttentionMode;
  refreshWhisper(): void;
  refreshWhisperLast(): void;
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
const PORTRAIT_PX = 56;

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
  let activeMode: AttentionMode = 'mind'; // reading a mind is the primary, default view
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

  const modes = document.createElement('div'); modes.className = 'sg-modes';
  const whisperTab = document.createElement('button');
  whisperTab.className = 'sg-mode'; whisperTab.type = 'button'; whisperTab.dataset.sgMode = 'whisper';
  whisperTab.textContent = '🗣️ Whisper';
  const mindTab = document.createElement('button');
  mindTab.className = 'sg-mode'; mindTab.type = 'button'; mindTab.dataset.sgMode = 'mind';
  mindTab.textContent = '🧠 Mind';
  modes.append(mindTab, whisperTab); // Mind first — reading is the primary action

  const whisperBody = document.createElement('div');
  whisperBody.className = 'sg-body'; whisperBody.dataset.sgBody = 'whisper';
  const whisperMode = mountWhisperMode(whisperBody, {
    store: deps.store,
    onSend: (text) => { if (currentNpcId) deps.onWhisperSend(currentNpcId, text); },
  });

  const mindBody = document.createElement('div');
  mindBody.className = 'sg-body'; mindBody.dataset.sgBody = 'mind'; mindBody.style.display = 'none';
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

  const actions = document.createElement('div'); actions.className = 'sg-actions';
  const backfillBtn = actionBtn('backfill', '💭 Backfill', 'LLM');
  const whisperBtn = actionBtn('whisper', '💬 Whisper', `${WHISPER_COST}p`);
  const dreamBtn = actionBtn('dream', '🌙 Dream', `${DREAM_COST}p`);
  const prayBtn = actionBtn('answer', '🙏 Answer', `${ANSWER_PRAYER_COST}p`);
  const omenBtn = actionBtn('omen', '⛈ Omen', `${OMEN_COST}p`);
  const miracleBtn = actionBtn('miracle', '✨ Miracle', `${MIRACLE_COST}p`);
  actions.append(backfillBtn, whisperBtn, dreamBtn, prayBtn, omenBtn, miracleBtn);

  panel.append(header, topRow, modes, whisperBody, mindBody, actions);

  function applyMode(): void {
    whisperTab.setAttribute('aria-selected', activeMode === 'whisper' ? 'true' : 'false');
    mindTab.setAttribute('aria-selected', activeMode === 'mind' ? 'true' : 'false');
    whisperBody.style.display = activeMode === 'whisper' ? 'block' : 'none';
    mindBody.style.display = activeMode === 'mind' ? 'block' : 'none';
    actions.style.display = activeMode === 'whisper' ? 'flex' : 'none';
  }
  // Open the current mind page exactly once per (npc, path) — used when Mind becomes visible.
  function ensureMindLoaded(): void {
    if (currentNpcId && mindLoadedFor !== mindKeyFor(currentNpcId, mindPath)) {
      mindMode.showLoading(mindPath);
      deps.onMindOpen(currentNpcId, mindPath, mindPath.length - 1);
    }
  }
  whisperTab.addEventListener('click', (e) => { e.stopPropagation(); activeMode = 'whisper'; applyMode(); });
  mindTab.addEventListener('click', (e) => {
    e.stopPropagation();
    activeMode = 'mind';
    applyMode();
    ensureMindLoaded();
  });
  applyMode();

  let opts: NpcAttentionPanelOptions = {};
  pin.addEventListener('click', (e) => { e.stopPropagation(); opts.onTogglePin?.(); });
  backfillBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onLlmBackfill?.(); });
  whisperBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onWhisper?.(); });
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
      whisperBtn.disabled = power < WHISPER_COST || (sim.whisperCooldown ?? 0) > 0;
      dreamBtn.disabled = power < DREAM_COST;
      const isPraying = sim.activity === 'worship';
      prayBtn.disabled = power < ANSWER_PRAYER_COST || !isPraying;
      prayBtn.title = isPraying ? 'NPC is praying' : 'NPC must be praying';
      const hasHome = !!sim.homePoiId;
      omenBtn.style.display = hasHome ? '' : 'none';
      miracleBtn.style.display = hasHome ? '' : 'none';
      omenBtn.disabled = power < OMEN_COST;
      miracleBtn.disabled = power < MIRACLE_COST;

      whisperMode.refresh();
      whisperMode.setSendEnabled(power >= 1);
    },

    setNpc(npcId) {
      if (npcId === currentNpcId) return;
      currentNpcId = npcId;
      // Mind is the default view; selecting an NPC (incl. gold-link cross-nav) opens their mind surface.
      activeMode = 'mind';
      mindPath = ['surface'];
      mindLoadedFor = null;
      applyMode();
      whisperMode.setNpc(npcId);
      ensureMindLoaded();
    },

    getActiveMode() { return activeMode; },

    refreshWhisper() { whisperMode.refresh(); },
    refreshWhisperLast() { whisperMode.refreshLast(); },

    showMindPage(path, page) {
      mindPath = path;
      mindLoadedFor = currentNpcId ? mindKeyFor(currentNpcId, path) : pathKeyLocal(path);
      mindMode.showPage(path, page);
    },

    destroy() {
      whisperMode.destroy();
      mindMode.destroy();
      while (panel.firstChild) panel.removeChild(panel.firstChild);
    },
  };
}
