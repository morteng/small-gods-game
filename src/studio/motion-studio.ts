// src/studio/motion-studio.ts
//
// Studio "Motion" workspace (?studio=motion): review bench for the paper-doll
// animation baker (src/render/paperdoll/). Bakes a clip live from the vendored
// LPC layers — per layer, shared FK transforms — and shows it four ways at once:
//   • BIG view: current frame at an integer zoom rung, optional bone overlay
//     (chip rects + pivots transformed by the pose FK).
//   • IN-GAME view: a continuously-looping 32px downscale — the honest
//     "does it read on screen" judgment view.
//   • FILMSTRIP: every baked frame; click to scrub (pauses playback).
//   • END-POSE sliders: live-retune each chip's final angle → instant re-bake
//     (never reload; tuning here is the whole point of the bench).
// Quantize toggle runs frames through the game's Oklab+Bayer palette pass.
//   • GAIT lane: the untouched walk cycle played through a Tier-0 gait style
//     (retiming + whole-sprite offsets, src/render/paperdoll/gait.ts) beside a
//     normal-cadence control. No rebake — this simulates runtime playback.

import { assetUrl } from '@/core/asset-url';
import {
  bakeClip,
  chipWorldTransforms,
  sampleClip,
  applyAffine,
  type AnimTemplate,
  type Clip,
  type PoseLayer,
} from '@/render/paperdoll/rig';
import {
  DEFAULT_HUMANOID_LAYERS,
  donorSheetCandidates,
  HUMANOID_CLIPS,
  HUMANOID_SOURCE,
  LPC_HUMANOID_SOUTH,
} from '@/render/paperdoll/lpc-humanoid';
import { stampAnims } from '@/render/paperdoll/stamp';
import { GAIT_NORMAL, GAIT_STYLES, gaitFrameAt, planGait, type GaitPlan } from '@/render/paperdoll/gait';
import { LPC_ANIMATIONS } from '@/core/npc-animation';
import { FRAME_MS } from '@/render/npc-animator';
import { collectOutlinePalette, collectSourcePalette, reinkOutline, snapToSourcePalette } from '@/render/paperdoll/palette-snap';
import { buildCharacterSpec, type CharacterSpec } from '@/render/lpc/character-builder';
import { walkSpriteCandidates } from '@/render/lpc/lpc-walk-path';
import type { NpcRole } from '@/core/types';
import { decodePngToRaster } from '@/render/sprite-codec';
import { rgbaToCanvas, type SpriteCanvas } from '@/render/iso/sprite-canvas';
import { quantizePaletteOklab, type Raster } from '@/render/sprite-postprocess';
import { injectStudioTheme, COLORS, h } from './theme';

export interface StudioHandle {
  dispose(): void;
}

const TEMPLATE = LPC_HUMANOID_SOUTH;
const CELL = TEMPLATE.cell;
const CLIPS: readonly Clip[] = HUMANOID_CLIPS;
const ZOOMS = [2, 4, 6, 10] as const;
const STEP_MS = 120; // matches ACTION_FRAME_MS cadence
const GAME_PX = 32; // on-screen sprite size at zoom 1
const CHIP_COLORS = [
  '#787878', // trunk
  '#ffdc3c', // head
  '#50b4ff', // armL_up
  '#3c78ff', // armL_fore
  '#ff8250', // armR_up
  '#ff4628', // armR_fore
  '#50dc78', // legL_up
  '#28a050', // legL_fore
  '#c878ff', // legR_up
  '#9640dc', // legR_fore
];

const cloneClip = (c: Clip): Clip => JSON.parse(JSON.stringify(c)) as Clip;

/** Coverage-weighted box downscale to the in-game sprite size. */
function downscale(f: Raster, to: number): Raster {
  const s = f.w / to;
  const out = new Uint8ClampedArray(to * to * 4);
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hit = 0;
      for (let yy = 0; yy < s; yy++) {
        for (let xx = 0; xx < s; xx++) {
          const si = ((y * s + yy) * f.w + (x * s + xx)) * 4;
          if (f.data[si + 3] > 0) {
            r += f.data[si];
            g += f.data[si + 1];
            b += f.data[si + 2];
            hit++;
          }
        }
      }
      if (hit > s * s * 0.35) out.set([r / hit, g / hit, b / hit, 255], (y * to + x) * 4);
    }
  }
  return { data: out, w: to, h: to };
}

/** Alpha-over composite of one 64px cell (col,row) across all layer sheets. */
function compositeCell(sheets: readonly Raster[], col: number, row: number): Raster {
  const data = new Uint8ClampedArray(CELL * CELL * 4);
  for (const sheet of sheets) {
    const sx = col * CELL;
    const sy = row * CELL;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const si = ((sy + y) * sheet.w + sx + x) * 4;
        const a = sheet.data[si + 3];
        if (a === 0) continue;
        const di = (y * CELL + x) * 4;
        const da = data[di + 3];
        if (a === 255 || da === 0) {
          data[di] = sheet.data[si];
          data[di + 1] = sheet.data[si + 1];
          data[di + 2] = sheet.data[si + 2];
          data[di + 3] = a;
        } else {
          const na = a + (da * (255 - a)) / 255;
          for (let c = 0; c < 3; c++) {
            data[di + c] = (sheet.data[si + c] * a + (data[di + c] * da * (255 - a)) / 255) / na;
          }
          data[di + 3] = na;
        }
      }
    }
  }
  return { data, w: CELL, h: CELL };
}

