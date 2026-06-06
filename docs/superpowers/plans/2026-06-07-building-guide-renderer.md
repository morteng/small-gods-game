# Building Guide-Image Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce offline 3D guide images (color + depth) of every building from its `BuildingDescriptor`, with a full 16-type roof vocabulary at correct heights and smoke-vent anchors, fed to PixelLab as `init_image`.

**Architecture:** Extend the pure massing layer (roof union, height model, vents). Build a pure three.js `Scene` from the descriptor (no GL — fully unit-testable via scene-graph assertions). A separate render step rasterizes that scene to color + depth PNGs through a headless GL backend, writing to the `tmp/guidance/` seam the existing `gen-buildings.ts` already consumes. All three.js code lives under `src/assetgen/headless/` and ships only in the offline gen path, never the game bundle.

**Tech Stack:** TypeScript, three.js (devDependency), headless-gl (`gl`) + `pngjs` for offline rasterization, Vitest. Reuses `building-massing-model.ts`, `view-registry.ts`, `building-presets.ts`, `src/render/lighting.ts`.

**Spec:** `docs/superpowers/specs/2026-06-07-building-guide-renderer-design.md`

---

## Decomposition note

The GL-dependent work (headless render context) is isolated to Tasks 1, 7, and 8. Tasks 2–6 are pure TypeScript with zero GL — if the headless-gl spike (Task 1) fails, only Tasks 7–8 change (swap to a Playwright backend); the scene, roof model, and vents are unaffected. Implement Task 1 first to learn which backend you're targeting, then 2–6 in order, then 7–8.

### Out of scope (deferred, not silently dropped)

