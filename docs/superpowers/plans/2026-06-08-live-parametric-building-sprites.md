# Live Parametric Building Sprites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the new manifold parametric building generator in-game by generating each building's sprite at runtime from its `BuildingDescriptor` (cached), drawn through the existing iso sprite path, selectable via a 3-way dev render-mode toggle.

**Architecture:** A pure `descriptorToSpec` maps a `BuildingDescriptor` to an assetgen `StructureSpec`; `composeStructure` (reused) rasterizes it to a grey RGBA buffer + opaque bbox; a `ParametricBuildingSource` (peek/warm cache mirroring `ArtResolver`) crops that to a canvas sprite once per unique descriptor; the iso renderer blits it through a shared sprite-draw core. A browser-only module points the manifold wasm kernel at the Vite-served `manifold.wasm`.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom), manifold-3d (WASM CSG), Canvas2D.

Spec: `docs/superpowers/specs/2026-06-08-live-parametric-building-sprites-design.md`

**Key facts (verified against the code):**
- `composeStructure(spec)` → `{ grey: Uint8ClampedArray, normal, size, meta:{bbox,anchors}, bbox, anchors }`. `grey` is `size*size*4` RGBA, transparent outside the shape.
- `buildingFacets(wings, wallMat='plaster', roofMat='tile', roofStyle='gable', features={}, seed=0)`; per-wing `Wing.roof` (`'gable'|'hip'|'pyramidal'|'flat'`) overrides the building-wide `roofStyle`.
- `Part` building variant: `{ prim:'building'; wings: Wing[]; wallMat?: Mat; roofMat?: Mat; roofStyle?: RoofStyle; features?: BuildingFeatures; seed?: number }`.
- `ArtResolver` contract to mirror: `peek(e): string|null` (sync), `warm(e): void` (fire-and-forget), `clear()`. Cache stores `undefined`=unresolved, value=resolved.
- Render wiring: `src/game.ts` `renderDeps()` (line ~533) builds `RenderContextDeps`; `buildRenderContext` (`src/game/render-context.ts`) turns it into `RenderContext`; `src/render/iso/iso-renderer.ts` lines ~141-149 dispatch building draw.
- `ISO_TILE_W = 128`, `ISO_TILE_H = 64`.
- vitest env is **jsdom**: `document` exists but `canvas.getContext('2d')` returns **null**. Canvas-producing code must return `null` gracefully there; tests inject fakes.

---

### Task 1: Browser-serveable manifold wasm seam

**Files:**
- Modify: `src/assetgen/geometry/manifold-runtime.ts`
- Create: `src/assetgen/geometry/manifold-wasm-browser.ts`
- Test: `tests/unit/manifold-runtime-wasm-url.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/manifold-runtime-wasm-url.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { manifoldModuleOptions, setManifoldWasmUrl, __resetManifoldWasmUrlForTest } from '@/assetgen/geometry/manifold-runtime';

describe('manifold wasm url seam', () => {
  beforeEach(() => __resetManifoldWasmUrlForTest());

  it('returns empty options before a url is set (Node default path)', () => {
    expect(manifoldModuleOptions()).toEqual({});
  });

  it('returns a locateFile that yields the set url after setManifoldWasmUrl', () => {
    setManifoldWasmUrl('/assets/manifold.abc123.wasm');
    const opts = manifoldModuleOptions() as { locateFile?: (p: string) => string };
    expect(typeof opts.locateFile).toBe('function');
    expect(opts.locateFile!('manifold.wasm')).toBe('/assets/manifold.abc123.wasm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/manifold-runtime-wasm-url.test.ts`
Expected: FAIL — `manifoldModuleOptions`/`setManifoldWasmUrl` not exported.

- [ ] **Step 3: Implement the seam in `manifold-runtime.ts`**

Replace the file body with (keeps `getManifold` + `CIRCULAR_SEGMENTS` behavior, routes module options through the new seam):

```ts
// src/assetgen/geometry/manifold-runtime.ts
// Lazy singleton for the manifold-3d WASM CSG kernel. Node locates manifold.wasm
// on the filesystem automatically; the browser must point the Emscripten module at
// the Vite-served wasm via setManifoldWasmUrl() before the first getManifold().
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

/** Tessellation segments for cylinders/spheres — pinned so output is deterministic. */
export const CIRCULAR_SEGMENTS = 32;

let cached: Promise<ManifoldToplevel> | undefined;
let wasmUrl: string | undefined;

/** Browser only: point the Emscripten kernel at the Vite-served wasm URL. No-op for Node. */
export function setManifoldWasmUrl(url: string): void { wasmUrl = url; }

/** Emscripten Module() options — `locateFile` only when a browser url was set. */
export function manifoldModuleOptions(): Record<string, unknown> {
  return wasmUrl ? { locateFile: () => wasmUrl as string } : {};
}

/** Test-only: forget any set url so cases start from the Node default. */
export function __resetManifoldWasmUrlForTest(): void { wasmUrl = undefined; }

/** Resolve the initialised manifold toplevel (cached after first call). */
export function getManifold(): Promise<ManifoldToplevel> {
  if (!cached) {
    cached = Module(manifoldModuleOptions()).then((wasm) => {
      wasm.setup();
      wasm.setCircularSegments(CIRCULAR_SEGMENTS);
      return wasm;
    });
  }
  return cached;
}
```

