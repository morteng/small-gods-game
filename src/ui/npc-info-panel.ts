import type { NpcSimState } from '@/core/types';

const NEED_COLORS = {
  safety: '#4CAF50',
  prosperity: '#FFC107',
  community: '#42A5F5',
  meaning: '#CE93D8',
} as const;

const FAITH_COLORS = {
  faith: '#FFD54F',
  understanding: '#42A5F5',
  devotion: '#FF8A65',
} as const;

const STYLE = `
.sg-header { display: flex; justify-content: flex-end; margin: -4px -4px 4px 0; }
.sg-pin { all: unset; cursor: pointer; pointer-events: auto; padding: 2px 6px; border-radius: 3px; color: rgba(255,255,255,0.5); font: 12px sans-serif; }
.sg-pin:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85); }
.sg-pin[aria-pressed="true"] { color: #FFD54F; background: rgba(255,213,79,0.12); }
.sg-section { margin-bottom: 8px; }
.sg-section:last-child { margin-bottom: 0; }
.sg-section-title { font-size: 9px; letter-spacing: 1px; color: rgba(255,255,255,0.45); margin-bottom: 4px; text-transform: uppercase; }
.sg-id-name { font: bold 13px sans-serif; color: #fff; }
.sg-id-meta { font-size: 10px; color: rgba(255,255,255,0.55); margin-top: 2px; }
.sg-row { display: flex; align-items: center; font: 10px sans-serif; color: rgba(255,255,255,0.85); margin-bottom: 2px; }
.sg-row-label { flex: 0 0 78px; color: rgba(255,255,255,0.7); }
.sg-row-num { flex: 0 0 32px; text-align: right; color: rgba(255,255,255,0.55); font-variant-numeric: tabular-nums; }
.sg-track { flex: 1 1 auto; height: 6px; background: rgba(255,255,255,0.12); border-radius: 3px; overflow: hidden; margin: 0 6px; }
.sg-fill { height: 100%; }
.sg-actions { display: flex; gap: 4px; margin-top: 6px; }
.sg-action { all: unset; cursor: pointer; pointer-events: auto; padding: 3px 8px; border-radius: 3px;
  font: bold 10px sans-serif; letter-spacing: 0.5px; text-transform: uppercase;
  background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7);
  transition: background 0.1s, color 0.1s; }
.sg-action:hover { background: rgba(255,255,255,0.18); color: #fff; }
.sg-action:disabled { opacity: 0.3; cursor: default; }
.sg-action-cost { color: #FFD54F; font-weight: normal; margin-left: 2px; }
`;

const WHISPER_COST = 1;
const DREAM_COST = 4;
const ANSWER_PRAYER_COST = 2;
const OMEN_COST = 3;
const MIRACLE_COST = 10;

export interface NpcInfoPanelOptions {
  pinned?: boolean;
  power?: number;
  onTogglePin?: () => void;
  onWhisper?: () => void;
  onDream?: () => void;
  onAnswerPrayer?: () => void;
  onOmen?: () => void;
  onMiracle?: () => void;
  onLlmBackfill?: () => void;  // New: trigger LLM narration
}

function makeBarRow(label: string, value: number, color: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'sg-row';

  const l = document.createElement('div');
  l.className = 'sg-row-label';
  l.textContent = label;

  const track = document.createElement('div');
  track.className = 'sg-track';
  const fill = document.createElement('div');
  fill.className = 'sg-fill';
  const pct = Math.max(0, Math.min(1, value)) * 100;
  fill.style.width = `${pct.toFixed(0)}%`;
  fill.style.background = color;
  track.appendChild(fill);

  const num = document.createElement('div');
  num.className = 'sg-row-num';
  num.textContent = value.toFixed(2);

  row.append(l, track, num);
  return row;
}

function makeSection(title: string, ...children: HTMLElement[]): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'sg-section';
  const t = document.createElement('div');
  t.className = 'sg-section-title';
  t.textContent = title;
  sec.append(t, ...children);
  return sec;
}

