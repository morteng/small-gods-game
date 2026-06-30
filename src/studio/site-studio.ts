// src/studio/site-studio.ts
//
// 🏰 SITE studio — the mid-scale connectome harness. Object studio studies ONE building;
// World studio studies the WHOLE island; this studies a SITE: a defended complex (a
// motte-and-bailey, a ringwork) dropped on a patch of real terrain, so the interactions
// the other two can't show — earthwork carve + ring barriers + gates + building placement
// vs terrain — are all visible together at a legible scale, and the connectome linter runs
// on it in isolation.
//
// It composes shipped pieces: generateWithNoise (the patch), placeComplexOnPatch (the
// DC-2/DC-3 placement: earthworks → terrain, rings → lit barriers, keep+bailey → buildings),
// the GPU scene (createGpuRenderMap), and evaluateConnectome (the linter). The fort/complex
// grammar (expandComplex/siteComplex/deriveEarthworks) was fully built + tested but never
// rendered anywhere — this is where it first becomes visible.

import type { RenderContext, Camera, GameMap, Entity, WorldSeed } from '@/core/types';
import { World } from '@/world/world';
import { generateWithNoise } from '@/map/map-generator';
import { Autotiler } from '@/map/autotiler';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
import { createGpuRenderMap } from '@/render/gpu/gpu-renderer';
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import { ParametricPlantSource } from '@/render/parametric-plant-source';
import { ParametricBarrierSource } from '@/render/parametric-barrier-source';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';
import { evaluateConnectome, type Diagnostic } from '@/world/connectome-diagnostics';
import { placeComplexOnPatch } from '@/world/place-complex';
import { heightMetresAt } from '@/world/heightfield';
import { WATER_TYPES } from '@/core/constants';
import { catalogue } from '@/catalogue/pack';
import { loadDefaultPacks } from '@/catalogue/default-packs';
import { injectStudioTheme, COLORS, h } from './theme';

export interface StudioHandle { dispose(): void; }

const HALF_W = ISO_TILE_W / 2;
const HALF_H = ISO_TILE_H / 2;
const PATCH = 56; // tiles square — big enough for the outer ditch + approach, small enough to read

/** Iso screen extent (pre-camera) of a tile rect; fit the camera to it. */
function fitTiles(cam: Camera, minTx: number, minTy: number, maxTx: number, maxTy: number, vw: number, vh: number, margin = 0.9): void {
  const corners = [[minTx, minTy], [maxTx, minTy], [minTx, maxTy], [maxTx, maxTy]];
  const xs = corners.map(([x, y]) => (x - y) * HALF_W);
  const ys = corners.map(([x, y]) => (x + y) * HALF_H);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(1, maxX - minX), hh = Math.max(1, maxY - minY);
  cam.zoom = Math.max(0.02, Math.min(8, Math.min(vw / w, vh / hh) * margin));
  cam.x = (minX + maxX) / 2 - (vw / 2) / cam.zoom;
  cam.y = (minY + maxY) / 2 - (vh / 2) / cam.zoom;
}

/** Is (x,y) open water on the map? */
function isWater(map: GameMap, x: number, y: number): boolean {
  const t = map.tiles?.[y]?.[x];
  return !!t && WATER_TYPES.has(t.type);
}

/**
 * Pick the seat for a complex. Two realities a real builder respects:
 *   1. The building footprint (the keep + bailey ring, radius INNER_R) sits on DRY land —
 *      you don't raise a keep mid-river.
 *   2. But you build BESIDE the water, not away from it: a river flank is a wet moat, a
 *      water supply and a transport/defence edge. So among dry-footprint seats, prefer one
 *      with water NEARBY (just beyond the ring) — riverside, not river-straddling.
 * Score = innerLandFraction + a riverside bonus; ties break to the lowest (a motte is then
 * genuinely needed) or highest (commanding) ground per the toggle. This mirrors the
 * connectome's own defensive affordance (water-adjacency is a siting asset), kept crude here.
 */