- [ ] **Step 4: Create the browser-only init module**

```ts
// src/assetgen/geometry/manifold-wasm-browser.ts
// Browser-ONLY. The `?url` import is Vite syntax; Node/vitest must never import this
// file. Call initManifoldWasm() once from the game bootstrap before any generation.
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { setManifoldWasmUrl } from './manifold-runtime';

let done = false;
export function initManifoldWasm(): void {
  if (done) return;
  setManifoldWasmUrl(wasmUrl);
  done = true;
}
```

> **`?url` import types:** if `tsc` errors on `manifold-3d/manifold.wasm?url` ("cannot find module"), the project's Vite client types aren't loaded. Confirm `src/vite-env.d.ts` exists with `/// <reference types="vite/client" />` (it declares `*?url` modules). If missing, create it with that single line. This module is browser-only, so the type only needs to satisfy `tsc`, not run in Node.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/manifold-runtime-wasm-url.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Verify existing manifold consumers still pass**

Run: `npx vitest run tests/unit/assetgen-solids.test.ts`
Expected: PASS (Node default path unchanged — no url set, `manifoldModuleOptions()` is `{}`).

- [ ] **Step 7: Commit**

```bash
git add src/assetgen/geometry/manifold-runtime.ts src/assetgen/geometry/manifold-wasm-browser.ts tests/unit/manifold-runtime-wasm-url.test.ts
git commit -m "feat(assetgen): browser wasm-url seam for manifold runtime"
```

---

### Task 2: `descriptorToSpec` — BuildingDescriptor → StructureSpec

**Files:**
- Create: `src/render/iso/building-spec.ts`
- Test: `tests/unit/building-spec.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/building-spec.test.ts
import { describe, it, expect } from 'vitest';
import { descriptorToSpec } from '@/render/iso/building-spec';
import type { BuildingDescriptor } from '@/world/building-descriptor';

const base: BuildingDescriptor = {
  category: 'residential', era: 'medieval',
  footprint: { w: 3, h: 3 }, plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 2,
  roof: 'gable', walls: 'timber', roofMat: 'thatch',
  door: { x: 1, y: 2 },
};

function buildingPart(d: BuildingDescriptor) {
  const spec = descriptorToSpec(d)!;
  const p = spec.parts[0];
  if (p.prim !== 'building') throw new Error('expected building part');
  return p;
}

describe('descriptorToSpec', () => {
  it('maps a rect plan to one wing covering the footprint', () => {
    const p = buildingPart(base);
    expect(p.wings).toEqual([{ x: 0, y: 0, w: 3, h: 3, storeys: 1, roof: 'gable' }]);
  });

  it('maps materials (timber walls, thatch roof) to assetgen Mats', () => {
    const p = buildingPart(base);
    expect(p.wallMat).toBe('timber');
    expect(p.roofMat).toBe('thatch');
  });

  it('carries storeys from levels', () => {
    const p = buildingPart({ ...base, levels: 3 });
    expect(p.wings[0].storeys).toBe(3);
  });

  it('maps a pyramidal-family roof to the pyramidal RoofKind per wing', () => {
    const p = buildingPart({ ...base, roof: 'conical' });
    expect(p.wings.every(w => w.roof === 'pyramidal')).toBe(true);
  });

  it('maps a flat/stepped roof to the flat RoofKind', () => {
    const p = buildingPart({ ...base, roof: 'flat' });
    expect(p.wings[0].roof).toBe('flat');
  });

  it('decomposes a cross plan into two wings', () => {
    const p = buildingPart({ ...base, plan: 'cross', footprint: { w: 4, h: 4 } });
    expect(p.wings.length).toBe(2);
  });

  it('decomposes an L plan into two wings', () => {
    const p = buildingPart({ ...base, plan: 'L', footprint: { w: 4, h: 4 } });
    expect(p.wings.length).toBe(2);
  });

  it('returns null for round and stepped plans (fall back to massing)', () => {
    expect(descriptorToSpec({ ...base, plan: 'round' })).toBeNull();
    expect(descriptorToSpec({ ...base, plan: 'stepped' })).toBeNull();
  });

  it('derives a main door whose face matches the door cell edge', () => {
    const south = buildingPart({ ...base, door: { x: 1, y: 2 } }); // y == h-1 → south
    expect(south.features?.doors?.[0]).toMatchObject({ face: 'south', main: true });
    const east = buildingPart({ ...base, door: { x: 2, y: 1 } });  // x == w-1 → east
    expect(east.features?.doors?.[0]).toMatchObject({ face: 'east', main: true });
  });

  it('maps vents to ridge vents on wing 0', () => {
    const p = buildingPart({ ...base, vents: [{ x: 1, y: 1, height: 1, kind: 'chimney' }] });
    expect(p.features?.vents?.[0]).toMatchObject({ wing: 0, kind: 'chimney', placement: 'ridge' });
  });

  it('sets a footprint-scaled positive size', () => {
    const spec = descriptorToSpec(base)!;
    expect(spec.size).toBeGreaterThan(127);
    expect(spec.size).toBeLessThanOrEqual(640);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/building-spec.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `building-spec.ts`**

```ts
// src/render/iso/building-spec.ts
// Pure mapping: in-game BuildingDescriptor → assetgen StructureSpec, so the manifold
// parametric generator can render the SAME building the sim placed. Reference:
// building-massing-model.ts. Returns null for plans the rectilinear-wing generator
// can't express (round/stepped) so callers fall back to the legacy massing.
import type { BuildingDescriptor, Plan, Roof, WallMat, RoofMat, Vent } from '@/world/building-descriptor';
import type { Mat } from '@/assetgen/types';
import type { Wing, RoofKind, WallFace, BuildingFeatures } from '@/assetgen/geometry/building';
import type { StructureSpec } from '@/assetgen/compose';
import { ISO_TILE_W } from '@/render/iso/iso-constants';

