// src/studio/zoo-studio.ts
//
// Studio "Zoo" workspace (?studio=zoo): the NPC counterpart to the asset Gallery.
// NPCs are LPC (Liberated Pixel Cup) sprite sheets, not composeStructure geometry,
// so this is a sibling of the Gallery with an LPC cell adapter. Two modes share one
// grid:
//   • SHEET (default) — a menagerie: every role × a few seeds, each a LIVING
//     thumbnail (walk cycle, facing the viewer). Click one to inspect it.
//   • MATRIX — pick a role + seed → that character across every action (rows) and
//     facing (cols): walk / spellcast / thrust / slash / shoot / hurt × 4 dirs.
//
// Thumbnails reuse the live renderer's exact path: buildCharacterSpec(role, seed) →
// getOrGenerateSheet (async, globally cached by spec hash) → blit one 64px frame.
// A single shared rAF advances every ready cell's animation, so the zoo breathes.
// Baking is lazy (IntersectionObserver) + concurrency-capped.

import { buildCharacterSpec, getOrGenerateSheet } from '@/render/lpc';
import { LPC_ANIMATIONS, LPC_DIR_OFFSET, type NpcAnimation } from '@/core/npc-animation';
import type { NpcRole, Direction } from '@/core/types';
import { injectStudioTheme, COLORS, h } from './theme';

export interface StudioHandle { dispose(): void; }
export interface ZooStudioOpts {
  /** Reserved for symmetry with the Gallery; NPCs have no object-editor handoff. */
  onEdit?: (kind: string) => void;
}

const ROLES: NpcRole[] = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'];
const ACTIONS: NpcAnimation[] = ['walk', 'spellcast', 'thrust', 'slash', 'shoot', 'hurt'];
const DIRS: Direction[] = ['down', 'left', 'up', 'right'];
const DIR_ARROW: Record<Direction, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const FRAME = 64;

/** Source rect for an LPC (action, direction, animation column). */
function srcRect(anim: NpcAnimation, dir: Direction, col: number): { sx: number; sy: number } {
  const spec = LPC_ANIMATIONS[anim] ?? LPC_ANIMATIONS.walk;
  const dirOff = spec.directional ? (LPC_DIR_OFFSET[dir] ?? 0) : 0;
  const c = Math.min(Math.max(col, spec.firstCol), spec.lastCol);
  return { sx: c * FRAME, sy: (spec.rowBase + dirOff) * FRAME };
}

