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
//   • GAIT lane (humanoid only): the untouched walk cycle played through a
//     Tier-0 gait style (retiming + whole-sprite offsets, gait.ts) beside a
//     normal-cadence control. No rebake — this simulates runtime playback.
//   • REFERENCE lane (humanoid only): LPC's own hand-pixeled row beside the
//     bake, phase-locked, with a silhouette-IoU / colour-delta readout. The
//     free ground truth for "does the imported motion read right".
//   • MOTION metrics: what capture an imported clip came from, the ground
//     speed its stride implies, and the foot skate left after the designed
//     in-place slide is removed.
//
// Template-agnostic: every rig (humanoid, and future non-humanoid templates)
// registers in `render/paperdoll/rig-catalog.ts`. A button row at the top of
// the left panel picks the active RigEntry, and a second row picks the FACING
// among that rig's authored views; switching either never reloads the page —
// it rebuilds every piece of UI that depends on chip count / clip list /
// bone-overlay colors. A rig switch re-runs `loadLayers()`; a facing switch
// does not (same wardrobe, different sheet row), it only re-slices what is
// already decoded. The "Character" (role wardrobe), "Gait" and "Reference"
// panels are LPC-humanoid-specific — they show only for the humanoid rig.

import {
  bakeClip,
  chipWorldTransforms,
  sampleClip,
  applyAffine,
  type AnimTemplate,
  type Clip,
  type PoseLayer,
} from '@/render/paperdoll/rig';
import { importedMetaFor, RIGS, type RigEntry, type RigFacingEntry } from '@/render/paperdoll/rig-catalog';
import { fetchRaster, loadHumanoidCharacter, sliceSourceCell } from '@/render/paperdoll/humanoid-loader';
import { humanoidLayerSpecs } from '@/render/lpc/humanoid-layers';
import { DEFAULT_HUMANOID_LAYERS, donorSheetCandidates, HUMANOID_SOURCE } from '@/render/paperdoll/lpc-humanoid';
import { GAIT_NORMAL, GAIT_STYLES, gaitFrameAt, planGait, type GaitPlan } from '@/render/paperdoll/gait';
import {
  chipPointTrack,
  cycleFrameAtPhase,
  cycleLength,
  frameCompare,
  skate,
  trackRangeDeg,
  type FrameCompare,
} from '@/render/paperdoll/clip-measure';
import { LPC_ANIMATIONS, type NpcAnimation } from '@/core/npc-animation';
import { NPC_WALK_SPEED } from '@/sim/npc-movement';
import { TILE_SIZE } from '@/core/constants';
import { FRAME_MS } from '@/render/npc-animator';
import { collectOutlinePalette, collectSourcePalette, reinkOutline, snapToSourcePalette } from '@/render/paperdoll/palette-snap';
import { buildCharacterSpec, type CharacterSpec } from '@/render/lpc/character-builder';
import type { NpcRole } from '@/core/types';
import { rgbaToCanvas, type SpriteCanvas } from '@/render/iso/sprite-canvas';
import { quantizePaletteOklab, type Raster } from '@/render/sprite-postprocess';
import { injectStudioTheme, COLORS, h } from './theme';

export interface StudioHandle {
  dispose(): void;
}

const ZOOMS = [2, 4, 6, 10] as const;
const STEP_MS = 120; // matches ACTION_FRAME_MS cadence
const GAME_PX = 32; // on-screen sprite size at zoom 1

const cloneClip = (c: Clip): Clip => JSON.parse(JSON.stringify(c)) as Clip;
const cloneTemplate = (t: AnimTemplate): AnimTemplate => JSON.parse(JSON.stringify(t)) as AnimTemplate;
/** Default joint-pin chip — armL_fore on the humanoid (the hinge that started
 *  this); clamped so a rig with fewer chips still lands on a valid index. */
const defaultPinChip = (t: AnimTemplate): number => Math.min(3, t.chips.length - 1);

/**
 * Coverage-weighted box downscale to the in-game sprite size. Assumes an
 * INTEGER ratio (`f.w / to`) — the pixel-perfect rule means a rig cell is an
 * even multiple of GAME_PX (64 -> 32 for every shipped rig). A rig authored
 * with an odd cell would step this loop fractionally and smear; keep cells a
 * multiple of 32 rather than generalising the sampler.
 */
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