function pickSeat(map: GameMap, lowGround: boolean): { x: number; y: number } {
  const W = map.width, H = map.height;
  const INNER_R = 14;          // keep + bailey building ring — must be dry
  const NEAR_R = 22;           // water within this (beyond the ring) = a riverside seat
  const margin = INNER_R + 2;
  const innerLandFraction = (cx: number, cy: number): number => {
    let land = 0, total = 0;
    for (let dy = -INNER_R; dy <= INNER_R; dy++) for (let dx = -INNER_R; dx <= INNER_R; dx++) {
      if (dx * dx + dy * dy > INNER_R * INNER_R) continue;
      total++; if (!isWater(map, cx + dx, cy + dy)) land++;
    }
    return total ? land / total : 0;
  };
  // 0 (no water within NEAR_R) … 1 (water right at the ring edge) — closer water = better moat.
  const riverside = (cx: number, cy: number): number => {
    let nearest = Infinity;
    for (let dy = -NEAR_R; dy <= NEAR_R; dy++) for (let dx = -NEAR_R; dx <= NEAR_R; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= INNER_R || d > NEAR_R) continue;
      if (isWater(map, cx + dx, cy + dy)) { nearest = Math.min(nearest, d); }
    }
    return nearest === Infinity ? 0 : 1 - (nearest - INNER_R) / (NEAR_R - INNER_R);
  };
  let best = { x: (W / 2) | 0, y: (H / 2) | 0 };
  let bestScore = -Infinity, bestH = lowGround ? Infinity : -Infinity;
  const EPS = 0.01;
  for (let y = margin; y < H - margin; y++) for (let x = margin; x < W - margin; x++) {
    if (isWater(map, x, y)) continue;                 // the keep itself must be dry
    const score = innerLandFraction(x, y) + 0.25 * riverside(x, y);
    const hh = heightMetresAt(map, x, y);
    const better = score > bestScore + EPS;
    const tie = Math.abs(score - bestScore) <= EPS && (lowGround ? hh < bestH : hh > bestH);
    if (better || tie) { bestScore = score; bestH = hh; best = { x, y }; }
  }
  return best;
}