export function mountZooStudio(container: HTMLElement, _opts: ZooStudioOpts = {}): StudioHandle {
  let disposed = false;
  injectStudioTheme(container);
  container.style.position = 'relative';
  container.style.background = COLORS.bg0;

  const root = h('div', { style: 'position:absolute;inset:0;display:flex;flex-direction:row;overflow:hidden' });
  const panel = h('div', { class: 'sg-panel', style: 'flex:0 0 auto;width:240px;border-right:1px solid var(--line);overflow:auto;padding:9px 10px;font:400 11px/1.4 var(--font-mono);color:var(--ink-0)' });
  const grid = h('div', { style: 'flex:1 1 auto;min-width:0;overflow:auto;padding:14px;align-content:flex-start;display:flex;flex-wrap:wrap;gap:12px' });
  root.append(panel, grid);
  container.appendChild(root);

  const state = { role: '' as NpcRole | '', seed: 0, variants: 4, animate: true };

  // ── animated cells: one shared rAF advances every ready cell ────────────────
  interface Live { cv: HTMLCanvasElement; sheet: HTMLCanvasElement; anim: NpcAnimation; dir: Direction; }
  let live: Live[] = [];
  let frame = 0;
  let acc = 0;
  let last = -1;
  let raf = 0;
  const STEP_MS = 130;   // ~7.7 fps animation cadence
  function tick(now: number): void {
    if (disposed) return;
    if (last < 0) last = now;
    acc += now - last; last = now;
    if (acc >= STEP_MS) {
      acc = 0;
      if (state.animate) { frame++; for (const c of live) drawFrame(c); }
    }
    raf = requestAnimationFrame(tick);
  }

  function drawFrame(c: Live): void {
    const g = c.cv.getContext('2d'); if (!g) return;
    const spec = LPC_ANIMATIONS[c.anim] ?? LPC_ANIMATIONS.walk;
    const span = Math.max(1, spec.lastCol - spec.firstCol + 1);
    const col = spec.firstCol + (frame % span);
    const { sx, sy } = srcRect(c.anim, c.dir, col);
    g.clearRect(0, 0, c.cv.width, c.cv.height);
    g.imageSmoothingEnabled = false;
    const s = 2;   // 64 → 128 backing, pixel-doubled
    const dw = FRAME * s, dh = FRAME * s;
    g.drawImage(c.sheet, sx, sy, FRAME, FRAME, Math.round((c.cv.width - dw) / 2), Math.round(c.cv.height - dh - 6), dw, dh);
  }
  function drawNote(cv: HTMLCanvasElement, note: string, colour: string): void {
    const g = cv.getContext('2d'); if (!g) return;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = colour; g.font = '12px ui-monospace, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(note, cv.width / 2, cv.height / 2);
  }

  // ── lazy bake: concurrency-capped sheet generation on scroll-in ─────────────
  const cellRun = new WeakMap<Element, () => void>();
  let io: IntersectionObserver | null = null;
  let active = 0;
  const jobs: (() => Promise<void>)[] = [];
  function pump(): void {
    while (active < 3 && jobs.length) {
      const job = jobs.shift()!;
      active++;
      void job().finally(() => { active--; pump(); });
    }
  }

  function makeCell(role: NpcRole, seed: number, label: string, anim: NpcAnimation, dir: Direction): HTMLElement {
    const cell = h('div', {
      style: 'flex:0 0 auto;width:104px;cursor:pointer;border:1px solid var(--line);border-radius:8px;'
        + 'background:linear-gradient(180deg,#141a16,#0c100c);overflow:hidden;transition:border-color .12s',
      on: {
        click: () => { state.role = role; state.seed = seed; syncControls(); renderGrid(); },
        mouseenter: () => { cell.style.borderColor = 'rgba(120,210,140,.5)'; },
        mouseleave: () => { cell.style.borderColor = 'var(--line)'; },
      },
    });
    const cv = document.createElement('canvas');
    cv.width = 192; cv.height = 168;
    cv.style.cssText = 'display:block;width:104px;height:91px;image-rendering:pixelated';
    drawNote(cv, '…', '#5b6878');
    const cap = h('div', {
      style: 'padding:5px 7px;border-top:1px solid var(--line);font:600 10px/1.25 var(--font-mono);'
        + 'color:var(--ink-0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
      text: label,
    });
    cell.append(cv, cap);

    let started = false;
    cellRun.set(cell, () => {
      if (started || disposed) return; started = true;
      jobs.push(async () => {
        if (disposed) return;
        const sheet = await getOrGenerateSheet(buildCharacterSpec(role, seed)).catch(() => null);
        if (disposed) return;
        if (!sheet) { drawNote(cv, '✕ no sheet', '#c2603a'); return; }
        const entry: Live = { cv, sheet, anim, dir };
        live.push(entry);
        drawFrame(entry);   // immediate first frame; rAF animates thereafter
      });
      pump();
    });
    io?.observe(cell);
    return cell;
  }

  function renderGrid(): void {
    io?.disconnect();
    io = new IntersectionObserver((obs) => {
      for (const o of obs) if (o.isIntersecting) cellRun.get(o.target)?.();
    }, { root: grid, rootMargin: '300px' });
    live = [];
    grid.replaceChildren();

    if (state.role) {
      // MATRIX: one character across actions × facings.
      for (const anim of ACTIONS) {
        const spec = LPC_ANIMATIONS[anim];
        const dirs = spec.directional ? DIRS : (['down'] as Direction[]);
        for (const dir of dirs) {
          const label = spec.directional ? `${anim} ${DIR_ARROW[dir]}` : anim;
          grid.appendChild(makeCell(state.role, state.seed, label, anim, dir));
        }
      }
      return;
    }
    // SHEET: the menagerie — every role × a few seeds, walking toward you.
    for (const role of ROLES) {
      for (let i = 0; i < state.variants; i++) {
        grid.appendChild(makeCell(role, i, `${role} #${i}`, 'walk', 'down'));
      }
    }
  }

  // ── left controls ───────────────────────────────────────────────────────────
  panel.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin-bottom:7px', text: 'Zoo' }));

  const subjectSel = h('select', { class: 'sg-select', style: 'width:100%;margin-bottom:7px' }) as HTMLSelectElement;
  subjectSel.appendChild(h('option', { text: '(all roles — menagerie)', attrs: { value: '' } }));
  for (const r of ROLES) subjectSel.appendChild(h('option', { text: r, attrs: { value: r } }));
  subjectSel.onchange = () => { state.role = (subjectSel.value || '') as NpcRole | ''; renderGrid(); syncControls(); };
  panel.appendChild(subjectSel);

  // Seed picker (matrix mode) — re-rolls the character's appearance.
  const seedRow = h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' });
  const seedLbl = h('span', { class: 'sg-accent', style: 'min-width:54px', text: 'seed 0' });
  const seedSlider = h('input', { class: 'sg-range', style: 'flex:1', attrs: { type: 'range', min: '0', max: '7', step: '1', value: '0' } }) as HTMLInputElement;
  seedSlider.oninput = () => { state.seed = +seedSlider.value; seedLbl.textContent = `seed ${state.seed}`; renderGrid(); };
  seedRow.append(seedLbl, seedSlider);
  panel.appendChild(seedRow);

  // Variants-per-role (sheet mode).
  const varRow = h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' });
  const varLbl = h('span', { class: 'sg-accent', style: 'min-width:54px', text: '4 / role' });
  const varSlider = h('input', { class: 'sg-range', style: 'flex:1', attrs: { type: 'range', min: '1', max: '6', step: '1', value: '4' } }) as HTMLInputElement;
  varSlider.oninput = () => { state.variants = +varSlider.value; varLbl.textContent = `${state.variants} / role`; renderGrid(); };
  varRow.append(varLbl, varSlider);
  panel.appendChild(varRow);

  // Animate toggle.
  const animBtn = h('button', { class: 'sg-btn', style: 'width:100%;margin-top:4px', text: '▶ Animate' });
  animBtn.classList.add('is-on');
  animBtn.onclick = () => {
    state.animate = !state.animate;
    animBtn.classList.toggle('is-on', state.animate);
    animBtn.textContent = state.animate ? '▶ Animate' : '⏸ Paused';
    if (!state.animate) for (const c of live) drawFrame(c);   // settle on current frame
  };
  panel.appendChild(animBtn);

  function syncControls(): void {
    subjectSel.value = state.role;
    seedRow.style.display = state.role ? 'flex' : 'none';
    varRow.style.display = state.role ? 'none' : 'flex';
  }

  syncControls();
  renderGrid();
  raf = requestAnimationFrame(tick);

  return {
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(raf);
      io?.disconnect();
      jobs.length = 0;
      live = [];
    },
  };
}