/** Alpha-over composite of one `cell`px cell (col,row) across all layer sheets. */
function compositeCell(sheets: readonly Raster[], col: number, row: number, cell: number): Raster {
  const data = new Uint8ClampedArray(cell * cell * 4);
  for (const sheet of sheets) {
    const sx = col * cell;
    const sy = row * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const si = ((sy + y) * sheet.w + sx + x) * 4;
        const a = sheet.data[si + 3];
        if (a === 0) continue;
        const di = (y * cell + x) * 4;
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
  return { data, w: cell, h: cell };
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

  // ── active rig + facing ──────────────────────────────────────────────────
  let rig: RigEntry = RIGS[0];
  let facing: RigFacingEntry = rig.facings[0];
  // `workClip` is a mutable CLONE (the end-pose sliders rewrite its keyframes),
  // so anything asking "which registered clip is this" must hold the source too
  // — identity is what tells the sheep's hand-authored `walk` apart from the
  // imported human one of the same name.
  let sourceClip: Clip = facing.clips[0];
  let workClip = cloneClip(sourceClip);
  // Mutable template copy: joint pin mode edits pivots live (rest-space coords).
  let workTemplate: AnimTemplate = cloneTemplate(facing.template);
  const pin = { on: false, chip: defaultPinChip(facing.template), mirror: true };
  const hiddenLayers = new Set<number>(); // indices into the loaded layer stack
  const hiddenChips = new Set<string>(); // chip names skipped at paint time

  // Pivots are grid POINTS, not pixels: pixel content mirrors as (cell-1)-x,
  // but a point mirrors as cell-x (the mirror of column 19's left edge is
  // column 45's left edge on a 64px humanoid cell).
  function setPivot(idx: number, cx: number, cy: number): void {
    workTemplate.chips[idx].pivot = [cx, cy];
    if (pin.mirror) {
      const mn = rig.mirrorName(workTemplate.chips[idx].name);
      const mi = mn === null ? -1 : workTemplate.chips.findIndex((c) => c.name === mn);
      if (mi >= 0) workTemplate.chips[mi].pivot = [workTemplate.cell - cx, cy];
    }
    updateJointReadout();
  }

  // ── bake state ──────────────────────────────────────────────────────────────
  // `baseLayers` is what the loader decoded (south rest cells + stamp donors);
  // `layers` is that stack re-sliced for the ACTIVE facing. A facing switch
  // touches only the slice — the sheets are already in memory and the wardrobe
  // has not changed, so refetching them would be pure latency.
  let baseLayers: PoseLayer[] | null = null;
  let layers: PoseLayer[] | null = null;
  let frames: Raster[] = []; // raw baked cell frames (pre-quantize)
  let displayFrames: Raster[] = []; // post quantize/snap — what the lanes measure
  let shownFrames: SpriteCanvas[] = []; // big-view canvases (quantized if toggled)
  let gameFrames: SpriteCanvas[] = []; // 32px downscales for the in-game loop

  /** Re-slice the decoded wardrobe for the active facing's sheet row. */
  function applyFacingToLayers(): void {
    if (!baseLayers) return;
    const row = facing.sheetRow;
    if (!loadedSheets || row === undefined) {
      layers = baseLayers;
      return;
    }
    layers = baseLayers.map((l, i) => ({
      raster: sliceSourceCell(loadedSheets![i], row, HUMANOID_SOURCE.col, facing.template.cell),
      assign: l.assign,
      // Stamp donors are south-row crops (faces, spellcast palms). A facing
      // that cannot use them gets none, so a stamped clip simply bakes without
      // its pixel swaps instead of pasting a face onto the back of a head.
      donors: facing.stamps ? l.donors : undefined,
    }));
  }

  function rebake(): void {
    if (!layers) return;
    const visible = layers.filter((_, i) => !hiddenLayers.has(i));
    frames = bakeClip(workTemplate, visible, facing.stamps ? workClip : { ...workClip, stamps: undefined }, {
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
    displayFrames = display;
    shownFrames = display.map((f) => rgbaToCanvas(f.data, f.w, f.h)).filter((c): c is SpriteCanvas => c !== null);
    gameFrames = display
      .map((f) => downscale(f, GAME_PX))
      .map((f) => rgbaToCanvas(f.data, f.w, f.h))
      .filter((c): c is SpriteCanvas => c !== null);
    state.frame = Math.min(state.frame, frames.length - 1);
    measureReference();
    updateMotionMetrics();
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
    Math.max(0, Math.min(workTemplate.cell - 1, Math.floor(ev.offsetX / state.zoom))),
    Math.max(0, Math.min(workTemplate.cell - 1, Math.floor(ev.offsetY / state.zoom))),
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

  // ── gait lane (humanoid only): the untouched walk cycle under a runtime-style timing warp ──
  const GAIT_ZOOM = 4;
  const walkBig: SpriteCanvas[] = []; // composited walk frames, cell size
  const walkSmall: SpriteCanvas[] = []; // 32px downscales
  let loadedSheets: Raster[] | null = null; // full LPC walk sheets, for lane recomposites
  let loadedSpecs: CharLayer[] | null = null; // the stack that resolved — sibling anim paths derive from it
  const walkColCount = LPC_ANIMATIONS.walk.lastCol - LPC_ANIMATIONS.walk.firstCol + 1;

  /**
   * (Re)composite the gait lane's walk frames, honoring layer visibility.
   * The row is the ACTIVE facing's — `HUMANOID_SOURCE.row` is south's, and
   * compositing it under a north bake would put a front view next to a back one.
   */
  function rebuildWalkLane(): void {
    if (!loadedSheets) return;
    walkBig.length = 0;
    walkSmall.length = 0;
    const use = loadedSheets.filter((_, i) => !hiddenLayers.has(i));
    for (let col = LPC_ANIMATIONS.walk.firstCol; col <= LPC_ANIMATIONS.walk.lastCol; col++) {
      const cellR = compositeCell(use, col, facing.sheetRow ?? HUMANOID_SOURCE.row, workTemplate.cell);
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
  const normalPlan = planGait(GAIT_NORMAL, walkColCount, FRAME_MS);
  let styledPlan = planGait(gaitStyle, walkColCount, FRAME_MS);
  let gaitClock = 0;

  function gaitView(label: string): { col: HTMLElement; big: HTMLCanvasElement; small: HTMLCanvasElement; lbl: HTMLElement } {
    const big = document.createElement('canvas');
    big.width = workTemplate.cell * GAIT_ZOOM;
    big.height = workTemplate.cell * GAIT_ZOOM;
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
  const gaitEyebrow = h('div', { class: 'sg-eyebrow', style: 'margin-top:6px', text: 'Gait — walk cycle (Tier 0: timing + offsets, no new pixels)' });
  main.append(gaitEyebrow, gaitWrap);

  function drawGaitInto(view: { big: HTMLCanvasElement; small: HTMLCanvasElement }, plan: GaitPlan): void {
    const f = gaitFrameAt(plan, gaitClock);
    const g = view.big.getContext('2d');
    if (g) {
      g.imageSmoothingEnabled = false;
      checker(g, view.big.width, view.big.height, 8 * GAIT_ZOOM);
      const fr = walkBig[f.frame];
      if (fr) g.drawImage(fr as CanvasImageSource, f.dx * GAIT_ZOOM, f.dy * GAIT_ZOOM, workTemplate.cell * GAIT_ZOOM, workTemplate.cell * GAIT_ZOOM);
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

  // ── reference lane (humanoid only): LPC's own row beside the bake ───────────
  //
  // The free ground truth. LPC ships hand-pixeled cycles for the very character
  // the rig is re-posing, at the very facing being baked, already on disk and
  // already licensed — so an imported capture can be held against a human's
  // answer to the same question without anyone drawing anything.
  //
  // Locked by PHASE, never by index: LPC's walk row is 8 cells and the imported
  // walk bakes 9 frames (the ninth repeating the first, because it loops), so
  // pairing frame i with frame i would slide the comparison a whole pose out by
  // the end of the cycle. Both sides map t ∈ [0,1) onto their own cycle length.
  // GOTCHA the lane was first written wrong on: `LPC_ANIMATIONS.rowBase`
  // addresses the COMPOSED universal sheet the character-builder assembles.
  // The vendored PART sheets loaded here are PER ANIMATION — `walk.png`,
  // `slash.png`, … — each just four direction rows tall, so a reference row is
  // a different FILE, not a lower row of the same one. Adding `rowBase` reads
  // past the end and scores the bake against pure transparency (IoU 0.000,
  // which looks like a catastrophic bake rather than a bad lookup).
  const REF_ROWS: readonly NpcAnimation[] = ['walk', 'thrust', 'slash', 'spellcast', 'shoot'];
  let refRow: NpcAnimation = 'walk';
  /** Per-anim sheets aligned with the loaded layer stack; null where unvendored. */
  let refSheets: (Raster | null)[] | null = null;
  const refSheetCache = new Map<NpcAnimation, (Raster | null)[]>();
  const refRasters: Raster[] = []; // composited reference cells, cell size
  const refBig: SpriteCanvas[] = [];
  const refSmall: SpriteCanvas[] = [];
  /** Bake frame → its comparison against the phase-matched reference cell. */
  let refPerFrame: (FrameCompare | null)[] = [];
  let refMean: FrameCompare | null = null;
  // The two cycles start at unrelated moments — LPC's artist and a CMU actor
  // agreed on nothing — so the lane also carries a whole-cell alignment.
  // Auto-picked by best mean IoU, but SAY SO WEAKLY: a walking figure's
  // silhouette is mostly torso and head, so the score barely moves across
  // shifts (~0.01) and the winner is close to arbitrary. `refShiftScores` is
  // shown for exactly that reason — the spread is the honesty.
  let refShift = 0;
  let refShiftAuto = true;
  let refShiftScores: number[] = [];

  /** (Re)composite the picked LPC row at the active facing, honoring layer visibility. */
  function rebuildReferenceLane(): void {
    refRasters.length = 0;
    refBig.length = 0;
    refSmall.length = 0;
    const row = facing.sheetRow;
    if (!refSheets || row === undefined) return;
    const spec = LPC_ANIMATIONS[refRow];
    const cell = workTemplate.cell;
    const use = refSheets.filter((s, i) => s !== null && !hiddenLayers.has(i)) as Raster[];
    if (use.length === 0) return;
    for (let col = spec.firstCol; col <= spec.lastCol; col++) {
      // A layer whose sheet is narrower than the row claims contributes
      // nothing rather than reading past its own right edge.
      const within = use.filter((s) => (col + 1) * cell <= s.w && (row + 1) * cell <= s.h);
      if (within.length === 0) continue;
      const cellR = compositeCell(within, col, row, cell);
      const big = rgbaToCanvas(cellR.data, cellR.w, cellR.h);
      const small = downscale(cellR, GAME_PX);
      const smallCv = rgbaToCanvas(small.data, small.w, small.h);
      if (big && smallCv) {
        refRasters.push(cellR);
        refBig.push(big);
        refSmall.push(smallCv);
      }
    }
  }

  /**
   * Resolve the picked row's sheets for the CURRENT wardrobe, then rebuild the
   * lane. `walk` is already in memory (it is the stack the rig bakes from);
   * every other row is a sibling file, fetched once per wardrobe and cached.
   * `loadGen` guards it exactly as the wardrobe loads do — a role switch
   * mid-fetch must not repaint the lane with the previous costume's row.
   */
  async function loadReferenceSheets(): Promise<void> {
    const gen = loadGen;
    const anim = refRow;
    const finish = (sheets: (Raster | null)[] | null): void => {
      refSheets = sheets;
      rebuildReferenceLane();
      measureReference();
      drawReference();
    };
    if (!loadedSpecs || !loadedSheets) return finish(null);
    if (anim === HUMANOID_SOURCE.anim) return finish(loadedSheets);
    const cached = refSheetCache.get(anim);
    if (cached) return finish(cached);
    const fetched = await Promise.all(
      loadedSpecs.map(async (spec) => {
        for (const base of [spec.path, spec.fallback]) {
          if (base === undefined) continue;
          for (const cand of donorSheetCandidates(base, anim)) {
            const r = await fetchRaster(cand);
            if (r) return r;
          }
        }
        return null;
      }),
    );
    if (disposed || gen !== loadGen) return;
    refSheetCache.set(anim, fetched);
    finish(fetched);
  }

  /** Reference cell index for a bake frame, both expressed as a phase. */
  function refIndexForFrame(f: number, shift = refShift): number {
    const n = refRasters.length;
    if (n === 0) return 0;
    const t = frames.length <= 1 ? 0 : f / (frames.length - 1);
    return ((cycleFrameAtPhase(n, t) - shift) % n + n) % n;
  }

  /** Bake frames that make up ONE cycle — a looping bake repeats its first pose. */
  function bakeCycleLength(): number {
    return Math.min(
      cycleLength(displayFrames.length, importedMetaFor(facing, sourceClip)?.loop ?? false),
      displayFrames.length,
    );
  }

  const meanOf = (cs: readonly FrameCompare[]): FrameCompare | null =>
    cs.length === 0
      ? null
      : {
        iou: cs.reduce((s, c) => s + c.iou, 0) / cs.length,
        colorDelta: cs.reduce((s, c) => s + c.colorDelta, 0) / cs.length,
        overlapPx: cs.reduce((s, c) => s + c.overlapPx, 0) / cs.length,
      };

  /**
   * Score every bake frame against its phase-matched reference cell, plus the
   * clip-wide mean, plus every candidate alignment. A looping bake's last frame
   * repeats its first, so the means run over the DISTINCT cycle only —
   * otherwise one pose votes twice and the shift search compares uneven cycles.
   */
  function measureReference(): void {
    refPerFrame = [];
    refMean = null;
    refShiftScores = [];
    if (refRasters.length === 0 || displayFrames.length === 0) return;
    const n = bakeCycleLength();
    const at = (shift: number): FrameCompare[] => {
      const out: FrameCompare[] = [];
      for (let i = 0; i < n; i++) {
        const f = displayFrames[i];
        const ref = refRasters[refIndexForFrame(i, shift)];
        if (ref && ref.w === f.w && ref.h === f.h) out.push(frameCompare(f, ref));
      }
      return out;
    };
    refShiftScores = refRasters.map((_, s) => meanOf(at(s))?.iou ?? 0);
    // A shorter row (slash is 6 cells, shoot 13) can leave a hand-picked shift
    // out of range; fold it rather than silently reading a different cell.
    refShift %= refRasters.length;
    if (refShiftAuto) refShift = refShiftScores.indexOf(Math.max(...refShiftScores));
    refMean = meanOf(at(refShift));
    refPerFrame = displayFrames.map((f, i) => {
      const ref = refRasters[refIndexForFrame(i)];
      return ref && ref.w === f.w && ref.h === f.h ? frameCompare(f, ref) : null;
    });
  }

  function refView(): { col: HTMLElement; big: HTMLCanvasElement; small: HTMLCanvasElement; lbl: HTMLElement } {
    const big = document.createElement('canvas');
    big.style.cssText = 'display:block;image-rendering:pixelated;border:1px solid var(--line);border-radius:6px';
    const small = document.createElement('canvas');
    small.width = GAME_PX * 2;
    small.height = GAME_PX * 2;
    small.style.cssText = 'display:block;width:64px;height:64px;image-rendering:pixelated;border:1px solid var(--line);border-radius:6px';
    const lbl = h('span', { class: 'sg-muted', style: 'font-size:10px', text: '' });
    const col = h('div', { style: 'display:flex;flex-direction:column;gap:5px;align-items:center' });
    col.append(big, small, lbl);
    return { col, big, small, lbl };
  }
  const refLpcView = refView();
  const refBakeView = refView();
  const refEyebrow = h('div', { class: 'sg-eyebrow', style: 'margin-top:6px', text: 'Reference — LPC’s own row vs the bake, phase-locked' });
  const refWrap = h('div', { style: 'display:flex;gap:18px;align-items:flex-start' });
  refWrap.append(refLpcView.col, refBakeView.col);
  const refReadout = h('div', { class: 'sg-accent', style: 'font-size:11px;line-height:1.6;white-space:pre' });
  const refCaption = h('div', {
    class: 'sg-muted',
    style: 'font-size:10px;line-height:1.5;max-width:560px',
    text:
      'A different artist’s cycle, scored for instrumentation only — NOT a gate. '
      + 'IoU and Δcolour say whether a change moved the bake toward or away from a hand-drawn answer; '
      + 'the bar is still whether it reads right at 32px.',
  });
  main.append(refEyebrow, refWrap, refReadout, refCaption);

  /** Paint one reference-lane column at the shared zoom. */
  function drawRefInto(
    view: { big: HTMLCanvasElement; small: HTMLCanvasElement },
    big: SpriteCanvas | undefined,
    small: SpriteCanvas | undefined,
  ): void {
    const z = state.zoom;
    const size = workTemplate.cell * z;
    if (view.big.width !== size) {
      view.big.width = size;
      view.big.height = size;
    }
    const g = view.big.getContext('2d');
    if (g) {
      g.imageSmoothingEnabled = false;
      checker(g, size, size, 8 * z);
      if (big) g.drawImage(big as CanvasImageSource, 0, 0, size, size);
    }
    const gs = view.small.getContext('2d');
    if (gs) {
      gs.imageSmoothingEnabled = false;
      checker(gs, view.small.width, view.small.height, 8);
      if (small) gs.drawImage(small as CanvasImageSource, 0, 0, GAME_PX * 2, GAME_PX * 2);
    }
  }

  function drawReference(): void {
    const ri = refIndexForFrame(state.frame);
    drawRefInto(refLpcView, refBig[ri], refSmall[ri]);
    drawRefInto(refBakeView, shownFrames[state.frame], gameFrames[state.frame]);
    refLpcView.lbl.textContent = refRasters.length === 0
      ? `${refRow} — not vendored for this stack`
      : `LPC ${refRow} · cell ${ri + 1}/${refRasters.length}`;
    refBakeView.lbl.textContent = `bake ${workClip.name} · frame ${state.frame + 1}/${frames.length}`;
    const c = refPerFrame[state.frame];
    if (c === null || c === undefined) {
      refReadout.textContent = 'no reference cell to score against';
      return;
    }
    const span = refShiftScores.length > 1 ? Math.max(...refShiftScores) - Math.min(...refShiftScores) : 0;
    refReadout.textContent =
      `frame  IoU ${c.iou.toFixed(3)} · Δcolour ${c.colorDelta.toFixed(1)} over ${c.overlapPx}px\n`
      + (refMean ? `clip   IoU ${refMean.iou.toFixed(3)} · Δcolour ${refMean.colorDelta.toFixed(1)} (mean over ${bakeCycleLength()} poses)\n` : 'clip   —\n')
      + `align  +${refShift}${refShiftAuto ? ' (auto)' : ''} of ${refShiftScores.length}`
      + ` · IoU spans only ${span.toFixed(3)} across all shifts — the alignment is barely determined`;
  }

  // ── motion metrics: what the capture says, and what the feet actually do ────
  //
  // Two numbers the bench exists to surface, neither of which it resolves:
  //
  // 1. GROUND SPEED. An in-place bake's stance sole slides one stride per cycle
  //    by design, and reads as planted only when the NPC travels at the clip's
  //    own speed. So the clip's stride/duration is compared against the shipped
  //    NPC_WALK_SPEED at the runtime cadence the rig rows actually play at
  //    (FRAME_MS), not at the capture's. A gap here is a real open question —
  //    retime the clip, or move the NPC — and a human picks.
  // 2. FOOT SKATE. The designed slide is removed first (`skate` detrends), so
  //    what is left is the shiver no playback rate can fix.
  const SOLE_POINTS: Record<string, readonly [number, number]> = {
    // South/north boots: the plant points the authored clips already nail.
    legL_fore: [24.5, 62],
    legR_fore: [39.5, 62],
    // West profile soles, read off the same recon the template was.
    legNear_fore: [27.5, 60],
    legFar_fore: [35.5, 60],
  };

  const metricsBox = h('div', {
    class: 'sg-muted',
    style: 'font-size:10px;line-height:1.6;white-space:pre;max-width:560px',
  });
  main.append(h('div', { class: 'sg-eyebrow', style: 'margin-top:6px', text: 'Motion metrics' }), metricsBox);

  function updateMotionMetrics(): void {
    const lines: string[] = [];
    const meta = importedMetaFor(facing, sourceClip);
    if (meta) {
      // The rig rows play at FRAME_MS per column, so the cycle the PLAYER sees
      // is (frames-1) intervals of FRAME_MS — not the capture's own duration.
      const runtimeCycleSec = ((workClip.frames - 1) * FRAME_MS) / 1000;
      const runtimeSpeed = runtimeCycleSec > 0 ? meta.stridePx / runtimeCycleSec : 0;
      const npcSpeed = NPC_WALK_SPEED * TILE_SIZE;
      lines.push(
        `${workClip.name} ← ${meta.source} · ${meta.loop ? 'loops' : 'one-shot'}`,
        `capture  ${meta.cycleSeconds.toFixed(3)}s cycle · ${meta.frameMs.toFixed(1)} ms/frame · stride ${meta.stridePx.toFixed(1)}px`
          + ` → ${meta.groundSpeedPxPerSec.toFixed(1)} px/s`,
        `runtime  ${runtimeCycleSec.toFixed(3)}s cycle at FRAME_MS ${FRAME_MS} → ${runtimeSpeed.toFixed(1)} px/s`,
      );
      if (runtimeSpeed > 0) {
        const ratio = npcSpeed / runtimeSpeed;
        lines.push(
          `NPC      NPC_WALK_SPEED ${NPC_WALK_SPEED} tiles/s × TILE_SIZE ${TILE_SIZE} = ${npcSpeed.toFixed(1)} px/s`,
          `         → the ground moves ${ratio.toFixed(2)}× the feet (${((ratio - 1) * 100).toFixed(0)}% skate)`,
        );
      } else {
        lines.push('NPC      clip does not travel — play it standing still');
      }
    } else {
      lines.push(`${workClip.name} — hand-authored; no capture metadata`);
    }

    // Foot skate, worst sole first. Reported for every sole the facing owns:
    // in an in-place walk each foot takes a turn as the stance one.
    const owned = new Set(workTemplate.chips.map((c) => c.name));
    const soles = Object.entries(SOLE_POINTS).filter(([chip]) => owned.has(chip));
    const reports = soles.map(([chip, point]) => ({ chip, r: skate(chipPointTrack(workTemplate, workClip, chip, point)) }));
    reports.sort((a, b) => b.r.worst - a.r.worst);
    for (const { chip, r } of reports) {
      lines.push(
        `skate    ${chip.padEnd(13)} ${r.worst.toFixed(2)}px worst @ frame ${r.worstFrame + 1}`
          + ` · jitter ${r.jitter.toFixed(2)}px · raw spread ${r.rawSpread.toFixed(2)}px`,
      );
    }
    if (reports.length > 0) {
      lines.push('         (raw spread includes the designed one-stride-per-cycle slide; jitter does not)');
    }

    // In-plane leg travel. A capture walked TOWARD the camera puts nearly all
    // of its leg swing out of plane, so the frontal facings key single-digit
    // degrees where the profile keys tens — which is why a frontal walk reads
    // closer to standing. The projection being honest, not a bad import.
    const thighs = workTemplate.chips.map((c) => c.name).filter((n) => n.startsWith('leg') && n.endsWith('_up'));
    const swings = thighs.map((n) => `${n} ${trackRangeDeg(workClip, n).toFixed(1)}°`);
    if (swings.length > 0) lines.push(`swing    ${swings.join(' · ')} peak-to-peak in plane`);

    metricsBox.textContent = lines.join('\n');
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
    const size = workTemplate.cell * z;
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
    // The reference lane is scrub-locked to the big view — one clock, so a
    // frame you are looking at is always the frame the numbers describe.
    drawReference();
  }

  function drawBones(g: CanvasRenderingContext2D, z: number): void {
    const t = workClip.frames <= 1 ? 0 : state.frame / (workClip.frames - 1);
    const world = chipWorldTransforms(workTemplate, sampleClip(workTemplate, workClip, t));
    workTemplate.chips.forEach((ch, i) => {
      const col = rig.chipColors[i % rig.chipColors.length];
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
    const cw = workTemplate.cell * STRIP_SCALE;
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
    const cw = workTemplate.cell * STRIP_SCALE;
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

  // Rig picker — one button per registered rig. Switching never reloads: it
  // re-runs the selected rig's loadLayers() and rebuilds every piece of UI
  // that depends on chip count / clip list / bone-overlay colors.
  const rigRow = h('div', { class: 'sg-group', style: 'display:flex;margin-bottom:8px' });
  const rigBtns = RIGS.map((r) => {
    const b = h('button', { class: 'sg-btn', style: 'flex:1', text: r.label });
    b.classList.toggle('is-on', r === rig);
    b.onclick = () => void switchRig(r);
    rigRow.appendChild(b);
    return b;
  });
  panel.appendChild(rigRow);

  // Facing picker — one button per authored view, hidden for a rig that has
  // only one (the code-drawn quadrupeds). Switching swaps template AND clip
  // list, so it rebuilds the same controls a rig switch does; it does NOT
  // reload layers, because the wardrobe is unchanged.
  const facingRow = h('div', { class: 'sg-group', style: 'display:flex;margin-bottom:8px' });
  // Rebuilt rather than re-flagged: the button SET changes with the rig (three
  // humanoid views, one quadruped), so there is no stable list to toggle.
  function buildFacingRow(): void {
    facingRow.replaceChildren();
    facingRow.style.display = rig.facings.length > 1 ? 'flex' : 'none';
    for (const f of rig.facings) {
      const b = h('button', { class: 'sg-btn', style: 'flex:1', text: f.label });
      b.classList.toggle('is-on', f === facing);
      b.onclick = () => switchFacing(f);
      facingRow.appendChild(b);
    }
  }
  buildFacingRow();
  panel.appendChild(facingRow);

  const clipSel = h('select', { class: 'sg-select', style: 'width:100%;margin-bottom:8px' }) as HTMLSelectElement;
  function buildClipOptions(): void {
    clipSel.replaceChildren();
    facing.clips.forEach((c, i) => clipSel.appendChild(h('option', { text: c.name, attrs: { value: String(i) } })));
    clipSel.value = '0';
  }
  buildClipOptions();
  clipSel.onchange = () => {
    state.clipIdx = +clipSel.value;
    sourceClip = facing.clips[state.clipIdx];
    workClip = cloneClip(sourceClip);
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
      sourceClip = facing.clips[state.clipIdx];
      workClip = cloneClip(sourceClip);
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
  let pinChipBtns: HTMLButtonElement[] = [];
  function buildPinChipButtons(): void {
    pinChipRow.replaceChildren();
    pinChipBtns = workTemplate.chips.map((ch, i) => {
      const b = h('button', {
        class: 'sg-btn',
        style: `flex:1 1 45%;font-size:10px;border-left:3px solid ${rig.chipColors[i % rig.chipColors.length]}`,
        text: ch.name,
      });
      b.classList.toggle('is-on', i === pin.chip);
      b.onclick = () => selectPinChip(i);
      pinChipRow.appendChild(b);
      return b;
    });
  }
  buildPinChipButtons();
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
      ch.pivot = [facing.template.chips[i].pivot[0], facing.template.chips[i].pivot[1]];
    });
    updateJointReadout();
    rebake();
  };
  // Export pinned joints as the source-of-truth const block for lpc-humanoid.ts
  // — "saving" a template edit means landing it in code, not in browser state.
  // (Humanoid chip-name → const-name map; a rig whose chips don't use these
  // names simply copies nothing for that chip — harmless, not an error.)
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

  // ── character: preview any role's seeded wardrobe on the rig (humanoid only) ─
  // Layer stacks come from the game's own role recipes (buildCharacterSpec) —
  // same sheets the runtime compositor loads, so what bakes here is worn there.
  interface CharLayer {
    path: string;
    fallback?: string;
    assign?: string;
    label: string;
  }
  const DEFAULT_LABELS = ['body', 'shirt', 'head', 'face', 'hair'];
  const defaultCharacter = (): CharLayer[] =>
    DEFAULT_HUMANOID_LAYERS.map((s, i) => ({ path: s.path, assign: s.assign, label: DEFAULT_LABELS[i] ?? `layer ${i}` }));
  // Wardrobe stack + paint order come from the shared resolver the RUNTIME rig
  // bake uses (`humanoidLayerSpecs`), so what bakes in here is what the game
  // wears; the studio only adds a row label.
  const characterLayers = (spec: CharacterSpec): CharLayer[] =>
    humanoidLayerSpecs(spec).map((l) => ({ ...l, label: l.key }));

  const characterSection = h('div', {});
  panel.appendChild(characterSection);
  characterSection.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin:12px 0 6px', text: 'Character' }));
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
  characterSection.append(
    roleRow,
    rerollBtn,
    h('div', {
      class: 'sg-muted',
      style: 'font-size:10px;line-height:1.5;margin-bottom:5px',
      text: 'seed picks sex/hair/outfit like in-game · chips are tuned on the male body — female/child are approximate',
    }),
  );

  // ── visibility: source layers + chips ───────────────────────────────────────
  panel.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin:12px 0 6px', text: 'Visibility' }));
  const layerRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:5px' });
  function rebuildLayerRow(labels: readonly string[]): void {
    layerRow.replaceChildren();
    labels.forEach((label, i) => {
      const b = h('button', { class: 'sg-btn is-on', style: 'flex:1 1 30%;font-size:10px', text: label });
      b.onclick = () => {
        if (hiddenLayers.has(i)) hiddenLayers.delete(i);
        else hiddenLayers.add(i);
        b.classList.toggle('is-on', !hiddenLayers.has(i));
        rebuildWalkLane();
        // Both vendored lanes composite from the same visible-layer set as the
        // bake — hiding the shirt on one side only would score a costume change.
        rebuildReferenceLane();
        rebake();
        drawGait();
      };
      layerRow.appendChild(b);
    });
  }
  const chipVisRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:5px' });
  function buildChipVisRow(): void {
    chipVisRow.replaceChildren();
    workTemplate.chips.forEach((ch, i) => {
      const b = h('button', {
        class: 'sg-btn is-on',
        style: `flex:1 1 45%;font-size:10px;border-left:3px solid ${rig.chipColors[i % rig.chipColors.length]}`,
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
  }
  buildChipVisRow();
  panel.append(
    h('div', { class: 'sg-muted', style: 'font-size:10px;margin-bottom:3px', text: 'layers' }),
    layerRow,
    h('div', { class: 'sg-muted', style: 'font-size:10px;margin-bottom:3px', text: 'chips (hidden = hole)' }),
    chipVisRow,
  );

  const gaitPanelSection = h('div', {});
  panel.appendChild(gaitPanelSection);
  gaitPanelSection.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin:12px 0 6px', text: 'Gait (walk cycle)' }));
  const gaitRow = h('div', { class: 'sg-group', style: 'display:flex;margin-bottom:4px' });
  const gaitBtns = GAIT_STYLES.map((s) => {
    const b = h('button', { class: 'sg-btn', style: 'flex:1', text: s.name });
    b.classList.toggle('is-on', s === gaitStyle);
    b.onclick = () => {
      gaitStyle = s;
      styledPlan = planGait(s, walkColCount, FRAME_MS);
      gaitClock = 0;
      gaitStyledView.lbl.textContent = `walk · ${s.name}`;
      gaitBtns.forEach((bb, i) => bb.classList.toggle('is-on', GAIT_STYLES[i] === s));
      drawGait();
    };
    gaitRow.appendChild(b);
    return b;
  });
  gaitPanelSection.appendChild(gaitRow);
  gaitPanelSection.appendChild(
    h('div', {
      class: 'sg-muted',
      style: 'font-size:10px;line-height:1.5;margin-bottom:6px',
      text: 'runtime-style playback of the untouched walk sheet — styled loop vs normal cadence',
    }),
  );

  // ── reference-row picker (humanoid only) ────────────────────────────────────
  // Which LPC row the bake is held against is STATED, not guessed: a walk bake
  // scored against the slash row would read as a catastrophe that isn't one.
  const refPanelSection = h('div', {});
  panel.appendChild(refPanelSection);
  refPanelSection.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin:12px 0 6px', text: 'Reference row' }));
  const refBtnRow = h('div', { class: 'sg-group', style: 'display:flex;flex-wrap:wrap;margin-bottom:4px' });
  const refBtns = REF_ROWS.map((name) => {
    const b = h('button', { class: 'sg-btn', style: 'flex:1 1 30%;font-size:10px', text: name });
    b.classList.toggle('is-on', name === refRow);
    b.onclick = () => {
      refRow = name;
      refBtns.forEach((bb, i) => bb.classList.toggle('is-on', REF_ROWS[i] === refRow));
      void loadReferenceSheets();
    };
    refBtnRow.appendChild(b);
    return b;
  });
  refPanelSection.appendChild(refBtnRow);

  // Phase alignment. Auto by best mean IoU so the readout matches the offline
  // contact sheet (`scripts/motion-contact-sheet.ts`), steppable because that
  // "best" wins by ~0.01 and a human eye is the better discriminator.
  const alignRow = h('div', { class: 'sg-group', style: 'display:flex;margin-bottom:4px' });
  const autoAlignBtn = h('button', { class: 'sg-btn is-on', style: 'flex:1', text: 'auto' });
  const stepAlign = (d: number): void => {
    const n = refShiftScores.length;
    if (n === 0) return;
    refShiftAuto = false;
    autoAlignBtn.classList.remove('is-on');
    refShift = ((refShift + d) % n + n) % n;
    measureReference();
    drawReference();
  };
  autoAlignBtn.onclick = () => {
    refShiftAuto = !refShiftAuto;
    autoAlignBtn.classList.toggle('is-on', refShiftAuto);
    measureReference();
    drawReference();
  };
  const alignPrev = h('button', { class: 'sg-btn', style: 'flex:1', text: '◀ phase' });
  alignPrev.onclick = () => stepAlign(-1);
  const alignNext = h('button', { class: 'sg-btn', style: 'flex:1', text: 'phase ▶' });
  alignNext.onclick = () => stepAlign(1);
  alignRow.append(alignPrev, autoAlignBtn, alignNext);
  refPanelSection.appendChild(alignRow);

  /**
   * Show/hide the humanoid-only Character + Gait + Reference panels together.
   *
   * GOTCHA: `style.display = ''` REMOVES the property rather than restoring it,
   * so an element whose cssText declared `display:flex` reverts to `block` and
   * its row silently stacks into a column. The gait lane's two views had been
   * doing exactly that since it was written. Each element's authored display is
   * captured here, once, and put back verbatim.
   */
  const humanoidExtras = [
    characterSection, gaitPanelSection, gaitEyebrow, gaitWrap,
    refPanelSection, refEyebrow, refWrap, refReadout, refCaption,
  ].map((el) => [el, el.style.display] as const);
  function setHumanoidExtrasVisible(show: boolean): void {
    for (const [el, display] of humanoidExtras) el.style.display = show ? display : 'none';
  }

  const metaLbl = h('div', {
    class: 'sg-muted',
    style: 'margin-top:10px;font-size:10px;line-height:1.5',
    text: `template ${facing.template.name} · ${facing.template.chips.length} chips`,
  });
  panel.appendChild(metaLbl);

  function updateMetaLabel(layerCount?: number): void {
    metaLbl.textContent =
      `template ${facing.template.name} · ${facing.template.chips.length} chips · ${facing.label.toLowerCase()} facing`
      + (layerCount === undefined ? '' : ` · layers ×${layerCount}`);
  }

  // ── load: a generation counter shared by both load paths below, so a rig
  // switch mid-flight (either kind) supersedes a stale in-flight load. ────────
  const loading = h('div', { class: 'sg-muted', style: 'font-size:11px', text: 'loading rig layers…' });
  let loadGen = 0;
  let loadedLayerCount: number | undefined;

  /** Humanoid path: fetch/decode a wardrobe stack (default or role-picked) via
   *  the shared rig-catalog loader, keeping the raw sheets for the gait and
   *  reference lanes (both composite vendored cells straight off them). */
  async function loadCharacter(charLayers: CharLayer[]): Promise<void> {
    const gen = ++loadGen;
    loading.textContent = 'loading LPC layers…';
    main.prepend(loading);
    try {
      // `resolved`, not `charLayers`: a layer the vendored set doesn't carry
      // (the child face) is dropped, and the row labels must follow the stack.
      const { layers: loaded, sheets, resolved } = await loadHumanoidCharacter(charLayers);
      if (disposed || gen !== loadGen) return;
      baseLayers = loaded;
      loadedSheets = sheets;
      loadedSpecs = resolved;
      loadedLayerCount = resolved.length;
      refSheetCache.clear(); // sibling anim sheets belong to THIS wardrobe
      hiddenLayers.clear();
      applyFacingToLayers();
      rebuildLayerRow(resolved.map((c) => c.label));
      rebuildWalkLane();
      updateMetaLabel(loadedLayerCount);
      loading.remove();
      rebake();
      drawGait();
      void loadReferenceSheets();
    } catch (err) {
      if (gen !== loadGen) return;
      loading.textContent = `✕ layer load failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Non-humanoid path: whatever the rig's own loadLayers() resolves — no
   *  wardrobe roles, no gait/reference lane, labels derived per layer. */
  async function loadGenericRig(r: RigEntry): Promise<void> {
    const gen = ++loadGen;
    loading.textContent = `loading ${r.label} layers…`;
    main.prepend(loading);
    try {
      const loaded = await r.loadLayers();
      if (disposed || gen !== loadGen) return;
      baseLayers = loaded;
      loadedSheets = null;
      loadedSpecs = null;
      loadedLayerCount = undefined;
      refSheetCache.clear();
      refSheets = null;
      hiddenLayers.clear();
      applyFacingToLayers();
      rebuildLayerRow(loaded.map((l, i) => l.assign ?? `layer ${i}`));
      rebuildReferenceLane();
      updateMetaLabel();
      loading.remove();
      rebake();
    } catch (err) {
      if (gen !== loadGen) return;
      loading.textContent = `✕ layer load failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Rebuild every control whose shape follows the active template + clip list.
   *  Shared by the rig and facing switches: both change chip count, chip names
   *  and the offered clips, and the two used to drift apart when only one of
   *  them remembered a control. */
  function rebuildFacingDerivedControls(): void {
    workTemplate = cloneTemplate(facing.template);
    sourceClip = facing.clips[0];
    workClip = cloneClip(sourceClip);
    state.clipIdx = 0;
    state.frame = 0;
    pin.on = false;
    pin.chip = defaultPinChip(facing.template);
    pinBtn.classList.remove('is-on');
    pinChipRow.style.display = 'none';
    hiddenChips.clear();

    buildFacingRow();
    buildClipOptions();
    buildPoseSliders();
    buildPinChipButtons();
    buildChipVisRow();
    updateJointReadout();
  }

  /** Switch the active rig: reset clip/frame/pin/hidden state, rebuild every
   *  chip-count/clip-list-derived control, then reload layers in place — the
   *  studio never reloads. A stale in-flight load (either path) is superseded
   *  by `loadGen`, and `disposed` still wins if the studio is torn down first. */
  async function switchRig(next: RigEntry): Promise<void> {
    if (disposed || next === rig) return;
    rig = next;
    facing = rig.facings[0];
    hiddenLayers.clear();
    walkBig.length = 0;
    walkSmall.length = 0;
    loadedSheets = null;
    rebuildFacingDerivedControls();

    rigBtns.forEach((b, i) => b.classList.toggle('is-on', RIGS[i] === rig));

    const isHumanoid = rig.id === 'humanoid';
    setHumanoidExtrasVisible(isHumanoid);
    if (isHumanoid) {
      charState.role = null;
      charState.seed = 1;
      roleBtns.forEach((b, i) => b.classList.toggle('is-on', ROLES[i] === null));
      rerollBtn.textContent = '⟳ Reroll (seed 1)';
      await loadCharacter(defaultCharacter());
    } else {
      await loadGenericRig(rig);
    }
  }

  /** Switch the active facing WITHOUT touching the network: same wardrobe, a
   *  different row of the same already-decoded sheets. Layer visibility is kept
   *  (the stack is unchanged); everything template-shaped is rebuilt.
   *  Deliberately does NOT bump `loadGen`: an in-flight wardrobe load is still
   *  wanted, and it re-slices against whatever facing is current when it lands. */
  function switchFacing(next: RigFacingEntry): void {
    if (disposed || next === facing) return;
    facing = next;
    rebuildFacingDerivedControls();
    applyFacingToLayers();
    rebuildWalkLane();
    rebuildReferenceLane();
    updateMetaLabel(loadedLayerCount);
    rebake();
    drawGait();
  }

  // ── boot: load the default (first) rig's default character/layers ──────────
  setHumanoidExtrasVisible(rig.id === 'humanoid');
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