export function mountSiteStudio(container: HTMLElement): StudioHandle {
  let disposed = false;
  let rafId = 0;
  let ro: ResizeObserver | null = null;
  const ac = new AbortController();
  const { signal } = ac;
  const dispose = (): void => { disposed = true; cancelAnimationFrame(rafId); ac.abort(); ro?.disconnect(); };

  void (async () => {
    ensureBuildingTypesRegistered();
    initManifoldWasm();
    loadDefaultPacks();

    container.style.position = 'relative';
    container.style.background = COLORS.bg0;
    injectStudioTheme(container);

    // ── scaffold: [controls | view] ──────────────────────────────────────────
    const root = h('div', { style: 'position:absolute;inset:0;display:flex;flex-direction:row;overflow:hidden' });
    const panel = h('div', { class: 'sg-panel', style: 'flex:0 0 auto;width:264px;border-right:1px solid var(--line);overflow:auto;padding:12px' });
    const viewPane = h('div', { style: 'position:relative;flex:1 1 auto;min-width:0;overflow:hidden' });
    root.append(panel, viewPane);
    container.appendChild(root);

    const sceneCanvas = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0' }) as HTMLCanvasElement;
    const canvas = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;z-index:1' }) as HTMLCanvasElement;
    viewPane.append(sceneCanvas, canvas);
    const ctx = canvas.getContext('2d')!;

    // ── controls ──────────────────────────────────────────────────────────────
    panel.appendChild(h('div', { style: 'font:700 13px var(--font-mono);color:#e8eef6;margin-bottom:10px', text: '🏰 Site studio' }));
    panel.appendChild(h('div', { class: 'sg-muted', style: 'font:400 11px var(--font-mono);line-height:1.5;margin-bottom:12px',
      text: 'A defended complex on a terrain patch — earthworks, ring barriers, gates and buildings, with the connectome linter.' }));

    const archetypes = catalogue.all('complexType').map((e) => e.id);
    const gen = { archetype: archetypes.includes('motte_and_bailey') ? 'motte_and_bailey' : (archetypes[0] ?? ''), seed: 0x5170, lowGround: true };

    const label = (t: string): HTMLElement => h('div', { class: 'sg-muted', style: 'font:600 10px var(--font-mono);letter-spacing:.06em;text-transform:uppercase;margin:10px 0 4px', text: t });
    const FIELD = 'width:100%;background:var(--bg-1);color:var(--ink-0);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:500 12px var(--font-mono)';

    panel.appendChild(label('Archetype'));
    const sel = h('select', { style: FIELD }) as HTMLSelectElement;
    for (const a of archetypes) sel.appendChild(h('option', { attrs: { value: a }, text: a.replace(/_/g, ' ') }));
    sel.value = gen.archetype;
    sel.onchange = () => { gen.archetype = sel.value; void regenerate(); };
    panel.appendChild(sel);

    panel.appendChild(label('Seed'));
    const seedRow = h('div', { style: 'display:flex;gap:6px' });
    const seedInput = h('input', { style: FIELD }) as HTMLInputElement;
    seedInput.type = 'number'; seedInput.value = String(gen.seed);
    seedInput.onchange = () => { gen.seed = (parseInt(seedInput.value, 10) || 0) >>> 0; void regenerate(); };
    const reroll = h('button', { class: 'sg-btn', style: 'flex:0 0 auto;white-space:nowrap', text: '🎲' });
    reroll.onclick = () => { gen.seed = (gen.seed * 1103515245 + 12345) >>> 0; seedInput.value = String(gen.seed); void regenerate(); };
    seedRow.append(seedInput, reroll); panel.appendChild(seedRow);

    const lowRow = h('label', { style: 'display:flex;align-items:center;gap:7px;margin-top:12px;cursor:pointer;font:500 11px var(--font-mono);color:var(--ink-0)' });
    const lowChk = h('input', {}) as HTMLInputElement; lowChk.type = 'checkbox'; lowChk.checked = gen.lowGround;
    lowChk.onchange = () => { gen.lowGround = lowChk.checked; void regenerate(); };
    lowRow.append(lowChk, h('span', { text: 'Seat on low ground (build the motte)' })); panel.appendChild(lowRow);

    const regenBtn = h('button', { class: 'sg-btn', style: 'width:100%;margin-top:14px', text: '↻ Regenerate' });
    regenBtn.onclick = () => void regenerate(); panel.appendChild(regenBtn);

    panel.appendChild(label('Placed'));
    const placedBox = h('div', { class: 'sg-muted', style: 'font:400 11px var(--font-mono);line-height:1.6;white-space:pre-wrap' });
    panel.appendChild(placedBox);

    panel.appendChild(label('Diagnostics'));
    const diagBox = h('div', { style: 'font:400 11px var(--font-mono);line-height:1.55;white-space:pre-wrap' });
    panel.appendChild(diagBox);

    // ── render state ────────────────────────────────────────────────────────────
    let map: GameMap = null as unknown as GameMap;
    let world = new World({ tiles: [], width: 0, height: 0, villages: [], seed: 0, success: false, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap);
    let visualMap: ReturnType<typeof Autotiler.computeVisualMap> | null = null;
    let regenToken = 0;
    const lighting = { ...DEFAULT_LIGHTING };
    const cam: Camera = { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 };
    const dev: Record<string, unknown> = {};

    const buildingSource = new ParametricBuildingSource();
    const plantSource = new ParametricPlantSource();
    const barrierSource = new ParametricBarrierSource();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cssW = 0, cssH = 0;
    function resize(): void {
      const r = viewPane.getBoundingClientRect();
      cssW = Math.max(1, Math.floor(r.width));
      cssH = Math.max(1, Math.floor(r.height));
      canvas.width = sceneCanvas.width = Math.floor(cssW * dpr);
      canvas.height = sceneCanvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    ro = new ResizeObserver(resize); ro.observe(viewPane);

    // ── pan + zoom ───────────────────────────────────────────────────────────────
    canvas.addEventListener('mousedown', (e) => { cam.dragging = true; cam.lastX = e.clientX; cam.lastY = e.clientY; canvas.style.cursor = 'grabbing'; }, { signal });
    window.addEventListener('mouseup', () => { cam.dragging = false; canvas.style.cursor = 'grab'; }, { signal });
    window.addEventListener('mousemove', (e) => {
      if (!cam.dragging) return;
      cam.x -= (e.clientX - cam.lastX) / cam.zoom;
      cam.y -= (e.clientY - cam.lastY) / cam.zoom;
      cam.lastX = e.clientX; cam.lastY = e.clientY;
    }, { signal });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      cam.zoom = Math.max(0.02, Math.min(8, cam.zoom * f));
    }, { signal, passive: false });

    // ── regenerate ────────────────────────────────────────────────────────────────
    async function regenerate(refit = true): Promise<void> {
      const token = ++regenToken;
      const ws: WorldSeed = { name: 'site-patch', size: { width: PATCH, height: PATCH }, biome: 'temperate', pois: [], connections: [], constraints: [] } as unknown as WorldSeed;
      const res = await generateWithNoise(PATCH, PATCH, gen.seed, ws);
      if (disposed || token !== regenToken) return;
      map = res.map; world = res.world;

      // Choose the seat. A site must sit on DRY, buildable ground whose bailey disc is land
      // (else the keep + buildings land in the river — exactly what the linter flags). Among
      // those candidates, "build the motte" wants the LOWEST (so a mound is needed); otherwise
      // take the most COMMANDING (highest) ground a fort would naturally pick.
      const centre = pickSeat(map, gen.lowGround);

      const placed = placeComplexOnPatch(world, map, { complexTypeId: gen.archetype, centre, seed: gen.seed, era: 'medieval' });
      visualMap = Autotiler.computeVisualMap(map);
      if (refit) fitTiles(cam, 0, 0, map.width, map.height, cssW, cssH);

      const ew = placed.placed?.earthworks ?? [];
      const motte = ew.find((e) => e.kind === 'motte');
      placedBox.textContent =
        `${gen.archetype.replace(/_/g, ' ')} @ ${centre.x},${centre.y}\n` +
        `ground ${heightMetresAt(map, centre.x, centre.y).toFixed(1)} m\n` +
        `rings ${placed.barriers.length} · buildings ${placed.buildingIds.length}\n` +
        `earthworks ${ew.length}${motte ? ` · motte +${motte.height.toFixed(1)} m` : ' · no motte (hill)'}` +
        (placed.skippedBuildings.length ? `\n⚠ unresolved: ${placed.skippedBuildings.join(', ')}` : '');

      refreshDiagnostics();
    }

    function refreshDiagnostics(): void {
      let ds: Diagnostic[] = [];
      try { ds = evaluateConnectome({ world, map }).diagnostics; } catch { /* linter is best-effort */ }
      if (!ds.length) { diagBox.innerHTML = '<span style="color:#7bd88f">✓ no issues</span>'; return; }
      const sev: Record<string, string> = { error: '#ff6b6b', warn: '#ffd166', info: '#8ab4f8' };
      diagBox.replaceChildren();
      for (const d of ds.slice(0, 10)) {
        diagBox.appendChild(h('div', { style: `color:${sev[d.severity] ?? '#aaa'}`, text: `• ${d.rule}: ${d.message}` }));
      }
      if (ds.length > 10) diagBox.appendChild(h('div', { class: 'sg-muted', text: `… +${ds.length - 10} more` }));
    }

    // ── GPU renderer + frame loop ───────────────────────────────────────────────
    const { render } = await createGpuRenderMap({ canvas: sceneCanvas });
    if (disposed) return;

    function renderContext(): RenderContext {
      return {
        map, camera: cam, canvasWidth: cssW, canvasHeight: cssH,
        npcs: [], npcSheets: new Map(),
        world, lighting, visualMap: visualMap ?? undefined,
        devMode: dev as unknown,
        resolveParametricBuildingArt: (e: Entity) => { const s = buildingSource.peek(e); if (s) return s; buildingSource.warm(e); return null; },
        resolveParametricPlantArt: (kind: string) => { const s = plantSource.peek(kind); if (s) return s; plantSource.warm(kind); return null; },
        resolveParametricBarrierArt: (e: Entity) => { const s = barrierSource.peek(e); if (s) return s; barrierSource.warm(e); return null; },
        studioNoChrome: true,
      } as unknown as RenderContext;
    }
    function frame(): void {
      if (disposed) return;
      if (map) {
        const rc = renderContext();
        render(ctx, rc);
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    await regenerate(true);

    (window as unknown as { __siteStudio?: unknown }).__siteStudio = {
      regen: (seed?: number) => { if (seed != null) { gen.seed = seed >>> 0; seedInput.value = String(gen.seed); } return regenerate(); },
      map: () => map,
      grab: () => {
        const out = document.createElement('canvas');
        out.width = sceneCanvas.width; out.height = sceneCanvas.height;
        const g = out.getContext('2d')!;
        g.drawImage(sceneCanvas, 0, 0); g.drawImage(canvas, 0, 0);
        return out.toDataURL('image/png');
      },
    };
  })();

  return { dispose };
}
