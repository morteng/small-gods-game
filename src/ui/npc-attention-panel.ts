import type { NpcSimState } from '@/core/types';
import { npcStatusHint } from '@/sim/believers';

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
}

export interface NpcAttentionPanelDeps {
  // Slice 2/3 add store + emit hooks here.
}

export interface NpcAttentionPanelHandle {
  update(sim: NpcSimState, opts?: NpcAttentionPanelOptions): void;
  setNpc(npcId: string): void;
  getActiveMode(): AttentionMode;
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

function actionBtn(key: string, label: string, costLabel: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'sg-action'; b.type = 'button';
  b.dataset.sgAction = key;
  b.innerHTML = `${label}<span class="sg-action-cost">${costLabel}</span>`;
  return b;
}

export function mountNpcAttentionPanel(
  panel: HTMLElement,
  _deps: NpcAttentionPanelDeps,
): NpcAttentionPanelHandle {
  let activeMode: AttentionMode = 'whisper';
  let currentNpcId: string | null = null;

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

  const modes = document.createElement('div'); modes.className = 'sg-modes';
  const whisperTab = document.createElement('button');
  whisperTab.className = 'sg-mode'; whisperTab.type = 'button'; whisperTab.dataset.sgMode = 'whisper';
  whisperTab.textContent = '🗣️ Whisper';
  const mindTab = document.createElement('button');
  mindTab.className = 'sg-mode'; mindTab.type = 'button'; mindTab.dataset.sgMode = 'mind';
  mindTab.textContent = '🧠 Mind';
  modes.append(whisperTab, mindTab);

  const whisperBody = document.createElement('div');
  whisperBody.className = 'sg-body'; whisperBody.dataset.sgBody = 'whisper';
  const whisperPlaceholder = document.createElement('div');
  whisperPlaceholder.className = 'sg-body-placeholder';
  whisperPlaceholder.textContent = 'Whisper thread — coming in slice 2.';
  whisperBody.appendChild(whisperPlaceholder);

  const mindBody = document.createElement('div');
  mindBody.className = 'sg-body'; mindBody.dataset.sgBody = 'mind'; mindBody.style.display = 'none';
  const mindPlaceholder = document.createElement('div');
  mindPlaceholder.className = 'sg-body-placeholder';
  mindPlaceholder.textContent = 'Mind wiki — coming in slice 3.';
  mindBody.appendChild(mindPlaceholder);

  const actions = document.createElement('div'); actions.className = 'sg-actions';
  const backfillBtn = actionBtn('backfill', '💭 Backfill', 'LLM');
  const whisperBtn = actionBtn('whisper', '💬 Whisper', `${WHISPER_COST}p`);
  const dreamBtn = actionBtn('dream', '🌙 Dream', `${DREAM_COST}p`);
  const prayBtn = actionBtn('answer', '🙏 Answer', `${ANSWER_PRAYER_COST}p`);
  const omenBtn = actionBtn('omen', '⛈ Omen', `${OMEN_COST}p`);
  const miracleBtn = actionBtn('miracle', '✨ Miracle', `${MIRACLE_COST}p`);
  actions.append(backfillBtn, whisperBtn, dreamBtn, prayBtn, omenBtn, miracleBtn);

  panel.append(header, idSection, needsHost, faithHost, modes, whisperBody, mindBody, actions);

  function applyMode(): void {
    whisperTab.setAttribute('aria-selected', activeMode === 'whisper' ? 'true' : 'false');
    mindTab.setAttribute('aria-selected', activeMode === 'mind' ? 'true' : 'false');
    whisperBody.style.display = activeMode === 'whisper' ? 'block' : 'none';
    mindBody.style.display = activeMode === 'mind' ? 'block' : 'none';
    actions.style.display = activeMode === 'whisper' ? 'flex' : 'none';
  }
  whisperTab.addEventListener('click', (e) => { e.stopPropagation(); activeMode = 'whisper'; applyMode(); });
  mindTab.addEventListener('click', (e) => { e.stopPropagation(); activeMode = 'mind'; applyMode(); });
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
      whisperBtn.disabled = power < WHISPER_COST || ((sim as unknown as { whisperCooldown?: number }).whisperCooldown ?? 0) > 0;
      dreamBtn.disabled = power < DREAM_COST;
      const isPraying = sim.activity === 'worship';
      prayBtn.disabled = power < ANSWER_PRAYER_COST || !isPraying;
      prayBtn.title = isPraying ? 'NPC is praying' : 'NPC must be praying';
      const hasHome = !!sim.homePoiId;
      omenBtn.style.display = hasHome ? '' : 'none';
      miracleBtn.style.display = hasHome ? '' : 'none';
      omenBtn.disabled = power < OMEN_COST;
      miracleBtn.disabled = power < MIRACLE_COST;
    },

    setNpc(npcId) {
      if (npcId === currentNpcId) return;
      currentNpcId = npcId;
      activeMode = 'whisper';
      applyMode();
    },

    getActiveMode() { return activeMode; },

    destroy() {
      while (panel.firstChild) panel.removeChild(panel.firstChild);
    },
  };
}
