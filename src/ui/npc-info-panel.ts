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
`;

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

export function renderNpcInfoPanel(panel: HTMLElement, sim: NpcSimState): void {
  const belief = sim.beliefs['player'] ?? { faith: 0, understanding: 0, devotion: 0 };
  const home = sim.homePoiId ?? '—';

  while (panel.firstChild) panel.removeChild(panel.firstChild);

  const style = document.createElement('style');
  style.textContent = STYLE;
  panel.appendChild(style);

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
}