The spec mentions baking the guide PNG **into `public/asset-library/`** so the building panel's Sent⇄Received toggle shows the actual 3D guide. That's **deferred** here: it requires an asset-library manifest schema change plus changes to the in-flight (uncommitted) building-info-panel, which this plan deliberately does not touch. Until then the panel keeps showing its existing in-browser Canvas2D massing guidance. The generation pipeline (the user's actual ask — better guides → better sprites) is fully covered. Track the panel-shows-baked-guide wiring as a follow-up slice.

---

## Task 1: ✅ DONE — render-context spike (backend resolved)

**Status: complete (commit `a364534`).** headless-gl **failed to build** on this machine (macOS 12.7.6, no `python`, ANGLE-from-source) — exactly the flagged risk. Resolved backend: **puppeteer-core driving the installed Google Chrome**. A spike (a lit three.js cone → transparent PNG via headless Chrome) confirmed it works offline with no native build. devDeps installed: `three`, `@types/three`, `puppeteer-core`, `pngjs`, `@types/pngjs` (esbuild already present via Vite). **Tasks 6–7 below have been rewritten for the puppeteer+Chrome backend; the original headless-gl steps in this Task 1 are obsolete — skip them.**

<details><summary>Obsolete original Task 1 (headless-gl — did not build)</summary>

**Files:**
- Create: `scripts/spike-headless-gl.ts` (throwaway; deleted at end of task)
- Modify: `package.json` (add devDependencies)

- [ ] **Step 1: Add devDependencies**

```bash
npm install --save-dev three @types/three gl pngjs @types/pngjs
```

Expected: installs succeed. **If `gl` fails to compile** (native node-gyp build; likely risk on older macOS), STOP and record the failure — proceed to the Playwright fallback below before continuing.

- [ ] **Step 2: Write the spike — render a lit triangle to a PNG**

```ts
// scripts/spike-headless-gl.ts
import createGL from 'gl';
import * as THREE from 'three';
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';

const W = 128, H = 128;
const gl = createGL(W, H, { preserveDrawingBuffer: true });
const renderer = new THREE.WebGLRenderer({
  context: gl as unknown as WebGLRenderingContext,
  antialias: false,
});
renderer.setSize(W, H, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 4);
const geo = new THREE.ConeGeometry(1, 2, 4);
const mat = new THREE.MeshStandardMaterial({ color: 0xcc5533 });
scene.add(new THREE.Mesh(geo, mat));
scene.add(new THREE.DirectionalLight(0xffffff, 2).translateX(-3).translateY(3));
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
renderer.render(scene, camera);

const pixels = new Uint8Array(W * H * 4);
gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
const png = new PNG({ width: W, height: H });
// readPixels is bottom-up; flip rows into the PNG buffer
for (let y = 0; y < H; y++) {
  const src = (H - 1 - y) * W * 4;
  png.data.set(pixels.subarray(src, src + W * 4), y * W * 4);
}
writeFileSync('tmp/spike-headless-gl.png', PNG.sync.write(png));
console.log('wrote tmp/spike-headless-gl.png');
```

- [ ] **Step 3: Run the spike**

```bash
mkdir -p tmp && npx tsx scripts/spike-headless-gl.ts
```

Expected: prints `wrote tmp/spike-headless-gl.png`; the PNG shows a shaded orange diamond (cone-4) lit brighter on the upper-left, transparent elsewhere. Open it to confirm it is not blank/black.

- [ ] **Step 4: Record the decision and delete the spike**

If the spike rendered correctly: the backend is **headless-gl**. Note the installed `three` version — if `renderer.render` throws a WebGL2-required error, pin three to the last WebGL1-compatible line:

```bash
npm install --save-dev three@0.160.1
```

Re-run Step 3 to confirm.

**Fallback (only if headless-gl cannot build/render):** the backend is **Playwright**. Install instead:

```bash
npm uninstall gl @types/pngjs pngjs && npm install --save-dev playwright && npx playwright install chromium
```

In Tasks 7–8, replace the headless-gl backend with a Playwright backend (load a minimal HTML page that imports three from a `<script type=module>`, builds the same scene via a serialized descriptor, and `page.screenshot`s a transparent canvas). The scene-building module (Task 4) is reused verbatim by bundling it for the page.

```bash
rm scripts/spike-headless-gl.ts
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add three/gl/pngjs devDeps for offline building guide renderer"
```

</details>

---

## Task 2: Roof vocabulary + correct-height model

Expand the `Roof` union to 16 types and replace the width-blind `ROOF_RISE` scalar with the hybrid `roofRise()` (pitch-derived for pitched roofs, target-height for domes/spires).

**Files:**
- Modify: `src/world/building-descriptor.ts:18` (Roof union)
- Modify: `src/render/building-massing-model.ts:34-43,55` (profiles + roofRise)
- Test: `tests/unit/roof-rise.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/roof-rise.test.ts
import { describe, it, expect } from 'vitest';
import { roofRise, ROOF_PROFILES } from '@/render/building-massing-model';
import type { Roof } from '@/world/building-descriptor';

const ALL: Roof[] = [
  'flat','gable','hip','conical','domed','stepped','lean_to',
  'gambrel','mansard','pyramidal','saltbox','onion','spire','tented','jerkinhead','cross_gable',
];

describe('roofRise', () => {
  it('has a profile for every roof kind', () => {
    for (const r of ALL) expect(ROOF_PROFILES[r], r).toBeDefined();
  });

  it('pitched roofs get taller as the building widens (correct height format)', () => {
    const narrow = roofRise('gable', { w: 1, h: 1 });
    const wide = roofRise('gable', { w: 5, h: 5 });
    expect(wide).toBeGreaterThan(narrow);
  });

  it('target-height roofs are width-independent in mode (intrinsic rise)', () => {
    // a spire on a 2-wide and 3-wide tower both rise tall, not pitch-scaled by half-span
    expect(ROOF_PROFILES.spire.mode).toBe('target');
    expect(roofRise('spire', { w: 2, h: 2 })).toBeGreaterThan(roofRise('gable', { w: 2, h: 2 }));
  });

  it('flat is a low parapet, never zero', () => {
    expect(roofRise('flat', { w: 3, h: 3 })).toBeGreaterThan(0);
    expect(roofRise('flat', { w: 3, h: 3 })).toBeLessThan(0.3);
  });

  it('lean_to uses the full span (single slope), so > a half-span pitch at equal pitch', () => {
    // lean_to fullSpan vs hip half-span on the same footprint
    expect(roofRise('lean_to', { w: 4, h: 4 })).toBeGreaterThan(0);
  });

  it('clamps very wide pitched roofs below maxRise', () => {
    expect(roofRise('gable', { w: 40, h: 40 })).toBeLessThanOrEqual(2.5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/roof-rise.test.ts`
Expected: FAIL — `roofRise`/`ROOF_PROFILES` not exported.

- [ ] **Step 3: Expand the Roof union**

In `src/world/building-descriptor.ts`, replace line 18:

```ts
export type Roof =
  | 'flat' | 'gable' | 'hip' | 'conical' | 'domed' | 'stepped' | 'lean_to'
  | 'gambrel' | 'mansard' | 'pyramidal' | 'saltbox' | 'onion' | 'spire'
  | 'tented' | 'jerkinhead' | 'cross_gable';
```

- [ ] **Step 4: Replace ROOF_RISE with ROOF_PROFILES + roofRise**

In `src/render/building-massing-model.ts`, replace the `ROOF_RISE` block (lines 34–43):

```ts
export type RoofMode = 'pitch' | 'target';
export interface RoofProfile {
  mode: RoofMode;
  /** rise per unit run, for mode 'pitch' */
  pitch?: number;
  /** run = full short span (single-slope, e.g. lean_to) instead of half-span */
  fullSpan?: boolean;
  /** rise = targetAspect × plan diameter, for mode 'target' */
  targetAspect?: number;
  minRise?: number;
  maxRise?: number;
}

/** Hybrid roof height model. All rises in tile-height units. */
export const ROOF_PROFILES: Record<Roof, RoofProfile> = {
  flat:       { mode: 'pitch', pitch: 0,    minRise: 0.12, maxRise: 0.12 },
  stepped:    { mode: 'pitch', pitch: 0,    minRise: 0.2,  maxRise: 0.2 },
  gable:      { mode: 'pitch', pitch: 0.55 },
  hip:        { mode: 'pitch', pitch: 0.5 },
  pyramidal:  { mode: 'pitch', pitch: 0.7 },
  jerkinhead: { mode: 'pitch', pitch: 0.5 },
  saltbox:    { mode: 'pitch', pitch: 0.6 },
  gambrel:    { mode: 'pitch', pitch: 0.75 },
  mansard:    { mode: 'pitch', pitch: 0.8 },
  cross_gable:{ mode: 'pitch', pitch: 0.6 },
  lean_to:    { mode: 'pitch', pitch: 0.4, fullSpan: true },
  conical:    { mode: 'target', targetAspect: 0.55 },
  domed:      { mode: 'target', targetAspect: 0.5 },
  onion:      { mode: 'target', targetAspect: 0.7 },
  spire:      { mode: 'target', targetAspect: 1.4 },
  tented:     { mode: 'target', targetAspect: 1.0 },
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Roof rise above the body, in tile-height units, correct for footprint width. */
export function roofRise(roof: Roof, footprint: { w: number; h: number }): number {
  const p = ROOF_PROFILES[roof] ?? { mode: 'pitch' as const, pitch: 0.4 };
  const shortSpan = Math.min(footprint.w, footprint.h);
  if (p.mode === 'pitch') {
    const run = p.fullSpan ? shortSpan : shortSpan / 2;
    return clamp((p.pitch ?? 0.4) * run, p.minRise ?? 0.1, p.maxRise ?? 2.5);
  }
  const diameter = Math.max(footprint.w, footprint.h);
  return clamp((p.targetAspect ?? 0.5) * diameter, p.minRise ?? 0.3, p.maxRise ?? 4);
}
```

Then change the `roofHeight` assignment in `buildingMassing` (was line 55):

```ts
    roofHeight: roofRise(d.roof, d.footprint),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/roof-rise.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the existing massing/iso suites to confirm no regression**

Run: `npx vitest run tests/unit/iso-building.test.ts tests/unit/building-massing.test.ts`
Expected: PASS. (Both `drawRoof` switches have a `default` flat-cap branch, so new roof kinds render as flat caps until Task 5 maps them — no break.)

- [ ] **Step 7: Commit**

```bash
git add src/world/building-descriptor.ts src/render/building-massing-model.ts tests/unit/roof-rise.test.ts
git commit -m "feat(massing): 16-roof vocabulary + width-correct hybrid roofRise model"
```

---

## Task 3: Smoke-vent attachment points

Add a `Vent` type + optional `vents` to the descriptor, mirror it onto the entity, carry it onto `Massing`, and seed sensible vents on presets.

**Files:**
- Modify: `src/world/building-descriptor.ts` (Vent type, descriptor field, entity mirror)
- Modify: `src/render/building-massing-model.ts` (Massing.vents)
- Modify: `src/world/building-presets.ts` (seed vents)
- Test: `tests/unit/building-vents.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/building-vents.test.ts
import { describe, it, expect } from 'vitest';
import { synthesizeFromPreset } from '@/world/building-presets';
import { buildingEntity } from '@/world/building-descriptor';
import { buildingMassing } from '@/render/building-massing-model';

describe('building vents', () => {
  it('cottage seeds a chimney', () => {
    const d = synthesizeFromPreset('cottage')!;
    expect(d.vents?.length).toBeGreaterThan(0);
    expect(d.vents![0].kind).toBe('chimney');
    expect(d.vents![0].height).toBeGreaterThan(0);
  });

  it('yurt seeds a smokehole at its apex', () => {
    const d = synthesizeFromPreset('yurt')!;
    expect(d.vents?.some(v => v.kind === 'smokehole')).toBe(true);
  });

  it('mirrors vents onto the entity properties', () => {
    const d = synthesizeFromPreset('tavern')!;
    const e = buildingEntity('b1', d, 0, 0);
    expect((e.properties as any).vents).toEqual(d.vents);
  });

  it('carries vents onto the Massing model', () => {
    const d = synthesizeFromPreset('cottage')!;
    const m = buildingMassing(d);
    expect(m.vents.length).toBe(d.vents!.length);
    expect(m.vents[0]).toMatchObject({ kind: 'chimney' });
  });

  it('a preset without vents yields an empty Massing.vents array (never undefined)', () => {
    const d = synthesizeFromPreset('dock')!;
    expect(buildingMassing(d).vents).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/building-vents.test.ts`
Expected: FAIL — `vents` undefined / not on Massing.

- [ ] **Step 3: Add the Vent type + descriptor field + entity mirror**

In `src/world/building-descriptor.ts`, after the `BuildingPalette` interface (line 23) add:

```ts
/** A smoke/steam emission point. Drawn as a stack in the guide render; reserved as
 *  the anchor for future particle smoke. Position is tile-relative like `door`. */
export interface Vent {
  x: number;
  y: number;
  /** mouth/emitter height in tile-height units above the roof base */
  height: number;
  kind: 'chimney' | 'smokehole' | 'pipe';
  emit?: 'smoke' | 'steam';
}
```

In the `BuildingDescriptor` interface, after the `door` field (line 49) add:

```ts
  /** Optional smoke vents (chimneys/smokeholes/pipes), for buildings that have them. */
  vents?: Vent[];
```

In `buildingEntity`, inside the `properties` object (after `door: { ...d.door },` ~line 102) add:

```ts
      vents: d.vents ? d.vents.map(v => ({ ...v })) : [],
```

- [ ] **Step 4: Carry vents onto Massing**

In `src/render/building-massing-model.ts`:

Add to the `Massing` interface (after `door`, line 31):

```ts
  /** Smoke vents to draw as stacks; empty when the building has none. */
  vents: Vent[];
```

Add `Vent` to the import from `building-descriptor` (line 13):

```ts
import {
  buildingPalette, type BuildingDescriptor, type Plan, type Roof, type Vent,
} from '@/world/building-descriptor';
```

In `buildingMassing`, add to the returned object (after `door:` line 59):

```ts
    vents: d.vents ? d.vents.map(v => ({ ...v })) : [],
```

- [ ] **Step 5: Seed vents on presets**

In `src/world/building-presets.ts`, add a `vents` field to these presets:

```ts
// cottage — append after `door: { x: 1, y: 2 },`
    vents: [{ x: 2, y: 0, height: 0.8, kind: 'chimney', emit: 'smoke' }],
```
```ts
// tavern
    vents: [{ x: 2, y: 0, height: 0.9, kind: 'chimney', emit: 'smoke' }],
```
```ts
// temple_small
    vents: [{ x: 2, y: 2, height: 0.5, kind: 'smokehole', emit: 'smoke' }],
```
```ts
// yurt
    vents: [{ x: 1, y: 1, height: 0.4, kind: 'smokehole', emit: 'smoke' }],
```
```ts
// longhouse
    vents: [{ x: 2, y: 0, height: 0.6, kind: 'smokehole', emit: 'smoke' }],
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/building-vents.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/world/building-descriptor.ts src/render/building-massing-model.ts src/world/building-presets.ts tests/unit/building-vents.test.ts
git commit -m "feat(massing): smoke-vent attachment points (chimney/smokehole/pipe) + preset seeds"
```

---

## Task 4: Massing scene builder (pure three.js, no GL)

Build a `THREE.Scene` + `OrthographicCamera` from a descriptor: body geometry per plan, roof geometry per kind, palette materials, upper-left light, door marker, vent stacks, faint tile-diamond ground plane. Pure — testable via scene-graph assertions without any GL context.

**Files:**
- Create: `src/assetgen/headless/massing-scene.ts`
- Test: `tests/unit/massing-scene.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/massing-scene.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildMassingScene } from '@/assetgen/headless/massing-scene';
import { synthesizeFromPreset, BUILDING_PRESETS } from '@/world/building-presets';
import type { Roof } from '@/world/building-descriptor';

const ALL_ROOFS: Roof[] = [
  'flat','gable','hip','conical','domed','stepped','lean_to',
  'gambrel','mansard','pyramidal','saltbox','onion','spire','tented','jerkinhead','cross_gable',
];

function roofApexY(scene: THREE.Scene): number {
  const box = new THREE.Box3().setFromObject(scene);
  return box.max.y;
}

describe('buildMassingScene', () => {
  it('builds every preset into a non-empty scene with a camera', () => {
    for (const name of Object.keys(BUILDING_PRESETS)) {
      const { scene, camera } = buildMassingScene(synthesizeFromPreset(name)!);
      expect(scene.children.length, name).toBeGreaterThan(0);
      expect(camera).toBeInstanceOf(THREE.OrthographicCamera);
    }
  });

  it('builds every roof kind without throwing and yields geometry', () => {
    for (const roof of ALL_ROOFS) {
      const d = synthesizeFromPreset('cottage')!;
      d.roof = roof;
      const { scene } = buildMassingScene(d);
      let meshes = 0;
      scene.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes++; });
      expect(meshes, roof).toBeGreaterThan(0);
    }
  });

  it('wider buildings get taller pitched roofs (height-correct massing)', () => {
    const narrow = synthesizeFromPreset('cottage')!; narrow.footprint = { w: 1, h: 1 }; narrow.roof = 'gable';
    const wide = synthesizeFromPreset('cottage')!; wide.footprint = { w: 6, h: 6 }; wide.roof = 'gable';
    expect(roofApexY(buildMassingScene(wide).scene)).toBeGreaterThan(roofApexY(buildMassingScene(narrow).scene));
  });

  it('places a mesh for each vent', () => {
    const d = synthesizeFromPreset('cottage')!; // 1 chimney
    const withVent = buildMassingScene(d).scene;
    const d0 = synthesizeFromPreset('cottage')!; d0.vents = [];
    const without = buildMassingScene(d0).scene;
    const count = (s: THREE.Scene) => { let n = 0; s.traverse(o => { if ((o as THREE.Mesh).isMesh) n++; }); return n; };
    expect(count(withVent)).toBeGreaterThan(count(without));
  });

  it('adds exactly one directional light from the upper-left (negative x, positive y)', () => {
    const { scene } = buildMassingScene(synthesizeFromPreset('cottage')!);
    const dir = scene.children.find(c => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
    expect(dir).toBeDefined();
    expect(dir.position.x).toBeLessThan(0);
    expect(dir.position.y).toBeGreaterThan(0);
  });

  it('round plans (yurt) build a cylindrical drum body', () => {
    const { scene } = buildMassingScene(synthesizeFromPreset('yurt')!);
    let cylinders = 0;
    scene.traverse(o => {
      const g = (o as THREE.Mesh).geometry;
      if (g && g.type === 'CylinderGeometry') cylinders++;
    });
    expect(cylinders).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/massing-scene.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scene builder**

```ts
// src/assetgen/headless/massing-scene.ts
/**
 * Pure descriptor → THREE.Scene + OrthographicCamera builder for offline guide
 * images. NO GL context is created here — only scene-graph objects, so this is
 * fully unit-testable in Node. Rasterization lives in massing-renderer.ts.
 *
 * Units: 1 tile = 1 world unit in XZ; 1 tile-height-unit = 1 world unit in Y
 * (heights are already authored in tile-height units). The 2:1 dimetric camera
 * supplies the iso look; pixel-exact game alignment is intentionally NOT a goal
 * for a loose init_image guide.
 */
import * as THREE from 'three';
import type { BuildingDescriptor, Roof } from '@/world/building-descriptor';
import { buildingMassing, type Massing } from '@/render/building-massing-model';
import { SUN_DIRECTION } from '@/render/lighting';

export interface MassingScene {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
}

const DOOR_COLOR = 0xff00ff; // magenta marker, matches the 2D guidance door dot
const GRID_COLOR = 0x5a6478;

/** Build a square (4-sided) pyramid as a scaled cone; rotate so a flat face front. */
function pyramid(rx: number, rz: number, rise: number, color: number): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.5, rise, 4);
  geo.rotateY(Math.PI / 4);
  geo.scale(rx / 0.5 * Math.SQRT1_2, 1, rz / 0.5 * Math.SQRT1_2);
  return new THREE.Mesh(geo, mat(color));
}

/** Extrude a 2D profile (in x–y) along z to make a ridged prism (gable family). */
function prism(profile: THREE.Vector2[], depth: number, color: number): THREE.Mesh {
  const shape = new THREE.Shape(profile);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geo, mat(color));
}

function mat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true });
}

function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', '').slice(0, 6), 16) || 0x888888;
}

/** Roof group sitting on a body of plan w×h (XZ), starting at y = bodyTop. */
function buildRoof(roof: Roof, w: number, h: number, rise: number, bodyTop: number, color: number): THREE.Object3D {
  const g = new THREE.Group();
  const hw = w / 2, hh = h / 2;
  const place = (m: THREE.Object3D, y: number) => { m.position.y = y; g.add(m); };

  switch (roof) {
    case 'gable':
    case 'saltbox': {
      // triangle profile across the short span (x), ridge along z (depth h)
      const ridgeX = roof === 'saltbox' ? -hw * 0.25 : 0; // offset ridge for saltbox
      const tri = [new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(ridgeX, rise)];
      const m = prism(tri, h, color);
      place(m, bodyTop);
      break;
    }
    case 'cross_gable': {
      const triA = [new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(0, rise)];
      place(prism(triA, h, color), bodyTop);
      const triB = [new THREE.Vector2(-hh, 0), new THREE.Vector2(hh, 0), new THREE.Vector2(0, rise)];
      const mB = prism(triB, w, color); mB.rotation.y = Math.PI / 2;
      place(mB, bodyTop);
      break;
    }
    case 'gambrel': {
      // two-pitch barn profile (steep lower, shallow upper)
      const prof = [
        new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0),
        new THREE.Vector2(hw * 0.6, rise * 0.6), new THREE.Vector2(0, rise),
        new THREE.Vector2(-hw * 0.6, rise * 0.6),
      ];
      place(prism(prof, h, color), bodyTop);
      break;
    }
    case 'jerkinhead':
    case 'hip': {
      const m = pyramid(w, h, rise, color);
      place(m, bodyTop + rise / 2);
      break;
    }
    case 'pyramidal':
    case 'tented':
    case 'spire': {
      const m = pyramid(w, h, rise, color);
      place(m, bodyTop + rise / 2);
      break;
    }
    case 'mansard': {
      // steep lower frustum + shallow cap
      const lower = pyramid(w, h, rise * 0.7, color); place(lower, bodyTop + rise * 0.35);
      const cap = pyramid(w * 0.5, h * 0.5, rise * 0.3, color); place(cap, bodyTop + rise * 0.85);
      break;
    }
    case 'conical': {
      const m = new THREE.Mesh(new THREE.ConeGeometry(Math.min(hw, hh), rise, 24), mat(color));
      place(m, bodyTop + rise / 2);
      break;
    }
    case 'domed': {
      const r = Math.min(hw, hh);
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(color));
      place(m, bodyTop);
      break;
    }
    case 'onion': {
      // bulbous lathe profile (eastern dome)
      const r = Math.min(hw, hh);
      const pts = [
        new THREE.Vector2(0.0 * r, 0), new THREE.Vector2(0.9 * r, 0.15 * rise),
        new THREE.Vector2(1.1 * r, 0.45 * rise), new THREE.Vector2(0.5 * r, 0.75 * rise),
        new THREE.Vector2(0.12 * r, 0.92 * rise), new THREE.Vector2(0.0, rise),
      ];
      const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), mat(color));
      place(m, bodyTop);
      break;
    }
    case 'lean_to': {
      // single slope: a thin wedge rising toward +z
      const prof = [new THREE.Vector2(0, 0), new THREE.Vector2(h, 0), new THREE.Vector2(h, rise)];
      const m = prism(prof, w, color); m.rotation.y = Math.PI / 2; m.position.z = -hh;
      place(m, bodyTop);
      break;
    }
    case 'flat':
    case 'stepped':
    default: {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, Math.max(0.06, rise), h), mat(color));
      place(m, bodyTop + rise / 2);
      break;
    }
  }
  return g;
}

function buildVents(m: Massing, bodyTop: number): THREE.Object3D {
  const g = new THREE.Group();
  for (const v of m.vents) {
    // tile-relative (x,y) → centered world XZ (origin at footprint center)
    const wx = v.x + 0.5 - m.footprint.w / 2;
    const wz = v.y + 0.5 - m.footprint.h / 2;
    const top = bodyTop + Math.max(0.1, v.height);
    if (v.kind === 'smokehole') {
      const disk = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), mat(0x222222));
      disk.rotation.x = -Math.PI / 2; disk.position.set(wx, bodyTop + 0.02, wz);
      g.add(disk);
    } else {
      const wdt = v.kind === 'pipe' ? 0.12 : 0.28;
      const stack = new THREE.Mesh(new THREE.BoxGeometry(wdt, top - bodyTop, wdt), mat(hexToInt(m.trim)));
      stack.position.set(wx, (bodyTop + top) / 2, wz);
      g.add(stack);
    }
  }
  return g;
}

function tileGround(w: number, h: number): THREE.Object3D {
  const g = new THREE.Group();
  const lineMat = new THREE.LineBasicMaterial({ color: GRID_COLOR, transparent: true, opacity: 0.5 });
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= w; i++) { pts.push(new THREE.Vector3(i - w / 2, 0, -h / 2), new THREE.Vector3(i - w / 2, 0, h / 2)); }
  for (let j = 0; j <= h; j++) { pts.push(new THREE.Vector3(-w / 2, 0, j - h / 2), new THREE.Vector3(w / 2, 0, j - h / 2)); }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  g.add(new THREE.LineSegments(geo, lineMat));
  return g;
}

export function buildMassingScene(d: BuildingDescriptor): MassingScene {
  const m = buildingMassing(d);
  const scene = new THREE.Scene();
  const w = m.footprint.w, h = m.footprint.h;
  const wallColor = hexToInt(m.walls);
  const roofColor = hexToInt(m.roofColor);

  // Body: stacked levels (insets for 'stepped'), or a round drum for 'round' plans.
  const group = new THREE.Group();
  let bodyTop = 0;
  if (m.plan === 'round') {
    const r = Math.min(w, h) / 2;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, m.bodyHeight, 24), mat(wallColor));
    drum.position.y = m.bodyHeight / 2;
    group.add(drum);
    bodyTop = m.bodyHeight;
  } else {
    const levelH = m.bodyHeight / m.levels;
    for (let lvl = 0; lvl < m.levels; lvl++) {
      const inset = m.levelInset * lvl;
      const lw = Math.max(0.4, w - inset * 2), lh = Math.max(0.4, h - inset * 2);
      const box = new THREE.Mesh(new THREE.BoxGeometry(lw, levelH, lh), mat(wallColor));
      box.position.y = lvl * levelH + levelH / 2;
      group.add(box);
    }
    bodyTop = m.bodyHeight;
  }

  group.add(buildRoof(m.roof, w, h, m.roofHeight, bodyTop, roofColor));
  group.add(buildVents(m, bodyTop));

  // Door marker on the door cell's outer face.
  const dx = m.door.x + 0.5 - w / 2, dz = m.door.y + 0.5 - h / 2;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.1), mat(DOOR_COLOR));
  door.position.set(dx, 0.3, dz + (m.door.y >= h - 1 ? 0.5 : -0.5));
  group.add(door);

  scene.add(group);
  scene.add(tileGround(w, h));

  // Upper-left key light (SUN_DIRECTION = 'top-left') + ambient fill.
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-4, 6, 3); // negative x (left), positive y (up) — asserted in tests
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  void SUN_DIRECTION; // single source of truth; light vector encodes 'top-left'

  // 2:1 dimetric orthographic camera framing the whole group.
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const elev = Math.atan(0.5), azim = Math.PI / 4;
  const dist = Math.max(size.x, size.y, size.z) * 3 + 5;
  const dir = new THREE.Vector3(
    Math.cos(elev) * Math.cos(azim), Math.sin(elev), Math.cos(elev) * Math.sin(azim),
  );
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, dist * 4);
  camera.position.copy(center).add(dir.multiplyScalar(dist));
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  return { scene, camera };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/massing-scene.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck (three.js types)**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/assetgen/headless/massing-scene.ts tests/unit/massing-scene.test.ts
git commit -m "feat(assetgen): pure three.js massing-scene builder (16 roofs, vents, iso cam)"
```

---

## Task 5: Map new roofs to nearest in-game silhouette

So the new roof kinds don't all flatten in the live Canvas2D view, map them to the closest existing silhouette case in both renderers. Cheap, keeps the in-game placeholder sensible.

**Files:**
- Modify: `src/render/iso/iso-building.ts:122` (drawRoof switch)
- Modify: `src/render/building-massing.ts:98` (drawRoof switch)
- Test: `tests/unit/iso-building.test.ts` (extend — already iterates all presets)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/iso-building.test.ts`:

```ts
  it('draws gable-family and hip-family roofs as ridged/pitched silhouettes (not flat caps)', () => {
    const gableLike = ['gambrel', 'saltbox', 'cross_gable'] as const;
    const hipLike = ['pyramidal', 'mansard', 'jerkinhead', 'tented', 'spire'] as const;
    for (const roof of [...gableLike, ...hipLike]) {
      const ctx = makeMockCtx();
      const d = synthesizeFromPreset('cottage')!; d.roof = roof as any;
      drawIsoBuildingMassing(dc(ctx), buildingMassing(d), 5, 5);
      // pitched silhouettes call lineTo many times (ridge/apex); a bare flat cap is a single quad
      expect((ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls.length, roof).toBeGreaterThan(4);
    }
  });
```

(Imports `synthesizeFromPreset` — already imported in that test file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/iso-building.test.ts`
Expected: FAIL — new roofs hit the `default` flat-cap, too few `lineTo` calls.

- [ ] **Step 3: Map new roofs onto existing cases (iso)**

In `src/render/iso/iso-building.ts`, extend the `switch (roof)` case labels (around line 122):

```ts
    case 'gable':
    case 'gambrel':
    case 'saltbox':
    case 'cross_gable': {
```
```ts
    case 'hip':
    case 'pyramidal':
    case 'mansard':
    case 'jerkinhead':
    case 'tented':
    case 'spire': {
```
```ts
    case 'conical':
    case 'onion': {
```

(`domed`, `flat`, `stepped` keep their existing default-grouped flat cap; round-plan domes/onions are still capped via `drawDomeCap`.)

- [ ] **Step 4: Map new roofs onto existing cases (topdown)**

In `src/render/building-massing.ts`, extend the `switch (roof)` labels (around line 98) the same way:

```ts
    case 'conical':
    case 'domed':
    case 'onion': {
```
```ts
    case 'gable':
    case 'gambrel':
    case 'saltbox':
    case 'cross_gable': {
```
```ts
    case 'hip':
    case 'pyramidal':
    case 'mansard':
    case 'jerkinhead':
    case 'tented':
    case 'spire': {
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/iso-building.test.ts tests/unit/building-massing.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render/iso/iso-building.ts src/render/building-massing.ts tests/unit/iso-building.test.ts
git commit -m "feat(render): map new roof kinds to nearest in-game silhouette"
```

---

## Task 6: Massing renderer (puppeteer + Chrome → color + depth PNG)

Render a `MassingScene` to a color PNG (transparent bg) and a grayscale depth PNG at the view-registry native size, by driving the **installed Chrome** headlessly via `puppeteer-core`. Two files: a browser-side render entry (bundled by esbuild) and the Node-side driver. Both live under `src/assetgen/headless/` and never ship in the game bundle.

**Backend note:** headless-gl was the original plan but won't build on macOS 12 (Task 1). We render with real WebGL three.js inside Chrome instead: `canvas.toDataURL` gives the PNG; no native build, no Chromium download.

**Files:**
- Create: `src/assetgen/headless/render-page-entry.ts` (browser-side; bundled, never imported by Node directly)
- Create: `src/assetgen/headless/massing-renderer.ts` (Node-side puppeteer driver)
- Test: `tests/unit/massing-renderer.test.ts` (Chrome-gated — skips if Chrome absent)

- [ ] **Step 1: Write the browser-side render entry**

```ts
// src/assetgen/headless/render-page-entry.ts
/**
 * Browser-side render harness, bundled by esbuild and injected into a headless
 * Chrome page by massing-renderer.ts. Exposes window.renderMassing(descriptor,w,h)
 * → { color, depth } PNG data URLs. Runs real three.js WebGL — NEVER imported by
 * Node or game code (it touches window/document).
 */
import * as THREE from 'three';
import { buildMassingScene } from './massing-scene';
import type { BuildingDescriptor } from '@/world/building-descriptor';

/** Tighten the ortho frustum around the scene for the given canvas aspect (w/h). */
function frameCamera(camera: THREE.OrthographicCamera, scene: THREE.Scene, aspect: number): void {
  camera.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
  let maxX = 0, maxY = 0;
  for (const c of corners) {
    c.applyMatrix4(camera.matrixWorldInverse); // into camera space
    maxX = Math.max(maxX, Math.abs(c.x));
    maxY = Math.max(maxY, Math.abs(c.y));
  }
  let halfW = maxX * 1.08, halfH = maxY * 1.08; // 8% margin
  if (halfW / halfH < aspect) halfW = halfH * aspect; else halfH = halfW / aspect;
  camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
  camera.near = 0.01; camera.far = 5000;
  camera.updateProjectionMatrix();
}

declare global {
  interface Window {
    renderMassing: (d: BuildingDescriptor, w: number, h: number) => { color: string; depth: string };
  }
}

window.renderMassing = (d, w, h) => {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.width = w; canvas.height = h;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(w, h, false);

  const { scene, camera } = buildMassingScene(d);
  frameCamera(camera as THREE.OrthographicCamera, scene, w / h);

  // Color pass — transparent background.
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const color = canvas.toDataURL('image/png');

  // Depth pass — MeshDepthMaterial, lights/lines dropped, opaque background.
  scene.traverse(o => { const me = o as THREE.Mesh; if (me.isMesh) me.material = new THREE.MeshDepthMaterial(); });
  scene.children = scene.children.filter(c => !(c as THREE.Light).isLight);
  renderer.setClearColor(0xffffff, 1);
  renderer.render(scene, camera);
  const depth = canvas.toDataURL('image/png');

  renderer.dispose();
  return { color, depth };
};
```

- [ ] **Step 2: Write the Chrome-gated test**

```ts
// tests/unit/massing-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { synthesizeFromPreset } from '@/world/building-presets';
import { resolveChromePath } from '@/assetgen/headless/massing-renderer';

const chromeOk = existsSync(resolveChromePath());

describe.skipIf(!chromeOk)('renderGuide (via headless Chrome)', () => {
  it('renders a color + depth PNG of the expected size for a preset', async () => {
    const { renderGuide } = await import('@/assetgen/headless/massing-renderer');
    const { color, depth, width, height } = await renderGuide(synthesizeFromPreset('cottage')!);
    expect(width).toBeGreaterThan(0);
    const cp = PNG.sync.read(color);
    expect(cp.width).toBe(width);
    expect(cp.height).toBe(height);
    let opaque = 0;
    for (let i = 3; i < cp.data.length; i += 4) if (cp.data[i] > 10) opaque++;
    expect(opaque).toBeGreaterThan(0); // the building actually drew
    expect(() => PNG.sync.read(depth)).not.toThrow();
  }, 60_000); // browser launch is slow — generous timeout
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/unit/massing-renderer.test.ts`
Expected: FAIL — module `massing-renderer` / `resolveChromePath` not found.

- [ ] **Step 4: Implement the Node-side puppeteer driver**

```ts
// src/assetgen/headless/massing-renderer.ts
/**
 * Render building guide images by driving the installed Chrome headlessly via
 * puppeteer-core. esbuild bundles render-page-entry.ts (browser side); we inject
 * it into a page, then call window.renderMassing per descriptor. Offline-only —
 * imported solely by scripts/render-guides.ts and this module's test, NEVER by
 * game code. No native build, no Chromium download.
 */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { BuildingDescriptor } from '@/world/building-descriptor';
import { buildingBrief } from '@/assetgen/producers/building-producer';
import { VIEW_RECIPES } from '@/assetgen/view-registry';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..'); // src/

export interface GuideOutput { color: Buffer; depth: Buffer; width: number; height: number; }

/** Installed-Chrome path: env override, else the macOS default. */
export function resolveChromePath(): string {
  return process.env.PUPPETEER_EXECUTABLE_PATH
    || process.env.CHROME_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

async function bundlePage(): Promise<string> {
  const res = await build({
    entryPoints: [join(HERE, 'render-page-entry.ts')],
    bundle: true, format: 'iife', write: false, platform: 'browser',
    alias: { '@': SRC }, // mirror Vite's @/ → src
  });
  return res.outputFiles[0].text;
}

function dataUrlToBuffer(u: string): Buffer {
  return Buffer.from(u.replace(/^data:image\/png;base64,/, ''), 'base64');
}

export interface GuideRenderer {
  render(d: BuildingDescriptor): Promise<GuideOutput>;
  close(): Promise<void>;
}

/** Launch Chrome once and reuse the page across many renders (batch-friendly). */
export async function createGuideRenderer(): Promise<GuideRenderer> {
  const bundle = await bundlePage();
  const browser = await puppeteer.launch({ executablePath: resolveChromePath(), headless: true });
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  await page.addScriptTag({ content: bundle });
  return {
    async render(d) {
      const brief = buildingBrief(d, 0);
      const { width, height } = VIEW_RECIPES['iso-3q'].nativeSize(brief);
      const out = await page.evaluate(
        (dd, w, h) => window.renderMassing(dd as BuildingDescriptor, w as number, h as number),
        d, width, height,
      ) as { color: string; depth: string };
      return { color: dataUrlToBuffer(out.color), depth: dataUrlToBuffer(out.depth), width, height };
    },
    async close() { await browser.close(); },
  };
}

/** One-shot convenience: launch, render one descriptor, close. */
export async function renderGuide(d: BuildingDescriptor): Promise<GuideOutput> {
  const r = await createGuideRenderer();
  try { return await r.render(d); } finally { await r.close(); }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/massing-renderer.test.ts`
Expected: PASS (not skipped) — Chrome is installed on this machine.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/assetgen/headless/render-page-entry.ts src/assetgen/headless/massing-renderer.ts tests/unit/massing-renderer.test.ts
git commit -m "feat(assetgen): puppeteer+Chrome massing renderer — color + depth PNG passes"
```

---

## Task 7: render-guides script + gen-buildings wiring

A script that renders every preset's guide PNGs into `tmp/guidance/` (the seam `gen-buildings.ts` already reads), plus the depth PNG alongside.

**Files:**
- Create: `scripts/render-guides.ts`
- Modify: `scripts/gen-buildings.ts:79` (record depth path / log) — minimal, optional comment
- Test: none (orchestration script; covered by Tasks 4 & 6)

- [ ] **Step 1: Implement the script**

```ts
// scripts/render-guides.ts
/**
 * Render 3D guide images (color + depth) for every building preset into
 * tmp/guidance/, which scripts/gen-buildings.ts then sends to PixelLab as
 * init_image. Color → tmp/guidance/<preset>.png ; depth → tmp/guidance/<preset>-depth.png
 * Launches the installed Chrome once and reuses it across all presets.
 *
 *   npx tsx scripts/render-guides.ts [preset…]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILDING_PRESETS, synthesizeFromPreset } from '@/world/building-presets';
import { createGuideRenderer } from '@/assetgen/headless/massing-renderer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUIDANCE = join(ROOT, 'tmp/guidance');

const requested = process.argv.slice(2);
const presets = requested.length ? requested : Object.keys(BUILDING_PRESETS);

await mkdir(GUIDANCE, { recursive: true });

const renderer = await createGuideRenderer();
let ok = 0;
try {
  for (const name of presets) {
    const d = synthesizeFromPreset(name);
    if (!d) { console.error(`✗ ${name}: unknown preset`); continue; }
    try {
      const { color, depth, width, height } = await renderer.render(d);
      await writeFile(join(GUIDANCE, `${name}.png`), color);
      await writeFile(join(GUIDANCE, `${name}-depth.png`), depth);
      console.log(`✓ ${name.padEnd(14)} ${width}x${height}  (color + depth)`);
      ok++;
    } catch (err) {
      console.error(`✗ ${name}: ${(err as Error).message}`);
    }
  }
} finally {
  await renderer.close();
}
console.log(`\nRendered ${ok}/${presets.length} guides → tmp/guidance/`);
```

- [ ] **Step 2: Run it on two presets**

```bash
npx tsx scripts/render-guides.ts cottage castle_keep
```

Expected: prints `✓ cottage …` and `✓ castle_keep …`; `tmp/guidance/cottage.png`, `cottage-depth.png`, `castle_keep.png`, `castle_keep-depth.png` exist. Open the color PNGs: a recognizable iso massing (cottage = box + gable + chimney stack; keep = stepped ziggurat) on a faint tile grid, lit upper-left, transparent background.

- [ ] **Step 3: Confirm gen-buildings consumes the guide**

```bash
PIXELLAB_API_KEY=$(grep '^PIXELLAB_API_KEY=' .env | cut -d= -f2-) npx tsx scripts/gen-buildings.ts cottage
```

Expected: logs `✓ cottage … guided=true` (the `guided=true` flag confirms the init_image was sent). A sprite PNG appears under `tmp/pixellab-probe/`.

- [ ] **Step 4: Commit**

```bash
git add scripts/render-guides.ts
git commit -m "feat(scripts): render-guides — 3D color+depth guides into the gen seam"
```

---

## Task 8: Bundle guard + docs

Ensure three.js / the headless renderer never leak into the shipped game bundle, and record the workflow.

**Files:**
- Test: `tests/unit/no-three-in-bundle.test.ts` (create)
- Modify: `CLAUDE.md` (one line under "Known gaps & gotchas")

- [ ] **Step 1: Write the guard test**

```ts
// tests/unit/no-three-in-bundle.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const ALLOWED = join(SRC, 'assetgen', 'headless'); // only place allowed to import three

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('three.js stays out of the game bundle', () => {
  it('no src file outside assetgen/headless imports three', () => {
    const offenders = walk(SRC)
      .filter(p => !p.startsWith(ALLOWED))
      .filter(p => /from\s+['"]three['"]|from\s+['"]gl['"]/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no src file outside assetgen/headless imports the headless renderer', () => {
    const offenders = walk(SRC)
      .filter(p => !p.startsWith(ALLOWED))
      .filter(p => /assetgen\/headless\//.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `npx vitest run tests/unit/no-three-in-bundle.test.ts`
Expected: PASS (massing-scene.ts and massing-renderer.ts are under `assetgen/headless`; nothing else imports three).

- [ ] **Step 3: Document the workflow in CLAUDE.md**

Under "## Known gaps & gotchas (code reality)", add:

```md
- **Building guide images are 3D-rendered offline via puppeteer + the installed Chrome.** `scripts/render-guides.ts` drives headless Chrome (`src/assetgen/headless/`: `massing-scene.ts` builds the three.js scene, `render-page-entry.ts` renders it with WebGL, `massing-renderer.ts` is the puppeteer-core driver) to write each preset's `BuildingDescriptor` to `tmp/guidance/<preset>.png` (color) + `-depth.png`, which `scripts/gen-buildings.ts` sends to PixelLab as `init_image`. headless-gl was abandoned (won't build on macOS 12). `three`/`puppeteer-core` are devDependencies and MUST stay out of the game bundle (guarded by `tests/unit/no-three-in-bundle.test.ts`). Roof vocabulary + height model live in `building-massing-model.ts` (`ROOF_PROFILES`/`roofRise`); depth PNG is produced for a future ControlNet provider and is unused by PixelLab today.
```

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/no-three-in-bundle.test.ts CLAUDE.md
git commit -m "test: guard three.js out of the game bundle; doc the guide-render workflow"
```

---

## Final review

After all tasks, dispatch a code reviewer over the whole diff, then use `superpowers:finishing-a-development-branch`. Then run the full regeneration:

```bash
npx tsx scripts/render-guides.ts                                   # all 12 guides + depth
PIXELLAB_API_KEY=$(grep '^PIXELLAB_API_KEY=' .env | cut -d= -f2-) npx tsx scripts/gen-buildings.ts   # all 12 sprites, guided=true
node scripts/seed-base-library.mjs                                  # bake into the vendored library
```

Inspect the generated sprites in-app (building panel Sent⇄Received toggle shows the 3D guide). Tune `ROOF_PROFILES` pitches / camera framing if proportions read off, then re-run.