export function mountMotionStudio(container: HTMLElement): StudioHandle {
  let disposed = false;
  injectStudioTheme(container);
  container.style.position = 'relative';
  container.style.background = COLORS.bg0;

  const root = h('div', { style: 'position:absolute;inset:0;display:flex;flex-direction:row;overflow:hidden' });
  const panel = h('div', {
    class: 'sg-panel',
    style: 'flex:0 0 auto;width:260px;border-right:1px solid var(--line);overflow:auto;padding:9px 10px;font:400 11px/1.4 var(--font-mono);color:var(--ink-0)',
  });
  const main = h('div', { style: 'flex:1 1 auto;min-width:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px;align-items:flex-start' });
  root.append(panel, main);
  container.appendChild(root);

  const state = {
    clipIdx: 0,
    frame: 0,
    playing: true,
    zoom: 6 as number,
    quantize: false,
    bones: false,
    skin: false, // contour-aware joint skinning (blend band 3px)
    // Snap to the SOURCE sheets' palette + re-ink the silhouette outline.
    // Default ON: rotated frames otherwise read blurrier than frame 0 (the
    // supersample blend softens edges and erodes the 1px LPC contour).
    snap: true,
  };
  let workClip = cloneClip(CLIPS[0]);
  // Mutable template copy: joint pin mode edits pivots live (rest-space coords).
  const workTemplate: AnimTemplate = JSON.parse(JSON.stringify(TEMPLATE)) as AnimTemplate;
  const pin = { on: false, chip: 3, mirror: true }; // default chip: armL_fore (the hinge that started this)
  const hiddenLayers = new Set<number>(); // indices into DEFAULT_HUMANOID_LAYERS
  const hiddenChips = new Set<string>(); // chip names skipped at paint time

  // L/R chip pairs mirror about the sprite's vertical axis. Pivots are grid
  // POINTS, not pixels: pixel content mirrors as 63-x, but a point mirrors as
  // 64-x (the mirror of column 19's left edge is column 45's left edge).
  const mirrorName = (n: string): string | null =>
    n.includes('L_') ? n.replace('L_', 'R_') : n.includes('R_') ? n.replace('R_', 'L_') : null;
  function setPivot(idx: number, cx: number, cy: number): void {
    workTemplate.chips[idx].pivot = [cx, cy];
    if (pin.mirror) {
      const mn = mirrorName(workTemplate.chips[idx].name);
      const mi = mn === null ? -1 : workTemplate.chips.findIndex((c) => c.name === mn);
      if (mi >= 0) workTemplate.chips[mi].pivot = [CELL - cx, cy];
    }
    updateJointReadout();
  }

  // ── bake state ──────────────────────────────────────────────────────────────
  let layers: PoseLayer[] | null = null;
  let frames: Raster[] = []; // raw baked cell frames (pre-quantize)
  let shownFrames: SpriteCanvas[] = []; // big-view canvases (quantized if toggled)
  let gameFrames: SpriteCanvas[] = []; // 32px downscales for the in-game loop

  function rebake(): void {
    if (!layers) return;
    const visible = layers.filter((_, i) => !hiddenLayers.has(i));
    frames = bakeClip(workTemplate, visible, workClip, {
      hide: hiddenChips,
      skin: state.skin ? { band: 3 } : undefined,
    });
    let display = state.quantize
      ? frames.map((f) => quantizePaletteOklab(f, 32, { dither: 'bayer4' }))
      : frames;
    if (state.snap) {
      const rasters = visible.map((l) => l.raster);
      const palette = collectSourcePalette(rasters);
      const outline = collectOutlinePalette(rasters);
      display = display.map((f) => reinkOutline(snapToSourcePalette(f, palette), outline));
    }
    shownFrames = display.map((f) => rgbaToCanvas(f.data, f.w, f.h)).filter((c): c is SpriteCanvas => c !== null);
    gameFrames = display
      .map((f) => downscale(f, GAME_PX))
      .map((f) => rgbaToCanvas(f.data, f.w, f.h))
      .filter((c): c is SpriteCanvas => c !== null);
    state.frame = Math.min(state.frame, frames.length - 1);
    drawStrip();
    drawBig();
  }

  // ── main area: big view + in-game loop + filmstrip ──────────────────────────
  const bigWrap = h('div', { style: 'display:flex;gap:18px;align-items:flex-end' });
  const bigCv = document.createElement('canvas');
  bigCv.style.cssText = 'display:block;image-rendering:pixelated;border:1px solid var(--line);border-radius:6px';
  // Joint pin mode: grab the nearest pivot cross and drag it (or click empty
  // space to place the sidebar-selected chip's pivot). Screen→cell mapping is
  // rest-space ONLY at the identity pose, so pin mode holds the view on frame 0.
  // Frame 0's rendered image is pivot-independent, so drags only redraw the
  // bones overlay + readout; the full rebake happens once on release.
  let pinDragging = false;
  const cellPos = (ev: MouseEvent): [number, number] => [
    Math.max(0, Math.min(CELL - 1, Math.floor(ev.offsetX / state.zoom))),
    Math.max(0, Math.min(CELL - 1, Math.floor(ev.offsetY / state.zoom))),
  ];
  bigCv.onmousedown = (ev) => {
    if (!pin.on) return;
    ev.preventDefault();
    if (state.frame !== 0) {
      state.frame = 0;
      drawStrip();
    }
    const [cx, cy] = cellPos(ev);
    // Grab the nearest pivot within 6 cell px; otherwise keep the current chip.
    let best = -1;
    let bestD = 36;
    workTemplate.chips.forEach((ch, i) => {
      const d = (ch.pivot[0] - cx) ** 2 + (ch.pivot[1] - cy) ** 2;
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    });
    if (best >= 0) selectPinChip(best);
    pinDragging = true;
    setPivot(pin.chip, cx, cy);
    drawBig();
  };
  bigCv.onmousemove = (ev) => {
    if (!pin.on || !pinDragging) return;
    const [cx, cy] = cellPos(ev);
    setPivot(pin.chip, cx, cy);
    drawBig();
  };
  const endPinDrag = (): void => {
    if (!pinDragging) return;
    pinDragging = false;
    rebake();
  };
  bigCv.onmouseup = endPinDrag;
  bigCv.onmouseleave = endPinDrag;
  const gameCol = h('div', { style: 'display:flex;flex-direction:column;gap:5px;align-items:center' });
  const gameCv = document.createElement('canvas');
  gameCv.width = GAME_PX * 2;
  gameCv.height = GAME_PX * 2;
  gameCv.style.cssText = 'display:block;width:64px;height:64px;image-rendering:pixelated;border:1px solid var(--line);border-radius:6px';
  gameCol.append(gameCv, h('span', { class: 'sg-muted', style: 'font-size:10px', text: 'in-game 32px' }));
  bigWrap.append(bigCv, gameCol);

  const stripCv = document.createElement('canvas');
  stripCv.style.cssText = 'display:block;image-rendering:pixelated;border:1px solid var(--line);border-radius:6px;cursor:pointer';
  const stripNote = h('span', { class: 'sg-muted', style: 'font-size:10px', text: 'filmstrip — click a frame to scrub' });
  main.append(bigWrap, stripCv, stripNote);

  // ── gait lane: the untouched walk cycle under a runtime-style timing warp ──
  const WALK_N = LPC_ANIMATIONS.walk.lastCol - LPC_ANIMATIONS.walk.firstCol + 1;
  const GAIT_ZOOM = 4;
  const walkBig: SpriteCanvas[] = []; // composited walk frames, cell size
  const walkSmall: SpriteCanvas[] = []; // 32px downscales
  let loadedSheets: Raster[] | null = null; // full LPC sheets, for lane recomposites

  /** (Re)composite the gait lane's walk frames, honoring layer visibility. */
  function rebuildWalkLane(): void {
    if (!loadedSheets) return;
    walkBig.length = 0;
    walkSmall.length = 0;
    const use = loadedSheets.filter((_, i) => !hiddenLayers.has(i));
    for (let col = LPC_ANIMATIONS.walk.firstCol; col <= LPC_ANIMATIONS.walk.lastCol; col++) {
      const cellR = compositeCell(use, col, HUMANOID_SOURCE.row);
      const big = rgbaToCanvas(cellR.data, cellR.w, cellR.h);
      const small = downscale(cellR, GAME_PX);
      const smallCv = rgbaToCanvas(small.data, small.w, small.h);
      if (big && smallCv) {
        walkBig.push(big);
        walkSmall.push(smallCv);
      }
    }
  }
  let gaitStyle = GAIT_STYLES[1]; // open on limp so the contrast is instant
  const normalPlan = planGait(GAIT_NORMAL, WALK_N, FRAME_MS);
  let styledPlan = planGait(gaitStyle, WALK_N, FRAME_MS);
  let gaitClock = 0;

  function gaitView(label: string): { col: HTMLElement; big: HTMLCanvasElement; small: HTMLCanvasElement; lbl: HTMLElement } {
    const big = document.createElement('canvas');
    big.width = CELL * GAIT_ZOOM;
    big.height = CELL * GAIT_ZOOM;
    big.style.cssText = 'display:block;image-rendering:pixelated;border:1px solid var(--line);border-radius:6px';
    const small = document.createElement('canvas');
    small.width = GAME_PX * 2;
    small.height = GAME_PX * 2;
    small.style.cssText = 'display:block;width:64px;height:64px;image-rendering:pixelated;border:1px solid var(--line);border-radius:6px';
    const lbl = h('span', { class: 'sg-muted', style: 'font-size:10px', text: label });
    const col = h('div', { style: 'display:flex;flex-direction:column;gap:5px;align-items:center' });
    col.append(big, small, lbl);
    return { col, big, small, lbl };
  }
  const gaitNormalView = gaitView('walk · normal');
  const gaitStyledView = gaitView(`walk · ${gaitStyle.name}`);
  const gaitWrap = h('div', { style: 'display:flex;gap:18px;align-items:flex-start' });
  gaitWrap.append(gaitNormalView.col, gaitStyledView.col);
  main.append(
    h('div', { class: 'sg-eyebrow', style: 'margin-top:6px', text: 'Gait — walk cycle (Tier 0: timing + offsets, no new pixels)' }),
    gaitWrap,
  );

  function drawGaitInto(view: { big: HTMLCanvasElement; small: HTMLCanvasElement }, plan: GaitPlan): void {
    const f = gaitFrameAt(plan, gaitClock);
    const g = view.big.getContext('2d');
    if (g) {
      g.imageSmoothingEnabled = false;
      checker(g, view.big.width, view.big.height, 8 * GAIT_ZOOM);
      const fr = walkBig[f.frame];
      if (fr) g.drawImage(fr as CanvasImageSource, f.dx * GAIT_ZOOM, f.dy * GAIT_ZOOM, CELL * GAIT_ZOOM, CELL * GAIT_ZOOM);
    }
    const gs = view.small.getContext('2d');
    if (gs) {
      gs.imageSmoothingEnabled = false;
      checker(gs, view.small.width, view.small.height, 8);
      const fr = walkSmall[f.frame];
      if (fr) gs.drawImage(fr as CanvasImageSource, f.dx, f.dy, GAME_PX * 2, GAME_PX * 2);
    }
  }
  function drawGait(): void {
    if (walkBig.length === 0) return;
    drawGaitInto(gaitNormalView, normalPlan);
    drawGaitInto(gaitStyledView, styledPlan);
  }

  function checker(g: CanvasRenderingContext2D, w: number, hgt: number, sq: number): void {
    for (let y = 0; y < hgt; y += sq) {
      for (let x = 0; x < w; x += sq) {
        g.fillStyle = ((x / sq + y / sq) & 1) === 0 ? COLORS.checkerA : COLORS.checkerB;
        g.fillRect(x, y, sq, sq);
      }
    }
  }

  function drawBig(): void {
    const z = state.zoom;
    const size = CELL * z;
    if (bigCv.width !== size) {
      bigCv.width = size;
      bigCv.height = size;
    }
    bigCv.style.width = `${size}px`;
    bigCv.style.height = `${size}px`;
    const g = bigCv.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    checker(g, size, size, 8 * z);
    const fr = shownFrames[state.frame];
    if (fr) g.drawImage(fr as CanvasImageSource, 0, 0, size, size);
    if (state.bones) drawBones(g, z);

    const gg = gameCv.getContext('2d');
    if (gg) {
      gg.imageSmoothingEnabled = false;
      checker(gg, gameCv.width, gameCv.height, 8);
      const gf = gameFrames[state.frame];
      if (gf) gg.drawImage(gf as CanvasImageSource, 0, 0, gameCv.width, gameCv.height);
    }
    frameLbl.textContent = `frame ${state.frame + 1}/${workClip.frames}`;
    frameSlider.value = String(state.frame);
  }

  function drawBones(g: CanvasRenderingContext2D, z: number): void {
    const t = workClip.frames <= 1 ? 0 : state.frame / (workClip.frames - 1);
    const world = chipWorldTransforms(workTemplate, sampleClip(workTemplate, workClip, t));
    workTemplate.chips.forEach((ch, i) => {
      const col = CHIP_COLORS[i % CHIP_COLORS.length];
      g.strokeStyle = col;
      g.lineWidth = 1.5;
      if (i > 0) {
        const { x, y, w, h: rh } = ch.rect;
        const corners = (
          [
            [x, y],
            [x + w, y],
            [x + w, y + rh],
            [x, y + rh],
          ] as const
        ).map(([cx, cy]) => applyAffine(world[i], cx, cy));
        g.beginPath();
        corners.forEach(([px, py], k) => (k === 0 ? g.moveTo(px * z, py * z) : g.lineTo(px * z, py * z)));
        g.closePath();
        g.stroke();
      }
      const [px, py] = applyAffine(world[i], ch.pivot[0], ch.pivot[1]);
      g.beginPath();
      g.moveTo(px * z - 4, py * z);
      g.lineTo(px * z + 4, py * z);
      g.moveTo(px * z, py * z - 4);
      g.lineTo(px * z, py * z + 4);
      g.stroke();
    });
  }

  const STRIP_SCALE = 2;
  function drawStrip(): void {
    const n = workClip.frames;
    const cw = CELL * STRIP_SCALE;
    const gap = 4;
    stripCv.width = n * cw + (n + 1) * gap;
    stripCv.height = cw + gap * 2;
    const g = stripCv.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    g.fillStyle = COLORS.bg1;
    g.fillRect(0, 0, stripCv.width, stripCv.height);
    shownFrames.forEach((fr, i) => {
      const x = gap + i * (cw + gap);
      g.save();
      g.translate(x, gap);
      checker(g, cw, cw, 8 * STRIP_SCALE);
      g.drawImage(fr as CanvasImageSource, 0, 0, cw, cw);
      g.restore();
      if (i === state.frame) {
        g.strokeStyle = COLORS.accent;
        g.lineWidth = 2;
        g.strokeRect(x - 1, gap - 1, cw + 2, cw + 2);
      }
    });
  }
  stripCv.onclick = (ev) => {
    const rect = stripCv.getBoundingClientRect();
    const gap = 4;
    const cw = CELL * STRIP_SCALE;
    const i = Math.floor((ev.clientX - rect.left - gap) / (cw + gap));
    if (i >= 0 && i < workClip.frames) {
      state.frame = i;
      setPlaying(false);
      drawStrip();
      drawBig();
    }
  };

  // ── playback loop ───────────────────────────────────────────────────────────
  let raf = 0;
  let acc = 0;
  let last = -1;
  function tick(now: number): void {
    if (disposed) return;
    if (last < 0) last = now;
    const dt = now - last;
    acc += dt;
    last = now;
    if (acc >= STEP_MS && state.playing && frames.length > 0) {
      acc = 0;
      state.frame = (state.frame + 1) % frames.length;
      drawStrip();
      drawBig();
    }
    if (state.playing && walkBig.length > 0) {
      gaitClock += dt;
      drawGait();
    }
    raf = requestAnimationFrame(tick);
  }

  // ── left controls ───────────────────────────────────────────────────────────
  panel.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin-bottom:7px', text: 'Motion' }));

  const clipSel = h('select', { class: 'sg-select', style: 'width:100%;margin-bottom:8px' }) as HTMLSelectElement;
  CLIPS.forEach((c, i) => clipSel.appendChild(h('option', { text: c.name, attrs: { value: String(i) } })));
  clipSel.onchange = () => {
    state.clipIdx = +clipSel.value;
    workClip = cloneClip(CLIPS[state.clipIdx]);
    state.frame = 0;
    buildPoseSliders();
    rebake();
  };
  panel.appendChild(clipSel);

  const playBtn = h('button', { class: 'sg-btn is-on', style: 'width:100%;margin-bottom:6px', text: '▶ Playing' });
  function setPlaying(on: boolean): void {
    state.playing = on;
    playBtn.classList.toggle('is-on', on);
    playBtn.textContent = on ? '▶ Playing' : '⏸ Paused';
  }
  playBtn.onclick = () => setPlaying(!state.playing);
  panel.appendChild(playBtn);

  const frameRow = h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' });
  const frameLbl = h('span', { class: 'sg-accent', style: 'min-width:74px', text: 'frame 1/7' });
  const frameSlider = h('input', {
    class: 'sg-range',
    style: 'flex:1',
    attrs: { type: 'range', min: '0', max: String(workClip.frames - 1), step: '1', value: '0' },
  }) as HTMLInputElement;
  frameSlider.oninput = () => {
    state.frame = +frameSlider.value;
    setPlaying(false);
    drawStrip();
    drawBig();
  };
  frameRow.append(frameLbl, frameSlider);
  panel.appendChild(frameRow);

  const zoomRow = h('div', { class: 'sg-group', style: 'display:flex;margin-bottom:4px' });
  const zoomBtns = ZOOMS.map((zz) => {
    const b = h('button', { class: 'sg-btn', style: 'flex:1', text: `×${zz}` });
    b.classList.toggle('is-on', zz === state.zoom);
    b.onclick = () => setZoom(zz);
    zoomRow.appendChild(b);
    return b;
  });
  panel.appendChild(zoomRow);
  // Free zoom — integer factors only (pixel-perfect rule), rungs stay as presets.
  const zoomSlideRow = h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' });
  const zoomSlideLbl = h('span', { class: 'sg-accent', style: 'min-width:32px', text: `×${state.zoom}` });
  const zoomSlider = h('input', {
    class: 'sg-range',
    style: 'flex:1',
    attrs: { type: 'range', min: '1', max: '16', step: '1', value: String(state.zoom) },
  }) as HTMLInputElement;
  zoomSlider.oninput = () => setZoom(+zoomSlider.value);
  zoomSlideRow.append(zoomSlideLbl, zoomSlider);
  panel.appendChild(zoomSlideRow);
  function setZoom(z: number): void {
    state.zoom = z;
    zoomBtns.forEach((bb, i) => bb.classList.toggle('is-on', ZOOMS[i] === z));
    zoomSlider.value = String(z);
    zoomSlideLbl.textContent = `×${z}`;
    drawBig();
  }

  const quantBtn = h('button', { class: 'sg-btn', style: 'width:100%;margin-bottom:4px', text: 'Quantize (Oklab+Bayer)' });
  quantBtn.onclick = () => {
    state.quantize = !state.quantize;
    quantBtn.classList.toggle('is-on', state.quantize);
    rebake();
  };
  panel.appendChild(quantBtn);

  const skinBtn = h('button', { class: 'sg-btn', style: 'width:100%;margin-bottom:4px', text: 'Skin joints (blend 3px)' });
  skinBtn.onclick = () => {
    state.skin = !state.skin;
    skinBtn.classList.toggle('is-on', state.skin);
    rebake();
  };
  panel.appendChild(skinBtn);

  const snapBtn = h('button', { class: 'sg-btn is-on', style: 'width:100%;margin-bottom:4px', text: 'Snap palette + ink outline' });
  snapBtn.onclick = () => {
    state.snap = !state.snap;
    snapBtn.classList.toggle('is-on', state.snap);
    rebake();
  };
  panel.appendChild(snapBtn);

  const bonesBtn = h('button', { class: 'sg-btn', style: 'width:100%;margin-bottom:10px', text: 'Bones overlay' });
  bonesBtn.onclick = () => {
    state.bones = !state.bones;
    bonesBtn.classList.toggle('is-on', state.bones);
    drawBig();
  };
  panel.appendChild(bonesBtn);

  // End-pose tuning: one slider per animated chip → rewrite the LAST keyframe.
  panel.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin:4px 0 6px', text: 'End pose (deg)' }));
  const poseHost = h('div', {});
  panel.appendChild(poseHost);

  function buildPoseSliders(): void {
    poseHost.replaceChildren();
    // Every chip gets a slider — un-keyed chips (dimmed) grow a flat track on
    // first touch, so any body part is adjustable in any clip.
    for (const ch of workTemplate.chips) {
      const name = ch.name;
      const keyed = name in workClip.tracks;
      const track = workClip.tracks[name] ?? [
        { t: 0, deg: 0 },
        { t: 1, deg: 0 },
      ];
      const endKey = track[track.length - 1];
      const row = h('div', { style: 'display:flex;align-items:center;gap:7px;margin-bottom:5px' });
      const lbl = h('span', {
        style: `min-width:76px;color:${keyed ? 'var(--ink-0)' : 'var(--ink-2)'}`,
        text: name,
      });
      const val = h('span', { class: 'sg-accent', style: 'min-width:38px;text-align:right', text: `${endKey.deg}°` });
      const slider = h('input', {
        class: 'sg-range',
        style: 'flex:1',
        attrs: { type: 'range', min: '-180', max: '180', step: '1', value: String(endKey.deg) },
      }) as HTMLInputElement;
      slider.oninput = () => {
        if (!(name in workClip.tracks)) workClip.tracks[name] = track;
        endKey.deg = +slider.value;
        lbl.style.color = 'var(--ink-0)';
        val.textContent = `${endKey.deg}°`;
        rebake();
      };
      row.append(lbl, slider, val);
      poseHost.appendChild(row);

      // Translation channel (the out-of-plane fake) — only for tracks that use it.
      if (track.some((k) => k.dy !== undefined || k.dx !== undefined)) {
        const dyRow = h('div', { style: 'display:flex;align-items:center;gap:7px;margin-bottom:5px' });
        const dyLbl = h('span', { class: 'sg-muted', style: 'min-width:76px', text: `${name} ↕px` });
        const dyVal = h('span', { class: 'sg-accent', style: 'min-width:38px;text-align:right', text: String(endKey.dy ?? 0) });
        const dySlider = h('input', {
          class: 'sg-range',
          style: 'flex:1',
          attrs: { type: 'range', min: '-10', max: '10', step: '1', value: String(endKey.dy ?? 0) },
        }) as HTMLInputElement;
        dySlider.oninput = () => {
          endKey.dy = +dySlider.value;
          dyVal.textContent = String(endKey.dy);
          rebake();
        };
        dyRow.append(dyLbl, dySlider, dyVal);
        poseHost.appendChild(dyRow);
      }
    }
    const reset = h('button', { class: 'sg-btn', style: 'width:100%;margin-top:3px', text: '↺ Reset pose' });
    reset.onclick = () => {
      workClip = cloneClip(CLIPS[state.clipIdx]);
      buildPoseSliders();
      rebake();
    };
    poseHost.appendChild(reset);
    frameSlider.max = String(workClip.frames - 1);
  }

  // ── joint pin mode ──────────────────────────────────────────────────────────
  panel.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin:12px 0 6px', text: 'Joints' }));
  const pinBtn = h('button', { class: 'sg-btn', style: 'width:100%;margin-bottom:5px', text: '📍 Pin joints (click big view)' });
  const pinChipRow = h('div', { style: 'display:none;flex-wrap:wrap;gap:3px;margin-bottom:5px' });
  const pinChipBtns = workTemplate.chips.map((ch, i) => {
    const b = h('button', { class: 'sg-btn', style: `flex:1 1 45%;font-size:10px;border-left:3px solid ${CHIP_COLORS[i % CHIP_COLORS.length]}`, text: ch.name });
    b.classList.toggle('is-on', i === pin.chip);
    b.onclick = () => selectPinChip(i);
    pinChipRow.appendChild(b);
    return b;
  });
  function selectPinChip(i: number): void {
    pin.chip = i;
    pinChipBtns.forEach((bb, k) => bb.classList.toggle('is-on', k === i));
  }
  const pinMirrorBtn = h('button', { class: 'sg-btn is-on', style: 'width:100%;margin-bottom:5px', text: '⇄ Mirror L/R pins' });
  pinMirrorBtn.onclick = () => {
    pin.mirror = !pin.mirror;
    pinMirrorBtn.classList.toggle('is-on', pin.mirror);
  };
  const jointReadout = h('div', {
    class: 'sg-muted',
    style: 'font-size:10px;line-height:1.6;white-space:pre;margin-bottom:5px',
    attrs: { 'data-joints': '' },
  });
  function updateJointReadout(): void {
    jointReadout.textContent = workTemplate.chips
      .map((ch) => `${ch.name.padEnd(10)} [${ch.pivot[0]},${ch.pivot[1]}]`)
      .join('\n');
  }
  updateJointReadout();
  pinBtn.onclick = () => {
    pin.on = !pin.on;
    pinBtn.classList.toggle('is-on', pin.on);
    pinChipRow.style.display = pin.on ? 'flex' : 'none';
    if (pin.on) {
      setPlaying(false);
      state.frame = 0; // rest pose — clicks map 1:1 to rest-space cell coords
      state.bones = true;
      bonesBtn.classList.add('is-on');
      drawStrip();
      drawBig();
    }
  };
  const pinReset = h('button', { class: 'sg-btn', style: 'width:100%;margin-bottom:5px', text: '↺ Reset joints' });
  pinReset.onclick = () => {
    workTemplate.chips.forEach((ch, i) => {
      ch.pivot = [TEMPLATE.chips[i].pivot[0], TEMPLATE.chips[i].pivot[1]];
    });
    updateJointReadout();
    rebake();
  };
  // Export pinned joints as the source-of-truth const block for lpc-humanoid.ts
  // — "saving" a template edit means landing it in code, not in browser state.
  const JOINT_CONST: Record<string, string> = {
    head: 'NECK',
    armL_up: 'SHOULDER_L',
    armL_fore: 'ELBOW_L',
    armR_up: 'SHOULDER_R',
    armR_fore: 'ELBOW_R',
    legL_up: 'HIP_L',
    legL_fore: 'KNEE_L',
    legR_up: 'HIP_R',
    legR_fore: 'KNEE_R',
  };
  const pinCopy = h('button', { class: 'sg-btn', style: 'width:100%;margin-bottom:5px', text: '⧉ Copy joints as TS' });
  pinCopy.onclick = () => {
    const lines = workTemplate.chips
      .filter((ch) => JOINT_CONST[ch.name] !== undefined)
      .map((ch) => `const ${JOINT_CONST[ch.name]}: [number, number] = [${ch.pivot[0]}, ${ch.pivot[1]}];`);
    void navigator.clipboard.writeText(lines.join('\n')).then(() => {
      pinCopy.textContent = '✓ copied';
      setTimeout(() => (pinCopy.textContent = '⧉ Copy joints as TS'), 1200);
    });
  };
  panel.append(pinBtn, pinMirrorBtn, pinChipRow, jointReadout, pinCopy, pinReset);

  // ── character: preview any role's seeded wardrobe on the rig ────────────────
  // Layer stacks come from the game's own role recipes (buildCharacterSpec) via
  // the pure path resolver (walkSpriteCandidates) — same sheets the runtime
  // compositor loads, so what bakes here is what the game would wear.
  interface CharLayer {
    path: string;
    fallback?: string;
    assign?: string;
    label: string;
  }
  const DEFAULT_LABELS = ['body', 'shirt', 'head', 'face', 'hair'];
  const defaultCharacter = (): CharLayer[] =>
    DEFAULT_HUMANOID_LAYERS.map((s, i) => ({ path: s.path, assign: s.assign, label: DEFAULT_LABELS[i] ?? `layer ${i}` }));
  // Paint order (bottom→top) across every selection key the role recipes use.
  const KEY_ORDER = ['body', 'legs', 'shoes', 'clothes', 'armour', 'arms', 'head', 'expression', 'hair'] as const;
  const HEAD_KEYS = new Set(['head', 'expression', 'hair']); // ride the head chip wholesale
  function characterLayers(spec: CharacterSpec): CharLayer[] {
    const out: CharLayer[] = [];
    for (const key of KEY_ORDER) {
      const sel = spec.items[key];
      if (!sel) continue;
      const [primary, fallback] = walkSpriteCandidates(sel.itemId, sel.variant, spec.bodyType);
      if (!primary) continue;
      out.push({
        path: `sprites/lpc/spritesheets/${primary}`,
        fallback: fallback ? `sprites/lpc/spritesheets/${fallback}` : undefined,
        assign: HEAD_KEYS.has(key) ? 'head' : undefined,
        label: key,
      });
    }
    return out;
  }

  panel.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin:12px 0 6px', text: 'Character' }));
  const charState = { role: null as NpcRole | null, seed: 1 };
  const ROLES: (NpcRole | null)[] = [null, 'farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'];
  const roleRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px' });
  const roleBtns = ROLES.map((role) => {
    const b = h('button', { class: 'sg-btn', style: 'flex:1 1 30%;font-size:10px', text: role ?? 'default' });
    b.classList.toggle('is-on', role === charState.role);
    b.onclick = () => {
      charState.role = role;
      roleBtns.forEach((bb, i) => bb.classList.toggle('is-on', ROLES[i] === charState.role));
      void applyCharacter();
    };
    roleRow.appendChild(b);
    return b;
  });
  const rerollBtn = h('button', { class: 'sg-btn', style: 'width:100%;margin-bottom:4px', text: '⟳ Reroll (seed 1)' });
  rerollBtn.onclick = () => {
    charState.seed++;
    rerollBtn.textContent = `⟳ Reroll (seed ${charState.seed})`;
    void applyCharacter();
  };
  function applyCharacter(): Promise<void> {
    return loadCharacter(
      charState.role === null ? defaultCharacter() : characterLayers(buildCharacterSpec(charState.role, charState.seed)),
    );
  }
  panel.append(
    roleRow,
    rerollBtn,
    h('div', {
      class: 'sg-muted',
      style: 'font-size:10px;line-height:1.5;margin-bottom:5px',
      text: 'seed picks sex/hair/outfit like in-game · chips are tuned on the male body — female/child are approximate',
    }),
  );

  // ── visibility: LPC source layers + chips ───────────────────────────────────
  panel.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin:12px 0 6px', text: 'Visibility' }));
  const layerRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:5px' });
  function rebuildLayerRow(labels: string[]): void {
    layerRow.replaceChildren();
    labels.forEach((label, i) => {
      const b = h('button', { class: 'sg-btn is-on', style: 'flex:1 1 30%;font-size:10px', text: label });
      b.onclick = () => {
        if (hiddenLayers.has(i)) hiddenLayers.delete(i);
        else hiddenLayers.add(i);
        b.classList.toggle('is-on', !hiddenLayers.has(i));
        rebake();
        rebuildWalkLane();
        drawGait();
      };
      layerRow.appendChild(b);
    });
  }
  const chipVisRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:5px' });
  workTemplate.chips.forEach((ch, i) => {
    const b = h('button', {
      class: 'sg-btn is-on',
      style: `flex:1 1 45%;font-size:10px;border-left:3px solid ${CHIP_COLORS[i % CHIP_COLORS.length]}`,
      text: ch.name,
    });
    b.onclick = () => {
      if (hiddenChips.has(ch.name)) hiddenChips.delete(ch.name);
      else hiddenChips.add(ch.name);
      b.classList.toggle('is-on', !hiddenChips.has(ch.name));
      rebake();
    };
    chipVisRow.appendChild(b);
  });
  panel.append(
    h('div', { class: 'sg-muted', style: 'font-size:10px;margin-bottom:3px', text: 'LPC layers' }),
    layerRow,
    h('div', { class: 'sg-muted', style: 'font-size:10px;margin-bottom:3px', text: 'chips (hidden = hole)' }),
    chipVisRow,
  );

  panel.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin:12px 0 6px', text: 'Gait (walk cycle)' }));
  const gaitRow = h('div', { class: 'sg-group', style: 'display:flex;margin-bottom:4px' });
  const gaitBtns = GAIT_STYLES.map((s) => {
    const b = h('button', { class: 'sg-btn', style: 'flex:1', text: s.name });
    b.classList.toggle('is-on', s === gaitStyle);
    b.onclick = () => {
      gaitStyle = s;
      styledPlan = planGait(s, WALK_N, FRAME_MS);
      gaitClock = 0;
      gaitStyledView.lbl.textContent = `walk · ${s.name}`;
      gaitBtns.forEach((bb, i) => bb.classList.toggle('is-on', GAIT_STYLES[i] === s));
      drawGait();
    };
    gaitRow.appendChild(b);
    return b;
  });
  panel.appendChild(gaitRow);
  panel.appendChild(
    h('div', {
      class: 'sg-muted',
      style: 'font-size:10px;line-height:1.5;margin-bottom:6px',
      text: 'runtime-style playback of the untouched walk sheet — styled loop vs normal cadence',
    }),
  );

  const metaLbl = h('div', {
    class: 'sg-muted',
    style: 'margin-top:10px;font-size:10px;line-height:1.5',
    text: `template ${TEMPLATE.name} · ${TEMPLATE.chips.length} chips · south facing`,
  });
  panel.appendChild(metaLbl);

  // ── load a character's layers, then bake ────────────────────────────────────
  const loading = h('div', { class: 'sg-muted', style: 'font-size:11px', text: 'loading LPC layers…' });
  let loadGen = 0; // a newer pick supersedes an in-flight one
  async function loadCharacter(charLayers: CharLayer[]): Promise<void> {
    const gen = ++loadGen;
    loading.textContent = 'loading LPC layers…';
    main.prepend(loading);
    // NOTE: the dev server's SPA fallback answers missing files with 200 +
    // index.html, so "does this variant exist" must survive decode, not just
    // resp.ok — hence fallback on any failure, not only HTTP errors.
    async function fetchRaster(path: string): Promise<Raster | null> {
      const resp = await fetch(assetUrl(path));
      if (!resp.ok) return null;
      const type = resp.headers.get('content-type') ?? '';
      if (!type.includes('image/png')) return null;
      return decodePngToRaster(await resp.blob());
    }
    try {
      const anims = stampAnims(CLIPS.map((c) => c.stamps));
      const loaded = await Promise.all(
        charLayers.map(async (spec) => {
          let path = spec.path;
          let sheet = await fetchRaster(path);
          if (!sheet && spec.fallback) {
            path = spec.fallback;
            sheet = await fetchRaster(path);
          }
          if (!sheet) throw new Error(`${spec.path}: not found`);
          // Donor anim sheets for clip stamps (open palms…), derived from the
          // path that actually loaded. A layer without the donor anim simply
          // keeps its rest pixels (e.g. the child wardrobe has no spellcast).
          const donors: Record<string, Raster> = {};
          for (const anim of anims) {
            for (const cand of donorSheetCandidates(path, anim)) {
              const d = await fetchRaster(cand);
              if (d) {
                donors[anim] = d;
                break;
              }
            }
          }
          return { sheet, donors };
        }),
      );
      if (disposed || gen !== loadGen) return;
      layers = loaded.map(({ sheet, donors }, li) => {
        const data = new Uint8ClampedArray(CELL * CELL * 4);
        const sx = HUMANOID_SOURCE.col * CELL;
        const sy = HUMANOID_SOURCE.row * CELL;
        for (let y = 0; y < CELL; y++) {
          const src = (sy + y) * sheet.w + sx;
          data.set(sheet.data.subarray(src * 4, (src + CELL) * 4), y * CELL * 4);
        }
        return { raster: { data, w: CELL, h: CELL }, assign: charLayers[li].assign, donors };
      });
      // Composite the walk cycle for the gait lane (existing frames, untouched).
      loadedSheets = loaded.map((l) => l.sheet);
      hiddenLayers.clear();
      rebuildLayerRow(charLayers.map((c) => c.label));
      rebuildWalkLane();
      metaLbl.textContent = `template ${TEMPLATE.name} · ${TEMPLATE.chips.length} chips · south facing · layers ×${charLayers.length}`;
      loading.remove();
      rebake();
      drawGait();
    } catch (err) {
      if (gen !== loadGen) return;
      loading.textContent = `✕ layer load failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  void loadCharacter(defaultCharacter());

  buildPoseSliders();
  raf = requestAnimationFrame(tick);

  return {
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(raf);
    },
  };
}