const WALL_MAT: Record<WallMat, Mat> = {
  mud: 'plaster', wattle: 'plaster', hide: 'plaster',
  timber: 'timber', log: 'timber', brick: 'brick', stone: 'stone', marble: 'stone',
};
const ROOF_MAT: Record<RoofMat, Mat> = {
  thatch: 'thatch', hide: 'thatch', wood: 'timber', tile: 'tile', slate: 'stone', none: 'tile',
};
const ROOF_KIND: Record<Roof, RoofKind> = {
  gable: 'gable', gambrel: 'gable', mansard: 'gable', saltbox: 'gable',
  jerkinhead: 'gable', cross_gable: 'gable', lean_to: 'gable',
  hip: 'hip',
  pyramidal: 'pyramidal', conical: 'pyramidal', spire: 'pyramidal',
  tented: 'pyramidal', onion: 'pyramidal', domed: 'pyramidal',
  flat: 'flat', stepped: 'flat',
};

/** Wing layout per plan; null = not a rectilinear-wing plan (caller falls back). */
function planWings(plan: Plan, fp: { w: number; h: number }): Array<{ x: number; y: number; w: number; h: number }> | null {
  const { w, h } = fp;
  switch (plan) {
    case 'rect':
      return [{ x: 0, y: 0, w, h }];
    case 'cross': {
      const naveH = Math.max(1, Math.round(h / 2));
      const transW = Math.max(1, Math.round(w / 2));
      return [
        { x: 0, y: Math.floor((h - naveH) / 2), w, h: naveH },             // nave (long axis x)
        { x: Math.floor((w - transW) / 2), y: 0, w: transW, h },           // transept (long axis y)
      ];
    }
    case 'L': {
      const barH = Math.max(1, Math.round(h / 2));
      const armW = Math.max(1, Math.round(w / 2));
      return [
        { x: 0, y: 0, w, h: barH },        // bottom bar
        { x: 0, y: 0, w: armW, h },         // side arm
      ];
    }
    case 'round':
    case 'stepped':
      return null;
  }
}

function doorFace(cell: { x: number; y: number }, fp: { w: number; h: number }): WallFace {
  if (cell.y >= fp.h - 1) return 'south';
  if (cell.x >= fp.w - 1) return 'east';
  if (cell.y <= 0) return 'north';
  if (cell.x <= 0) return 'west';
  return 'south';
}

function ventFeatures(vents: Vent[] | undefined): BuildingFeatures['vents'] {
  if (!vents || vents.length === 0) return undefined;
  const n = vents.length;
  return vents.map((v, i) => ({ wing: 0, t: (i + 1) / (n + 1), kind: v.kind, placement: 'ridge' as const }));
}

