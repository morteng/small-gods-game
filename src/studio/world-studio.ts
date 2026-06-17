// src/studio/world-studio.ts
//
// Studio "world overview" mode (?studio=world): bootstraps the real default world
// and renders it through the GPU/WebGPU renderer with the whole-world connectome
// overlay forced on — POIs, the road/river network, junctions, and settlement
// street graphs over the lifted T1 terrain. A read-only inspection view (pan +
// zoom + fit), separate from the single-object editor in `studio.ts`.
//
// Deliberately uses an EMPTY World(map): the connectome view wants terrain + graph,
// not entity sprites, so it needs no asset library / art resolvers — just the
// seed-driven heightfield + the worldgen graph data on the GameMap.

import type { RenderContext, Camera } from '@/core/types';
import { World } from '@/world/world';
import { WorldManager } from '@/map/world-manager';
import { generateWithNoise } from '@/map/map-generator';
import { planWorldLayout } from '@/world/poi-layout';
import { Autotiler } from '@/map/autotiler';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
import { createGpuRenderMap } from '@/render/gpu/gpu-renderer';
import { drawWorldConnectome } from '@/render/connectome-overlay';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';

const HALF_W = ISO_TILE_W / 2;
const HALF_H = ISO_TILE_H / 2;

/** Fit the camera so the whole iso map fills the viewport (flat-plane bounds). */
function fitWorld(cam: Camera, mapW: number, mapH: number, vw: number, vh: number): void {
  const xs = [0, mapW * HALF_W, -mapH * HALF_W, (mapW - mapH) * HALF_W];
  const ys = [0, mapW * HALF_H, mapH * HALF_H, (mapW + mapH) * HALF_H];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const zoom = Math.min(vw / (maxX - minX), vh / (maxY - minY)) * 0.92;
  cam.zoom = zoom;
  cam.x = (minX + maxX) / 2 - (vw / 2) / zoom;
  cam.y = (minY + maxY) / 2 - (vh / 2) / zoom;
}

export async function mountWorldStudio(container: HTMLElement): Promise<void> {
  ensureBuildingTypesRegistered();
  initManifoldWasm();

  container.style.position = 'relative';
  container.style.background = '#0b0e14';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const title = document.createElement('div');
  title.style.cssText =
    'position:absolute;top:10px;left:12px;z-index:5;font:600 13px ui-sans-serif,system-ui;' +
    'color:#e8eef6;background:rgba(10,14,20,.7);border:1px solid rgba(120,170,220,.25);' +
    'padding:5px 9px;border-radius:6px;pointer-events:none';
  title.textContent = 'World connectome — loading…';
  container.appendChild(title);

  // ── bootstrap the real default world (map only; empty world for the view) ──
  const ws = await WorldManager.loadDefault();
  // W0/W3: derive size + (for island worlds) recentre content. No-op for default.
  const layout = planWorldLayout(ws);
  ws.size = layout.size;
  ws.pois = layout.pois;
  ws.connections = layout.connections;
  const seed = 0x5109; // fixed → reproducible world for inspection
  const { map } = await generateWithNoise(ws.size.width, ws.size.height, seed, ws);
  const world = new World(map);
  const visualMap = Autotiler.computeVisualMap(map);

  const lighting = { ...DEFAULT_LIGHTING };
  const cam: Camera = { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 };

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cssW = 0, cssH = 0;
  function resize(): void {
    const r = container.getBoundingClientRect();
    cssW = Math.max(1, Math.floor(r.width));
    cssH = Math.max(1, Math.floor(r.height));
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  fitWorld(cam, map.width, map.height, cssW, cssH);
  new ResizeObserver(resize).observe(container);

  // ── pan + zoom ────────────────────────────────────────────────────────────
  canvas.addEventListener('mousedown', (e) => { cam.dragging = true; cam.lastX = e.clientX; cam.lastY = e.clientY; canvas.style.cursor = 'grabbing'; });
  window.addEventListener('mouseup', () => { cam.dragging = false; canvas.style.cursor = 'grab'; });
  window.addEventListener('mousemove', (e) => {
    if (!cam.dragging) return;
    cam.x -= (e.clientX - cam.lastX) / cam.zoom;
    cam.y -= (e.clientY - cam.lastY) / cam.zoom;
    cam.lastX = e.clientX; cam.lastY = e.clientY;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = container.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const wx = mx / cam.zoom + cam.x, wy = my / cam.zoom + cam.y;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    cam.zoom = Math.max(0.02, Math.min(4, cam.zoom * factor));
    cam.x = wx - mx / cam.zoom; cam.y = wy - my / cam.zoom;
  }, { passive: false });

  // ── GPU renderer (falls back to Canvas2D iso if WebGPU is unavailable) ─────
  const { render, backend } = await createGpuRenderMap();
  title.textContent = `World connectome — ${ws.name} · ${backend}`;

  function renderContext(): RenderContext {
    return {
      map, camera: cam, canvasWidth: cssW, canvasHeight: cssH,
      npcs: [], npcSheets: new Map(), treeSheets: new Map(),
      world, lighting, visualMap,
    } as unknown as RenderContext;
  }

  function frame(): void {
    const rc = renderContext();
    render(ctx, rc);               // GPU terrain (entity pass is empty)
    drawWorldConnectome(ctx, rc);  // connectome forced on in world mode
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
