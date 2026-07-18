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

import { assetUrl } from '@/core/asset-url';
import {
  bakeClip,
  chipWorldTransforms,
  sampleClip,
  applyAffine,
  type Clip,
} from '@/render/paperdoll/rig';
import {
  CLIP_PRAY_BOW,
  CLIP_PRAY_RAISE,
  DEFAULT_HUMANOID_LAYERS,
  HUMANOID_SOURCE,
  LPC_HUMANOID_SOUTH,
} from '@/render/paperdoll/lpc-humanoid';
import { decodePngToRaster } from '@/render/sprite-codec';
import { rgbaToCanvas, type SpriteCanvas } from '@/render/iso/sprite-canvas';
import { quantizePaletteOklab, type Raster } from '@/render/sprite-postprocess';
import { injectStudioTheme, COLORS, h } from './theme';

export interface StudioHandle {
  dispose(): void;
}

const TEMPLATE = LPC_HUMANOID_SOUTH;
const CELL = TEMPLATE.cell;
const CLIPS: readonly Clip[] = [CLIP_PRAY_RAISE, CLIP_PRAY_BOW];
const ZOOMS = [2, 4, 6, 10] as const;
const STEP_MS = 120; // matches ACTION_FRAME_MS cadence
const GAME_PX = 32; // on-screen sprite size at zoom 1
const CHIP_COLORS = ['#787878', '#ffdc3c', '#50b4ff', '#3c78ff', '#ff8250', '#ff4628'];

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
  };
  let workClip = cloneClip(CLIPS[0]);

  // ── bake state ──────────────────────────────────────────────────────────────
  let layers: Raster[] | null = null;
  let frames: Raster[] = []; // raw baked cell frames (pre-quantize)
  let shownFrames: SpriteCanvas[] = []; // big-view canvases (quantized if toggled)
  let gameFrames: SpriteCanvas[] = []; // 32px downscales for the in-game loop

  function rebake(): void {
    if (!layers) return;
    frames = bakeClip(TEMPLATE, layers, workClip);
    const display = state.quantize
      ? frames.map((f) => quantizePaletteOklab(f, 32, { dither: 'bayer4' }))
      : frames;
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
    const world = chipWorldTransforms(TEMPLATE, sampleClip(TEMPLATE, workClip, t));
    TEMPLATE.chips.forEach((ch, i) => {
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
    acc += now - last;
    last = now;
    if (acc >= STEP_MS && state.playing && frames.length > 0) {
      acc = 0;
      state.frame = (state.frame + 1) % frames.length;
      drawStrip();
      drawBig();
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

  const zoomRow = h('div', { class: 'sg-group', style: 'display:flex;margin-bottom:8px' });
  const zoomBtns = ZOOMS.map((zz) => {
    const b = h('button', { class: 'sg-btn', style: 'flex:1', text: `×${zz}` });
    b.classList.toggle('is-on', zz === state.zoom);
    b.onclick = () => {
      state.zoom = zz;
      zoomBtns.forEach((bb, i) => bb.classList.toggle('is-on', ZOOMS[i] === zz));
      drawBig();
    };
    zoomRow.appendChild(b);
    return b;
  });
  panel.appendChild(zoomRow);

  const quantBtn = h('button', { class: 'sg-btn', style: 'width:100%;margin-bottom:4px', text: 'Quantize (Oklab+Bayer)' });
  quantBtn.onclick = () => {
    state.quantize = !state.quantize;
    quantBtn.classList.toggle('is-on', state.quantize);
    rebake();
  };
  panel.appendChild(quantBtn);

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
    for (const name of Object.keys(workClip.tracks)) {
      const track = workClip.tracks[name];
      const endKey = track[track.length - 1];
      const row = h('div', { style: 'display:flex;align-items:center;gap:7px;margin-bottom:5px' });
      const lbl = h('span', { style: 'min-width:76px;color:var(--ink-0)', text: name });
      const val = h('span', { class: 'sg-accent', style: 'min-width:38px;text-align:right', text: `${endKey.deg}°` });
      const slider = h('input', {
        class: 'sg-range',
        style: 'flex:1',
        attrs: { type: 'range', min: '-180', max: '180', step: '1', value: String(endKey.deg) },
      }) as HTMLInputElement;
      slider.oninput = () => {
        endKey.deg = +slider.value;
        val.textContent = `${endKey.deg}°`;
        rebake();
      };
      row.append(lbl, slider, val);
      poseHost.appendChild(row);
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

  panel.appendChild(
    h('div', {
      class: 'sg-muted',
      style: 'margin-top:10px;font-size:10px;line-height:1.5',
      text: `template ${TEMPLATE.name} · ${TEMPLATE.chips.length} chips · south facing · layers ×${DEFAULT_HUMANOID_LAYERS.length}`,
    }),
  );

  // ── load layers, then first bake ────────────────────────────────────────────
  const loading = h('div', { class: 'sg-muted', style: 'font-size:11px', text: 'loading LPC layers…' });
  main.prepend(loading);
  void (async () => {
    try {
      const sheets = await Promise.all(
        DEFAULT_HUMANOID_LAYERS.map(async (p) => {
          const resp = await fetch(assetUrl(p));
          if (!resp.ok) throw new Error(`${p}: HTTP ${resp.status}`);
          const raster = await decodePngToRaster(await resp.blob());
          if (!raster) throw new Error(`${p}: decode failed`);
          return raster;
        }),
      );
      if (disposed) return;
      layers = sheets.map((sheet) => {
        const data = new Uint8ClampedArray(CELL * CELL * 4);
        const sx = HUMANOID_SOURCE.col * CELL;
        const sy = HUMANOID_SOURCE.row * CELL;
        for (let y = 0; y < CELL; y++) {
          const src = (sy + y) * sheet.w + sx;
          data.set(sheet.data.subarray(src * 4, (src + CELL) * 4), y * CELL * 4);
        }
        return { data, w: CELL, h: CELL };
      });
      loading.remove();
      rebake();
    } catch (err) {
      loading.textContent = `✕ layer load failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  })();

  buildPoseSliders();
  raf = requestAnimationFrame(tick);

  return {
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(raf);
    },
  };
}