export function renderNpcInfoPanel(
  panel: HTMLElement,
  sim: NpcSimState,
  opts: NpcInfoPanelOptions = {},
): void {
  const belief = sim.beliefs['player'] ?? { faith: 0, understanding: 0, devotion: 0 };
  const home = sim.homePoiId ?? '—';
  const power = opts.power ?? 0;
  const isPraying = sim.activity === 'worship';

  while (panel.firstChild) panel.removeChild(panel.firstChild);

  const style = document.createElement('style');
  style.textContent = STYLE;
  panel.appendChild(style);

  const header = document.createElement('div');
  header.className = 'sg-header';
  const pin = document.createElement('button');
  pin.className = 'sg-pin';
  pin.dataset.sg = 'pin';
  pin.type = 'button';
  pin.textContent = '📌';
  const pinned = opts.pinned === true;
  pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
  pin.title = pinned ? 'Unpin card' : 'Pin card open';
  if (opts.onTogglePin) {
    pin.addEventListener('click', (ev) => {
      ev.stopPropagation();
      opts.onTogglePin!();
    });
  }
  header.appendChild(pin);
  panel.appendChild(header);

  const idName = document.createElement('div');
  idName.className = 'sg-id-name';
  idName.textContent = sim.name;
  const idMeta = document.createElement('div');
  idMeta.className = 'sg-id-meta';
  idMeta.textContent = `${sim.role} · home: ${home}`;
  panel.appendChild(makeSection('identity', idName, idMeta));

  panel.appendChild(makeSection(
    'needs',
    makeBarRow('safety',     sim.needs.safety,     NEED_COLORS.safety),
    makeBarRow('prosperity', sim.needs.prosperity, NEED_COLORS.prosperity),
    makeBarRow('community',  sim.needs.community,  NEED_COLORS.community),
    makeBarRow('meaning',    sim.needs.meaning,    NEED_COLORS.meaning),
  ));

  panel.appendChild(makeSection(
    'faith in you',
    makeBarRow('faith',         belief.faith,         FAITH_COLORS.faith),
    makeBarRow('understanding', belief.understanding, FAITH_COLORS.understanding),
    makeBarRow('devotion',      belief.devotion,      FAITH_COLORS.devotion),
  ));

  // Divine action buttons
  const actions = document.createElement('div');
  actions.className = 'sg-actions';

  // LLM Backfill button (generates narration)
  const backfillBtn = document.createElement('button');
  backfillBtn.className = 'sg-action';
  backfillBtn.type = 'button';
  backfillBtn.innerHTML = `💭 Backfill<span class="sg-action-cost">LLM</span>`;
  backfillBtn.disabled = power < 1; // Costs 1 power (same as whisper)
  backfillBtn.addEventListener('click', (ev) => { ev.stopPropagation(); opts.onLlmBackfill?.(); });
  actions.appendChild(backfillBtn);

  const whisperBtn = document.createElement('button');
  whisperBtn.className = 'sg-action';
  whisperBtn.type = 'button';
  whisperBtn.innerHTML = `💬 Whisper<span class="sg-action-cost">${WHISPER_COST}p</span>`;
  whisperBtn.disabled = power < WHISPER_COST || (sim as any).whisperCooldown > 0;
  whisperBtn.addEventListener('click', (ev) => { ev.stopPropagation(); opts.onWhisper?.(); });
  actions.appendChild(whisperBtn);

  const dreamBtn = document.createElement('button');
  dreamBtn.className = 'sg-action';
  dreamBtn.type = 'button';
  dreamBtn.innerHTML = `🌙 Dream<span class="sg-action-cost">${DREAM_COST}p</span>`;
  dreamBtn.disabled = power < DREAM_COST;
  dreamBtn.addEventListener('click', (ev) => { ev.stopPropagation(); opts.onDream?.(); });
  actions.appendChild(dreamBtn);

  const prayBtn = document.createElement('button');
  prayBtn.className = 'sg-action';
  prayBtn.type = 'button';
  prayBtn.innerHTML = `🙏 Answer<span class="sg-action-cost">${ANSWER_PRAYER_COST}p</span>`;
  prayBtn.disabled = power < ANSWER_PRAYER_COST || !isPraying;
  prayBtn.title = isPraying ? 'NPC is praying' : 'NPC must be praying';
  prayBtn.addEventListener('click', (ev) => { ev.stopPropagation(); opts.onAnswerPrayer?.(); });
  actions.appendChild(prayBtn);

  // Omen & Miracle target the NPC's home POI
  if (sim.homePoiId) {
    const omenBtn = document.createElement('button');
    omenBtn.className = 'sg-action';
    omenBtn.type = 'button';
    omenBtn.innerHTML = `⛈ Omen<span class="sg-action-cost">${OMEN_COST}p</span>`;
    omenBtn.disabled = power < OMEN_COST;
    omenBtn.addEventListener('click', (ev) => { ev.stopPropagation(); opts.onOmen?.(); });
    actions.appendChild(omenBtn);

    const miracleBtn = document.createElement('button');
    miracleBtn.className = 'sg-action';
    miracleBtn.type = 'button';
    miracleBtn.innerHTML = `✨ Miracle<span class="sg-action-cost">${MIRACLE_COST}p</span>`;
    miracleBtn.disabled = power < MIRACLE_COST;
    miracleBtn.addEventListener('click', (ev) => { ev.stopPropagation(); opts.onMiracle?.(); });
    actions.appendChild(miracleBtn);
  }

  panel.appendChild(actions);
}