/** Map a descriptor to a one-part building StructureSpec, or null to fall back to massing. */
export function descriptorToSpec(d: BuildingDescriptor): StructureSpec | null {
  const layout = planWings(d.plan, d.footprint);
  if (!layout) return null;

  const storeys = Math.max(1, d.levels);
  const roof = ROOF_KIND[d.roof] ?? 'gable';
  const wings: Wing[] = layout.map(r => ({ ...r, storeys, roof }));

  const features: BuildingFeatures = { doors: [{ face: doorFace(d.door, d.footprint), main: true }] };
  const vents = ventFeatures(d.vents);
  if (vents) features.vents = vents;

  const size = Math.min(640, Math.max(128, Math.round((d.footprint.w + d.footprint.h) * ISO_TILE_W * 0.65)));

  return {
    size,
    parts: [{
      prim: 'building',
      wings,
      wallMat: WALL_MAT[d.walls] ?? 'plaster',
      roofMat: ROOF_MAT[d.roofMat] ?? 'tile',
      roofStyle: 'gable',
      features,
      seed: 0,
    }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/building-spec.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/render/iso/building-spec.ts tests/unit/building-spec.test.ts
git commit -m "feat(render): descriptorToSpec — BuildingDescriptor to assetgen StructureSpec"
```

---

### Task 3: Sprite canvas + ParametricBuildingSource

**Files:**
- Create: `src/render/iso/sprite-canvas.ts`
- Create: `src/render/parametric-building-source.ts`
- Test: `tests/unit/parametric-building-source.test.ts`

- [ ] **Step 1: Write the failing test** (injects fakes — no real canvas/wasm needed in jsdom)

```ts
// tests/unit/parametric-building-source.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import type { Entity } from '@/core/types';
import type { BuildingDescriptor } from '@/world/building-descriptor';
import type { StructureResult, StructureSpec } from '@/assetgen/compose';

const desc: BuildingDescriptor = {
  category: 'residential', era: 'medieval',
  footprint: { w: 3, h: 3 }, plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 2,
  roof: 'gable', walls: 'timber', roofMat: 'thatch', door: { x: 1, y: 2 },
};
const entity = (d: BuildingDescriptor | undefined): Entity => ({
  id: 'b1', kind: 'building', x: 0, y: 0, tags: ['building'],
  properties: d ? { descriptor: d } : {},
});

const fakeResult = { grey: new Uint8ClampedArray(4), size: 1, bbox: { x: 0, y: 0, w: 1, h: 1 } } as unknown as StructureResult;
const fakeSprite = { width: 10, height: 8 } as unknown as HTMLCanvasElement;

function flush() { return new Promise(r => setTimeout(r, 0)); }

describe('ParametricBuildingSource', () => {
  it('peek is null before warming', () => {
    const src = new ParametricBuildingSource({ compose: async () => fakeResult, toSprite: () => fakeSprite });
    expect(src.peek(entity(desc))).toBeNull();
  });

  it('warm then peek returns the generated sprite', async () => {
    const src = new ParametricBuildingSource({ compose: async () => fakeResult, toSprite: () => fakeSprite });
    src.warm(entity(desc));
    await flush();
    expect(src.peek(entity(desc))).toBe(fakeSprite);
  });

  it('an entity with no descriptor stays null and never composes', async () => {
    const compose = vi.fn(async () => fakeResult);
    const src = new ParametricBuildingSource({ compose, toSprite: () => fakeSprite });
    src.warm(entity(undefined));
    await flush();
    expect(src.peek(entity(undefined))).toBeNull();
    expect(compose).not.toHaveBeenCalled();
  });

  it('a descriptor whose spec is null stays null and never composes', async () => {
    const compose = vi.fn(async () => fakeResult);
    const src = new ParametricBuildingSource({ toSpec: () => null, compose, toSprite: () => fakeSprite });
    src.warm(entity(desc));
    await flush();
    expect(src.peek(entity(desc))).toBeNull();
    expect(compose).not.toHaveBeenCalled();
  });

  it('a compose failure stays null and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const src = new ParametricBuildingSource({ compose: async () => { throw new Error('boom'); }, toSprite: () => fakeSprite });
    src.warm(entity(desc));
    await flush();
    src.warm(entity(desc)); // cached null → no retry
    await flush();
    expect(src.peek(entity(desc))).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('warming twice composes only once (in-flight + cache guard)', async () => {
    const compose = vi.fn(async () => fakeResult);
    const src = new ParametricBuildingSource({ compose, toSprite: () => fakeSprite });
    src.warm(entity(desc));
    src.warm(entity(desc));
    await flush();
    expect(compose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/parametric-building-source.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sprite-canvas.ts`** (browser canvas; returns null when no 2D context — jsdom)

```ts
// src/render/iso/sprite-canvas.ts
// Crop a composeStructure grey buffer to its opaque bbox → a tight canvas sprite.
// Returns null where no 2D canvas is available (jsdom tests) — callers fall back.
import type { BBox } from '@/assetgen/render/fit';

export type SpriteCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): SpriteCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  return null;
}

export function greyToSpriteCanvas(grey: Uint8ClampedArray, size: number, bbox: BBox): SpriteCanvas | null {
  const full = makeCanvas(size, size);
  const fctx = full?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!full || !fctx) return null;
  fctx.putImageData(new ImageData(grey, size, size), 0, 0);

  const w = Math.max(1, Math.round(bbox.w));
  const h = Math.max(1, Math.round(bbox.h));
  const crop = makeCanvas(w, h);
  const cctx = crop?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!crop || !cctx) return null;
  cctx.imageSmoothingEnabled = false;
  cctx.drawImage(full as CanvasImageSource, Math.round(bbox.x), Math.round(bbox.y), w, h, 0, 0, w, h);
  return crop;
}
```

- [ ] **Step 4: Implement `parametric-building-source.ts`**

```ts
// src/render/parametric-building-source.ts
// Runtime, memoized source of manifold-generated building sprites. Mirrors
// ArtResolver's peek/warm contract: peek() is the sync frame-path read; warm() kicks
// async generation off the frame path. Cache key = descriptor identity, so identical
// buildings share one sprite. Any failure / unsupported plan caches null → caller
// falls back to the legacy massing. Never throws on the frame path.
import type { Entity } from '@/core/types';
import type { BuildingDescriptor } from '@/world/building-descriptor';
import { descriptorToSpec } from '@/render/iso/building-spec';
import { greyToSpriteCanvas, type SpriteCanvas } from '@/render/iso/sprite-canvas';
import { composeStructure, type StructureSpec, type StructureResult } from '@/assetgen/compose';

export interface ParametricSourceDeps {
  toSpec?: (d: BuildingDescriptor) => StructureSpec | null;
  compose?: (s: StructureSpec) => Promise<StructureResult>;
  toSprite?: (r: StructureResult) => SpriteCanvas | null;
}

function descriptorOf(e: Entity): BuildingDescriptor | undefined {
  return e.properties?.descriptor as BuildingDescriptor | undefined;
}

/** Stable key from the descriptor (identical descriptors → one cached sprite). */
function keyOf(d: BuildingDescriptor): string { return JSON.stringify(d); }

export class ParametricBuildingSource {
  private readonly cache = new Map<string, SpriteCanvas | null>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly toSpec: NonNullable<ParametricSourceDeps['toSpec']>;
  private readonly compose: NonNullable<ParametricSourceDeps['compose']>;
  private readonly toSprite: NonNullable<ParametricSourceDeps['toSprite']>;

  constructor(deps: ParametricSourceDeps = {}) {
    this.toSpec = deps.toSpec ?? descriptorToSpec;
    this.compose = deps.compose ?? composeStructure;
    this.toSprite = deps.toSprite ?? ((r) => greyToSpriteCanvas(r.grey, r.size, r.bbox));
  }

  /** Sync read of an already-generated sprite (null if absent / unsupported / failed). */
  peek(e: Entity): SpriteCanvas | null {
    const d = descriptorOf(e);
    return d ? (this.cache.get(keyOf(d)) ?? null) : null;
  }

  /** Fire-and-forget generation. Safe to call every frame; runs at most once per key. */
  warm(e: Entity): void {
    const d = descriptorOf(e);
    if (!d) return;
    const k = keyOf(d);
    if (this.cache.has(k) || this.inflight.has(k)) return;
    const spec = this.toSpec(d);
    if (!spec) { this.cache.set(k, null); return; }
    this.inflight.add(k);
    this.compose(spec)
      .then((r) => { this.cache.set(k, this.toSprite(r)); })
      .catch((err) => {
        if (!this.warned.has(k)) { console.warn('[parametric-building] generation failed', err); this.warned.add(k); }
        this.cache.set(k, null);
      })
      .finally(() => { this.inflight.delete(k); });
  }

  /** Clear on world reset. */
  clear(): void { this.cache.clear(); this.inflight.clear(); this.warned.clear(); }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/parametric-building-source.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 6: Commit**

```bash
git add src/render/iso/sprite-canvas.ts src/render/parametric-building-source.ts tests/unit/parametric-building-source.test.ts
git commit -m "feat(render): ParametricBuildingSource + grey-buffer sprite canvas"
```

---

### Task 4: Wire the source through render-context + browser wasm init

**Files:**
- Modify: `src/game/render-context.ts`
- Modify: `src/core/types.ts` (RenderContext interface: add `resolveParametricBuildingArt`)
- Modify: `src/game.ts`
- (No new unit test — glue verified by `tsc`; behavior covered by Task 3 + manual.)

- [ ] **Step 1: Add the RenderContext field in `src/core/types.ts`**

Find the `RenderContext` interface (it already has `resolveBuildingArt?: (entity: Entity) => HTMLImageElement | undefined;`). Add directly below it:

```ts
  /** A runtime-generated parametric building sprite (manifold), or null. */
  resolveParametricBuildingArt?: (entity: Entity) => CanvasImageSource | null;
```

- [ ] **Step 2: Extend `RenderContextDeps` and `buildRenderContext` in `src/game/render-context.ts`**

Add the import near the other render imports:

```ts
import type { ParametricBuildingSource } from '@/render/parametric-building-source';
```

Add to the `RenderContextDeps` interface (after `buildingArtResolver: ArtResolver;`):

```ts
  parametricBuildingSource: ParametricBuildingSource;
```

Add `parametricBuildingSource` to the destructure on line ~24:

```ts
  const { state, viewport, sheets, assets, decorationImages, artResolver, buildingArtResolver, parametricBuildingSource, devMode } = deps;
```

Add the resolver to the returned object (after the `resolveBuildingArt` block, before `devMode`):

```ts
    resolveParametricBuildingArt: (entity: Entity) => {
      const s = parametricBuildingSource.peek(entity);
      if (s) return s;
      parametricBuildingSource.warm(entity); // fire-and-forget; never blocks the frame
      return null;
    },
```

- [ ] **Step 3: Construct the source + init wasm in `src/game.ts`**

Add imports near the other render/assetgen imports:

```ts
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
```

Add a field beside `buildingArtResolver` (line ~102):

```ts
  private readonly parametricBuildingSource = new ParametricBuildingSource();
```

In `generateWorld` (line ~553), call `initManifoldWasm()` as the first statement so the wasm url is set before any building generation:

```ts
  async generateWorld(worldSeed?: WorldSeed, _terrainOptions?: Partial<TerrainOptions>): Promise<GameMap> {
    initManifoldWasm();
    this.renderMap = await selectRenderer();
```

Add the source to `renderDeps()` (line ~533) after `buildingArtResolver: this.buildingArtResolver,`:

```ts
      parametricBuildingSource: this.parametricBuildingSource,
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean). Confirms the wiring is type-correct end to end.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/game/render-context.ts src/game.ts
git commit -m "feat(game): wire ParametricBuildingSource + browser manifold wasm init"
```

---

### Task 5: Shared sprite-draw core + generated-sprite draw

**Files:**
- Modify: `src/render/iso/iso-building.ts`
- Test: `tests/unit/iso-building-generated.test.ts`

- [ ] **Step 1: Write the failing test** (a fake 2D context records the drawImage call)

```ts
// tests/unit/iso-building-generated.test.ts
import { describe, it, expect } from 'vitest';
import { drawIsoBuildingSpriteGenerated } from '@/render/iso/iso-building';
import type { IsoDrawCtx } from '@/render/iso/iso-sprites';

function fakeCtx() {
  const calls: Array<{ w: number; h: number; dx: number; dy: number }> = [];
  const ctx = {
    imageSmoothingEnabled: true,
    drawImage: (_img: unknown, dx: number, dy: number, w: number, h: number) => calls.push({ dx, dy, w, h }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('drawIsoBuildingSpriteGenerated', () => {
  it('blits the canvas at its native size once', () => {
    const { ctx, calls } = fakeCtx();
    const dc = { ctx, atlas: {}, originX: 0, originY: 0 } as unknown as IsoDrawCtx;
    const sprite = { width: 40, height: 30 } as unknown as HTMLCanvasElement;
    drawIsoBuildingSpriteGenerated(dc, sprite, 2, 2, { w: 3, h: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0].w).toBe(40);
    expect(calls[0].h).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/iso-building-generated.test.ts`
Expected: FAIL — `drawIsoBuildingSpriteGenerated` not exported.

- [ ] **Step 3: Refactor `iso-building.ts`**

Add the import for the anchor type (top of file, with the other `./iso-*` imports):

```ts
import { opaqueAnchor, type SpriteAnchor } from './iso-sprite-bbox';
```

(If `opaqueAnchor` is already imported, just add `, type SpriteAnchor` to that import.)

Replace the current `drawIsoBuildingSprite` function (lines ~211-242) with a shared core plus two thin entry points:

```ts
/** Shared placement: land `anchor` (in sprite px) on the footprint's front tip. */
function drawIsoBuildingSpriteCore(
  dc: IsoDrawCtx, src: CanvasImageSource, natW: number, natH: number,
  anchor: SpriteAnchor, tileX: number, tileY: number, footprint: { w: number; h: number },
): void {
  const { ctx, originX, originY } = dc;
  const { w, h } = footprint;
  const west = worldToScreen(tileX, tileY + h, 0, originX, originY);
  const east = worldToScreen(tileX + w, tileY, 0, originX, originY);
  const front = worldToScreen(tileX + w - 1, tileY + h - 1, 0, originX, originY);
  const bottomY = front.sy + ISO_TILE_H / 2;
  const cx = (west.sx + east.sx) / 2; // footprint centre x

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    src,
    Math.round(cx - anchor.centerX),
    Math.round(bottomY - anchor.bottom),
    natW,
    natH,
  );
}

/**
 * Draw a generated/baked building sprite (PixelLab path). Anchors by the sprite's
 * opaque content (margined frames), then delegates to the shared core.
 */
export function drawIsoBuildingSprite(
  dc: IsoDrawCtx, img: HTMLImageElement,
  tileX: number, tileY: number, footprint: { w: number; h: number },
): void {
  const natW = img.naturalWidth || img.width || 0;
  const natH = img.naturalHeight || img.height || natW;
  drawIsoBuildingSpriteCore(dc, img, natW, natH, opaqueAnchor(img), tileX, tileY, footprint);
}

/**
 * Draw a runtime parametric building sprite (manifold generate-to-sprite). The
 * canvas is cropped to opaque content, so its base anchor is trivially centre/bottom.
 */
export function drawIsoBuildingSpriteGenerated(
  dc: IsoDrawCtx, src: HTMLCanvasElement | OffscreenCanvas,
  tileX: number, tileY: number, footprint: { w: number; h: number },
): void {
  const natW = src.width, natH = src.height;
  drawIsoBuildingSpriteCore(dc, src, natW, natH, { centerX: natW / 2, bottom: natH }, tileX, tileY, footprint);
}
```

Note: the `cx`/`west`/`east`/`bottomY` math is copied verbatim from the old `drawIsoBuildingSprite` (the comment block explaining the front-tip anchor remains valid). Keep the existing `drawIsoBuildingMassing` function below, unchanged.

- [ ] **Step 4: Run the test + existing iso-building tests**

Run: `npx vitest run tests/unit/iso-building-generated.test.ts`
Expected: PASS.

Run: `npx vitest run -t "iso"`
Expected: PASS (existing iso/building/sprite tests still green — the PixelLab path is behavior-preserved).

- [ ] **Step 5: Commit**

```bash
git add src/render/iso/iso-building.ts tests/unit/iso-building-generated.test.ts
git commit -m "refactor(render): shared building sprite draw core + generated-sprite entry"
```

---

### Task 6: `buildingRenderMode` enum + dispatch + dev select (atomic rename)

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/render/iso/iso-renderer.ts`
- Modify: `src/dev/DebugOverlayPanel.ts`

> **Why one task:** `forceParametricBuildings` is referenced in all three files. Renaming it to the `buildingRenderMode` enum must happen atomically — a partial rename leaves `tsc` broken. This task replaces every reference in one commit.

- [ ] **Step 1: Replace the boolean flag in `src/core/types.ts`**

In the `DevModeState` interface, replace the `forceParametricBuildings?: boolean;` block (the "Building render mode" comment + field added earlier) with:

```ts
  // Building render mode (dev). 'auto' = asset sprite where one exists, else massing
  // (today's behavior); 'generator' = runtime manifold parametric sprite, else massing;
  // 'massing' = always the legacy Canvas2D massing. Default 'auto'.
  buildingRenderMode?: BuildingRenderMode;
```

Add the type alias near the top of the file's type exports (e.g. just above `export interface DevModeState`):

```ts
export type BuildingRenderMode = 'auto' | 'generator' | 'massing';
```

- [ ] **Step 2: Replace the dispatch in `src/render/iso/iso-renderer.ts`**

Locate the building branch (the `if (b) { const forceParametric = ...; const art = ...; if (art) drawIsoBuildingSprite(...) else drawIsoBuildingMassing(...) }` block from the earlier toggle). Replace it with:

```ts
        const b = buildingById.get(e.id);
        if (b) {
          const fx = Math.floor(b.e.x), fy = Math.floor(b.e.y);
          const mode = rc.devMode?.buildingRenderMode ?? 'auto';
          let drew = false;
          if (mode === 'generator') {
            const psrc = rc.resolveParametricBuildingArt?.(b.e) ?? null;
            if (psrc) { drawIsoBuildingSpriteGenerated(drawCtx, psrc as HTMLCanvasElement, fx, fy, b.massing.footprint); drew = true; }
          } else if (mode === 'auto') {
            const art = rc.resolveBuildingArt?.(b.e) ?? null;
            if (art) { drawIsoBuildingSprite(drawCtx, art, fx, fy, b.massing.footprint); drew = true; }
          }
          if (!drew) drawIsoBuildingMassing(drawCtx, b.massing, fx, fy);
        }
```

Update the import of draw functions from `./iso-building` to include the generated entry:

```ts
import { drawIsoBuildingMassing, drawIsoBuildingSprite, drawIsoBuildingSpriteGenerated } from './iso-building';
```

(Adjust to match the existing import line — add `drawIsoBuildingSpriteGenerated` to it.)

- [ ] **Step 3: Replace the parametric checkbox with a select in `src/dev/DebugOverlayPanel.ts`**

In the "Building Render" section added earlier, replace the `parametricToggle = createToggle(...)` block with a labelled `<select>`:

```ts
  // ── Building Render ──────────────────────────────────────────────────────
  // auto: asset sprite → else massing (default). generator: runtime manifold
  // parametric sprite → else massing. massing: always legacy massing.
  const buildingSection = section('Building Render');
  const modeRow = document.createElement('label');
  modeRow.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:12px; padding:2px 0;';
  const modeText = document.createElement('span');
  modeText.textContent = '🏗️ Mode';
  const modeSelect = document.createElement('select');
  modeSelect.style.cssText = 'flex:1; padding:4px; background:#1a1a2e; color:#e0e0e0; border:1px solid #555; border-radius:3px; font-size:11px; cursor:pointer;';
  for (const [value, label] of [['auto', 'Auto (assets → massing)'], ['generator', 'Parametric generator'], ['massing', 'Legacy massing']] as const) {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = label;
    modeSelect.appendChild(opt);
  }
  modeSelect.addEventListener('change', () => {
    if (currentDevMode) currentDevMode.buildingRenderMode = modeSelect.value as 'auto' | 'generator' | 'massing';
  });
  modeRow.appendChild(modeText);
  modeRow.appendChild(modeSelect);
  buildingSection.appendChild(modeRow);
```

In the same file, update the reset button click handler — replace `currentDevMode.forceParametricBuildings = false;` with:

```ts
    currentDevMode.buildingRenderMode = 'auto';
```

And in `update()`, replace `parametricToggle.checked = !!devMode.forceParametricBuildings;` with:

```ts
    modeSelect.value = devMode.buildingRenderMode ?? 'auto';
```

- [ ] **Step 4: Typecheck — confirm the rename is complete**

Run: `npx tsc --noEmit`
Expected: clean (no remaining `forceParametricBuildings` references anywhere — grep `grep -rn forceParametricBuildings src` should return nothing).

Run: `npx vitest run -t "DebugOverlay"`
Expected: PASS if such tests exist; otherwise no tests matched (acceptable — this panel is exercised manually).

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/render/iso/iso-renderer.ts src/dev/DebugOverlayPanel.ts
git commit -m "feat(render): buildingRenderMode enum + dispatch + 3-way dev select"
```

---

### Task 7: Full verification — build, wasm emission, suite, manual

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all files pass (prior baseline 278 files / 1546 tests, plus the new tests from Tasks 1-5). No regressions.

- [ ] **Step 3: Production build — confirm wasm is emitted and the no-three guard holds**

Run: `npm run build`
Expected: build succeeds; `manifold.wasm` is emitted into `dist/assets/` (the `?url` import copies it). If the build fails to resolve `manifold-3d/manifold.wasm?url`, add to `vite.config.ts`:

```ts
  assetsInclude: ['**/*.wasm'],
```

Run: `npx vitest run tests/unit/no-three-in-bundle.test.ts`
Expected: PASS (manifold is not three; guard stays green).

- [ ] **Step 4: Manual in-game check**

Run: `npm run dev` (port 3000). In the running game:
1. Open dev mode → 🎨 Debug Overlays → Building Render.
2. Switch **Mode** to **Parametric generator**. Confirm buildings re-render as manifold-generated sprites (gabled/hipped/pyramidal roofs, doors, chimneys) and sit correctly on their tiles (pixel-aligned base, no half-tile drift).
3. Switch to **Legacy massing** and **Auto** to confirm all three modes render and the selector flips live.
4. Confirm round/stepped buildings (if any in the world) fall back to massing under **generator** mode rather than disappearing.

Note any visual issues (roof fidelity, anchoring) as cosmetic follow-ups — they do not block the feature.

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch to merge `feat/live-parametric-building-sprites` to `main` locally (the user's default — do NOT push).

---

## Notes for the implementer

- **Determinism / no Math.random:** `descriptorToSpec` and the source are pure/deterministic. They live in `src/render/`, not `src/sim/`, so the `no-random-in-sim` guard does not apply — but still use no randomness (none is needed; `seed: 0`).
- **Never block the frame:** the renderer only ever calls `peek` (sync) and `warm` (fire-and-forget). All wasm/CSG/raster work is async and memoized.
- **Fallback is silent-by-design and correct:** a null sprite (unsupported plan, wasm failure) always falls through to `drawIsoBuildingMassing`, so a building never disappears.
- **jsdom limitation:** `greyToSpriteCanvas` returns null under vitest (no 2D backend); its real-canvas path is covered by the Task 8 manual check, and the source's logic is unit-tested via injected fakes.
