# Blueprint Parameter Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `BuildingDescriptor` with a modular, class-neutral **Blueprint** authoring model — composable `Part`s + attached `Feature`s, assembled from a self-describing registry, authored as layered patches with a seeded resolve, compiling to geometry / collision / anchors / brief — and fold in the deferred door-sizing fix.

**Architecture:** A new `src/blueprint/` layer. `Blueprint` (authoring doc) → `mergePatches` (preset · era · agent) → `resolveBlueprint` (seeded default-fill via the part/feature registry) → `ResolvedBlueprint` → four pure compilers (`toGeometry`/`toCollision`/`toAnchors`/`toBrief`). The existing assetgen geometry (`prim:'building'` + `buildingFacets` manifold construction) is the **compile target**, unchanged. Building entities carry `properties.blueprint` instead of `properties.descriptor`. Clean cut: `BuildingDescriptor`, `descriptorToSpec`, the old presets, and `building-spec.ts` are deleted once the compilers are green; saved worlds need "New World" (already the norm).

**Tech Stack:** TypeScript ES modules, Vitest, manifold-3d WASM CSG (existing), `src/render/scale-contract.ts` for human-relative sizing.

---

## Architecture refinement (read before starting)

The spec's registry signatures (`FeatureType.toPrims`) were illustrative. Reality: the geometry engine renders a building as **one** `prim:'building'` (wings + `BuildingFeatures` together, so manifold computes correct hip/valley unions). Doors/vents are **not** standalone solids — they are fields on that prim, rendered by `buildingFacets`/`resolveFeatures`. Therefore:

- **Features do not emit prims.** A `FeatureType` has `resolve` (where the **door-size fix** lives — defaults derived from `scale-contract`), plus `toBriefPhrase` and an anchor offset. The **host part** reads its resolved features and folds them into its geometry. This preserves the spec's intent (door fix in `doorFeature.resolve`, features keyed by id, registry-driven) with the real geometry shape.
- **`toGeometry` aggregates.** Wing-bearing parts (`body`, `wing`) each emit a partial `prim:'building'`; the compiler merges them into ONE building prim (concat `wings`, merge `features`). Round/stepped bodies and `tower`/`porch`/`chimney`/`prim` parts emit their own standalone prims, appended alongside.
- **Collision** is precomputed at entity-build time: each part reports the structure-local cells it blocks; doors punch passable cells. Stored on the entity as `properties.blueprint` (carrying `footprint`, `blocked`, `doorCells`) so `building-collision.ts` reads concrete data, not live re-derivation.

This refinement is within the latitude the spec granted on naming/shape; the design intent is unchanged.

## File structure

**New (`src/blueprint/`):**
- `types.ts` — `Blueprint`, `Part`, `Feature`, `BlueprintPatch`, `ResolvedBlueprint`, `ResolvedPart`, `ResolvedFeature`, `Palette`, `BLUEPRINT_VERSION`. Re-exports `WallFace`, `Era`.
- `param-schema.ts` — `ParamSchema`, `validateParams` (enum/number-range/bool/string + defaults).
- `registry.ts` — `PartType`/`FeatureType` interfaces, `ResolveCtx`/`CompileCtx`, `registerPartType`/`registerFeatureType`/`getPartType`/`getFeatureType`/`listPartTypes`/`listFeatureTypes`.
- `resolve.ts` — `mergePatches`, `resolveBlueprint`.
- `parts/body.ts` — the `body` part (rect/L/cross/round/stepped — subsumes `descriptorToSpec`).
- `parts/wing.ts` — additive `wing` part.
- `parts/structural.ts` — `tower`, `porch`, `chimney`.
- `parts/prim.ts` — the `prim` escape hatch.
- `features/door.ts` — `door` feature (scale-contract sizing = the fix).
- `features/vent.ts` — `vent` feature.
- `features/window.ts` — `window` feature.
- `register-buildings.ts` — registers all building part/feature types (import for side effects).
- `compile/to-geometry.ts` — `toGeometry(rb): StructureSpec`.
- `compile/to-collision.ts` — `toCollision(rb): { footprint; blocked: string[]; doorCells: string[] }`.
- `compile/to-anchors.ts` — `toAnchors(rb, originX, originY): Anchor[]`.
- `compile/to-brief.ts` — `toBrief(rb, instanceSeed): AssetBrief`.
- `entity.ts` — `blueprintEntity(id, rb, x, y, extra?)`, `blueprintOf(entity)`.
- `presets/index.ts` + one file per preset family — the 11 migrated presets + `synthesizeBlueprint(name, patches?)`.

**Modified:**
- `src/render/iso/iso-renderer.ts` — read `properties.blueprint`, use its `footprint`/`structure` bbox.
- `src/render/parametric-building-source.ts` — key on blueprint, use `toGeometry`.
- `src/world/building-collision.ts` — read `blueprint.blocked`/`doorCells`.
- `src/world/anchors.ts` — `buildingAnchors` repointed to `toAnchors` (or deleted; callers use `toAnchors`).
- `src/world/building-placer.ts`, `src/sim/command/building-verbs.ts` — synth + place Blueprints.
- `src/render/ground-material.ts`, `src/render/selection-outline.ts`, `src/world/building-helpers.ts`, `src/render/building-massing-model.ts` — read blueprint.
- Tests across `tests/unit/` + `tests/integration/` repointed.

**Deleted:**
- `src/world/building-descriptor.ts`, `src/render/iso/building-spec.ts`, `src/world/building-presets.ts` (old).

---

## Phase 0 — Blueprint core (no existing consumers touched; build stays green)

### Task 1: Blueprint types + version

**Files:**
- Create: `src/blueprint/types.ts`
- Test: `tests/unit/blueprint-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-types.test.ts
import { describe, it, expect } from 'vitest';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

describe('blueprint types', () => {
  it('exposes a numeric schema version', () => {
    expect(typeof BLUEPRINT_VERSION).toBe('number');
    expect(BLUEPRINT_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('a minimal building blueprint type-checks and round-trips through JSON', () => {
    const bp: Blueprint = {
      version: BLUEPRINT_VERSION,
      class: 'building',
      footprint: { w: 3, h: 3 },
      parts: { body: { type: 'body', size: { w: 2, h: 2 } } },
    };
    expect(JSON.parse(JSON.stringify(bp))).toEqual(bp);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-types.test.ts`
Expected: FAIL — cannot find module `@/blueprint/types`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/types.ts
// The class-neutral structural authoring model. One Blueprint = the recipe for one
// object (a building today; a tree/wall/terrain feature later). Composable Parts +
// attached Features, assembled from the registry, authored as layered patches.
import type { Era } from '@/core/types';
import type { WallFace } from '@/assetgen/geometry/building';

export const BLUEPRINT_VERSION = 1;

export type EntityClass = 'building' | 'barrier' | 'plant' | 'terrain_feature';
export interface Palette { walls?: string; roof?: string; trim?: string }

/** An attached opening/fixture on a part: door / vent / window. Class-neutral. */
export interface Feature {
  type: string;                          // registry key
  face?: WallFace;
  params?: Record<string, unknown>;
}

/** A semantic component. `type` keys a PartType in the registry. */
export interface Part {
  type: string;
  at?: { x: number; y: number };         // structure-local tile origin (default 0,0)
  size?: { w: number; h: number };
  material?: string;                     // overrides blueprint material for this part
  params?: Record<string, unknown>;
  features?: Record<string, Feature>;
}

export interface Blueprint {
  version: number;
  class: EntityClass;
  preset?: string;                       // becomes entity.kind for presets
  era?: Era;
  category?: string;
  parts: Record<string, Part>;
  materials?: Record<string, string>;    // e.g. { walls:'timber', roof:'thatch' }
  palette?: Palette;
  footprint: { w: number; h: number };
  notes?: string;
}

/** A layer's contribution: a partial Blueprint. A part set to `null` is deleted. */
export type PartPatch = Part | null;
export interface BlueprintPatch {
  version?: number;
  class?: EntityClass;
  preset?: string;
  era?: Era;
  category?: string;
  parts?: Record<string, PartPatch>;
  materials?: Record<string, string>;
  palette?: Palette;
  footprint?: { w: number; h: number };
  notes?: string;
}

/** Every field concrete; semantic structure intact. Output of resolveBlueprint. */
export interface ResolvedFeature {
  id: string;
  type: string;
  face?: WallFace;
  params: Record<string, unknown>;       // every param filled
}
export interface ResolvedPart {
  id: string;
  type: string;
  at: { x: number; y: number };
  size: { w: number; h: number };
  material?: string;
  params: Record<string, unknown>;
  features: ResolvedFeature[];
}
export interface ResolvedBlueprint {
  version: number;
  class: EntityClass;
  preset?: string;
  era?: Era;
  category?: string;
  parts: ResolvedPart[];                 // ordered (stable by insertion)
  materials: Record<string, string>;
  palette: Palette;
  footprint: { w: number; h: number };
  notes?: string;
}

export type { WallFace, Era };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-types.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/types.ts tests/unit/blueprint-types.test.ts
git commit -m "feat(blueprint): core types + schema version"
```

---

### Task 2: ParamSchema + validateParams

**Files:**
- Create: `src/blueprint/param-schema.ts`
- Test: `tests/unit/blueprint-param-schema.test.ts`

A `ParamSchema` is the per-field contract a registry entry publishes. It both **validates** authored params and **auto-documents** the part for agents (future Fate tool-schema). `validateParams` fills defaults and throws on bad values.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-param-schema.test.ts
import { describe, it, expect } from 'vitest';
import { validateParams, type ParamSchema } from '@/blueprint/param-schema';

const schema: ParamSchema = {
  levels: { kind: 'number', min: 1, max: 8, default: 1 },
  roof: { kind: 'enum', values: ['gable', 'hip', 'flat'], default: 'gable' },
  grand: { kind: 'bool', default: false },
};

describe('validateParams', () => {
  it('fills defaults for unspecified params', () => {
    expect(validateParams(schema, {})).toEqual({ levels: 1, roof: 'gable', grand: false });
  });

  it('keeps valid provided values', () => {
    expect(validateParams(schema, { levels: 3, roof: 'hip' }))
      .toEqual({ levels: 3, roof: 'hip', grand: false });
  });

  it('clamps numbers outside the range', () => {
    expect(validateParams(schema, { levels: 99 }).levels).toBe(8);
    expect(validateParams(schema, { levels: 0 }).levels).toBe(1);
  });

  it('throws on an unknown enum value', () => {
    expect(() => validateParams(schema, { roof: 'banana' })).toThrow(/roof/);
  });

  it('throws on an unknown param key', () => {
    expect(() => validateParams(schema, { nope: 1 })).toThrow(/nope/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-param-schema.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/param-schema.ts
// A field-level contract per registry entry: validates authored params AND
// auto-documents the knob for agents (the registry IS the capability catalogue).
export type ParamSpec =
  | { kind: 'number'; min?: number; max?: number; default: number; doc?: string }
  | { kind: 'enum'; values: readonly string[]; default: string; doc?: string }
  | { kind: 'bool'; default: boolean; doc?: string }
  | { kind: 'string'; default?: string; doc?: string };

export type ParamSchema = Record<string, ParamSpec>;

const clamp = (v: number, lo: number | undefined, hi: number | undefined): number => {
  if (lo !== undefined && v < lo) return lo;
  if (hi !== undefined && v > hi) return hi;
  return v;
};

/** Validate `params` against `schema`, returning a fully-defaulted object. Throws on
 *  unknown keys, wrong types, or out-of-enum values; clamps numbers into range. */
export function validateParams(
  schema: ParamSchema, params: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const key of Object.keys(params)) {
    if (!(key in schema)) throw new Error(`unknown param "${key}" (valid: ${Object.keys(schema).join(', ')})`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    const raw = params[key];
    if (raw === undefined) { out[key] = spec.default; continue; }
    switch (spec.kind) {
      case 'number': {
        if (typeof raw !== 'number' || Number.isNaN(raw)) throw new Error(`param "${key}" must be a number`);
        out[key] = clamp(raw, spec.min, spec.max); break;
      }
      case 'enum': {
        if (!spec.values.includes(raw as string)) throw new Error(`param "${key}" must be one of ${spec.values.join('|')}, got "${String(raw)}"`);
        out[key] = raw; break;
      }
      case 'bool': {
        if (typeof raw !== 'boolean') throw new Error(`param "${key}" must be a boolean`);
        out[key] = raw; break;
      }
      case 'string': {
        if (typeof raw !== 'string') throw new Error(`param "${key}" must be a string`);
        out[key] = raw; break;
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-param-schema.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/param-schema.ts tests/unit/blueprint-param-schema.test.ts
git commit -m "feat(blueprint): ParamSchema + validateParams (defaults, clamps, enum guard)"
```

---

### Task 3: Part/Feature registry

**Files:**
- Create: `src/blueprint/registry.ts`
- Test: `tests/unit/blueprint-registry.test.ts`

**Note on compile contract (per the architecture refinement):** parts produce assetgen `Part[]` (prims) plus collision cells, anchors, and a brief phrase; features produce only a `resolve` (the door fix), a brief phrase, and an anchor offset — the host part folds them in. Registry stores both kinds.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPartType, getPartType, listPartTypes,
  registerFeatureType, getFeatureType, _resetRegistryForTest, type PartType,
} from '@/blueprint/registry';

const stub: PartType = {
  type: 'stub',
  paramSchema: { h: { kind: 'number', default: 1 } },
  resolve: (p) => ({ params: { ...(p.params ?? {}) } }),
  toPrims: () => [],
  toCollision: () => [],
  toAnchors: () => [],
  toBrief: () => 'stub',
};

describe('blueprint registry', () => {
  beforeEach(() => _resetRegistryForTest());

  it('registers and retrieves a part type', () => {
    registerPartType(stub);
    expect(getPartType('stub')).toBe(stub);
  });

  it('lists registered part types (the agent capability catalogue)', () => {
    registerPartType(stub);
    expect(listPartTypes().map(p => p.type)).toContain('stub');
  });

  it('throws on an unknown part type', () => {
    expect(() => getPartType('ghost')).toThrow(/ghost/);
  });

  it('throws on duplicate registration', () => {
    registerPartType(stub);
    expect(() => registerPartType(stub)).toThrow(/already registered/);
  });

  it('returns undefined for an unknown feature type without throwing', () => {
    expect(getFeatureType('ghost')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-registry.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/registry.ts
// Two self-describing registries. Adding a part/feature = one registration; no
// consumer edits. paramSchema on each entry is the agent's capability catalogue.
import type { Part, Feature, ResolvedPart, ResolvedFeature } from './types';
import type { ParamSchema } from './param-schema';
import type { Part as Prim } from '@/assetgen/compose';

/** Context passed to resolve (seed-fill) — deterministic. */
export interface ResolveCtx {
  seed: number;
  materials: Record<string, string>;
}
/** Context passed to compile (geometry/collision/anchors/brief). */
export interface CompileCtx {
  materials: Record<string, string>;
  footprint: { w: number; h: number };
}

/** A part type contributes geometry, blocked cells, anchors, and a brief phrase. */
export interface PartType {
  type: string;
  paramSchema: ParamSchema;
  /** Fill type-specific defaults (params already schema-validated by the resolver). */
  resolve(part: Part, ctx: ResolveCtx): { params: Record<string, unknown> };
  /** assetgen prims. Wing-bearing parts return a `prim:'building'`; the compiler merges them. */
  toPrims(p: ResolvedPart, ctx: CompileCtx): Prim[];
  /** Structure-local cells this part blocks (collision). */
  toCollision(p: ResolvedPart, ctx: CompileCtx): Array<[number, number]>;
  /** World-offset anchors (relative to footprint top-left). */
  toAnchors(p: ResolvedPart, ctx: CompileCtx): Array<{ kind: string; x: number; y: number; facing: [number, number]; main?: boolean; width?: number }>;
  /** Phrase for the generative brief. */
  toBrief(p: ResolvedPart, ctx: CompileCtx): string;
}

/** A feature type resolves (door-size fix lives here) and contributes a brief phrase. */
export interface FeatureType {
  type: string;
  paramSchema: ParamSchema;
  resolve(f: Feature, ctx: ResolveCtx): { params: Record<string, unknown> };
  toBrief(f: ResolvedFeature, ctx: CompileCtx): string;
}

let parts = new Map<string, PartType>();
let features = new Map<string, FeatureType>();

export function registerPartType(pt: PartType): void {
  if (parts.has(pt.type)) throw new Error(`part type "${pt.type}" already registered`);
  parts.set(pt.type, pt);
}
export function registerFeatureType(ft: FeatureType): void {
  if (features.has(ft.type)) throw new Error(`feature type "${ft.type}" already registered`);
  features.set(ft.type, ft);
}
export function getPartType(type: string): PartType {
  const pt = parts.get(type);
  if (!pt) throw new Error(`unknown part type "${type}"`);
  return pt;
}
export function getFeatureType(type: string): FeatureType | undefined { return features.get(type); }
export function listPartTypes(): PartType[] { return [...parts.values()]; }
export function listFeatureTypes(): FeatureType[] { return [...features.values()]; }

/** Test-only: clear both registries. */
export function _resetRegistryForTest(): void { parts = new Map(); features = new Map(); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-registry.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/registry.ts tests/unit/blueprint-registry.test.ts
git commit -m "feat(blueprint): self-describing part/feature registry"
```

---

### Task 4: Resolution pipeline (mergePatches + resolveBlueprint)

**Files:**
- Create: `src/blueprint/resolve.ts`
- Test: `tests/unit/blueprint-resolve.test.ts`

`mergePatches` deep-merges scalars (last-wins), merges parts by id (tweak/add), and deletes a part when a patch sets it to `null`. `resolveBlueprint` then runs the seeded resolve pass: validate+default each part's and feature's params via the registry, fill `at`/`size`, produce a `ResolvedBlueprint`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-resolve.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mergePatches, resolveBlueprint } from '@/blueprint/resolve';
import {
  registerPartType, registerFeatureType, _resetRegistryForTest,
  type PartType, type FeatureType,
} from '@/blueprint/registry';
import { BLUEPRINT_VERSION, type Blueprint, type BlueprintPatch } from '@/blueprint/types';

const body: PartType = {
  type: 'body',
  paramSchema: { levels: { kind: 'number', min: 1, max: 8, default: 1 } },
  resolve: (p) => ({ params: { levels: (p.params?.levels as number) ?? 1 } }),
  toPrims: () => [], toCollision: () => [], toAnchors: () => [], toBrief: () => 'body',
};
const door: FeatureType = {
  type: 'door',
  paramSchema: { height: { kind: 'number', default: 0.85 } },
  resolve: (f) => ({ params: { height: (f.params?.height as number) ?? 0.85 } }),
  toBrief: () => 'door',
};

const base: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
  materials: { walls: 'timber' },
  parts: { body: { type: 'body', size: { w: 2, h: 2 }, features: { d: { type: 'door', face: 'south' } } } },
};

describe('mergePatches', () => {
  it('last-wins on scalars', () => {
    const m = mergePatches([base, { era: 'classical' }]);
    expect(m.era).toBe('classical');
  });
  it('tweaks one part param by id without dropping siblings', () => {
    const m = mergePatches([base, { parts: { body: { type: 'body', params: { levels: 3 } } } }]);
    expect(m.parts.body.params?.levels).toBe(3);
    expect(m.parts.body.size).toEqual({ w: 2, h: 2 });  // preserved
  });
  it('adds a new part', () => {
    const m = mergePatches([base, { parts: { chimney: { type: 'chimney' } } }]);
    expect(Object.keys(m.parts).sort()).toEqual(['body', 'chimney']);
  });
  it('deletes a part when a patch sets it to null', () => {
    const m = mergePatches([base, { parts: { body: null } }]);
    expect(m.parts.body).toBeUndefined();
  });
});

describe('resolveBlueprint', () => {
  beforeEach(() => { _resetRegistryForTest(); registerPartType(body); registerFeatureType(door); });
  it('produces ordered resolved parts with filled params + resolved features', () => {
    const rb = resolveBlueprint([base], 0);
    expect(rb.parts).toHaveLength(1);
    expect(rb.parts[0].id).toBe('body');
    expect(rb.parts[0].params.levels).toBe(1);
    expect(rb.parts[0].features[0].type).toBe('door');
    expect(rb.parts[0].features[0].params.height).toBe(0.85);
  });
  it('defaults at to (0,0) and carries footprint + materials', () => {
    const rb = resolveBlueprint([base], 0);
    expect(rb.parts[0].at).toEqual({ x: 0, y: 0 });
    expect(rb.footprint).toEqual({ w: 3, h: 3 });
    expect(rb.materials.walls).toBe('timber');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-resolve.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/resolve.ts
import type {
  Blueprint, BlueprintPatch, Part, ResolvedBlueprint, ResolvedPart, ResolvedFeature,
} from './types';
import { BLUEPRINT_VERSION } from './types';
import { getPartType, getFeatureType, type ResolveCtx } from './registry';
import { validateParams } from './param-schema';

/** Deep-merge an ordered list of patches: scalars last-wins, parts by id (null deletes). */
export function mergePatches(patches: BlueprintPatch[]): Blueprint {
  const out: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 1, h: 1 }, parts: {},
  };
  for (const p of patches) {
    if (p.version !== undefined) out.version = p.version;
    if (p.class !== undefined) out.class = p.class;
    if (p.preset !== undefined) out.preset = p.preset;
    if (p.era !== undefined) out.era = p.era;
    if (p.category !== undefined) out.category = p.category;
    if (p.footprint !== undefined) out.footprint = { ...p.footprint };
    if (p.notes !== undefined) out.notes = p.notes;
    if (p.materials) out.materials = { ...out.materials, ...p.materials };
    if (p.palette) out.palette = { ...out.palette, ...p.palette };
    if (p.parts) {
      for (const [id, patch] of Object.entries(p.parts)) {
        if (patch === null) { delete out.parts[id]; continue; }
        const prev = out.parts[id];
        out.parts[id] = prev ? mergePart(prev, patch) : structuredClone(patch);
      }
    }
  }
  return out;
}

function mergePart(prev: Part, patch: Part): Part {
  return {
    ...prev, ...patch,
    at: patch.at ?? prev.at,
    size: patch.size ?? prev.size,
    params: { ...prev.params, ...patch.params },
    features: { ...prev.features, ...patch.features },
  };
}

/** Merge patches, then run the seeded resolve pass (registry-driven default fill). */
export function resolveBlueprint(patches: BlueprintPatch[], seed: number): ResolvedBlueprint {
  const bp = mergePatches(patches);
  const materials = bp.materials ?? {};
  const ctx: ResolveCtx = { seed, materials };

  const parts: ResolvedPart[] = Object.entries(bp.parts).map(([id, part]) => {
    const pt = getPartType(part.type);
    const validated = validateParams(pt.paramSchema, part.params ?? {});
    const { params } = pt.resolve({ ...part, params: validated }, ctx);
    const features: ResolvedFeature[] = Object.entries(part.features ?? {}).map(([fid, f]) => {
      const ft = getFeatureType(f.type);
      if (!ft) throw new Error(`unknown feature type "${f.type}"`);
      const fv = validateParams(ft.paramSchema, f.params ?? {});
      const { params: fp } = ft.resolve({ ...f, params: fv }, ctx);
      return { id: fid, type: f.type, face: f.face, params: fp };
    });
    return {
      id, type: part.type,
      at: part.at ?? { x: 0, y: 0 },
      size: part.size ?? { w: bp.footprint.w, h: bp.footprint.h },
      material: part.material,
      params, features,
    };
  });

  return {
    version: bp.version, class: bp.class, preset: bp.preset, era: bp.era,
    category: bp.category, parts, materials, palette: bp.palette ?? {},
    footprint: bp.footprint, notes: bp.notes,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-resolve.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/resolve.ts tests/unit/blueprint-resolve.test.ts
git commit -m "feat(blueprint): resolution pipeline (patch merge + seeded resolve)"
```

---

## Phase 1 — Building part & feature types

### Task 5: `body` part type (subsumes descriptorToSpec geometry)

**Files:**
- Create: `src/blueprint/parts/body.ts`
- Test: `tests/unit/blueprint-body-part.test.ts`

The `body` part is the building massing. `params`: `plan` (rect|round|L|cross|stepped), `levels`, `levelInset`, `heightPerLevel`, `roof`. `size`/`at` = the structure rect within the plot. `toPrims`:
- `rect`/`L`/`cross` → one `prim:'building'` carrying the wing(s) for that plan and `BuildingFeatures` folded from the part's resolved door/vent features (via helpers in Task 10's compiler — here `toPrims` builds wings + a marker so the compiler can attach features).
- `round` → cylinder + cone/ellipsoid prims.
- `stepped` → stacked inset boxes.

To keep `toPrims` pure and let the compiler attach features uniformly, `body.toPrims` returns the geometry **without** features; the compiler (Task 10) reads `ResolvedPart.features` and injects `BuildingFeatures` into the building prim. `body` exposes helpers `bodyWings(p)` and material mapping used by the compiler.

This task ports the mapping tables and `planWings`/`roundParts`/`steppedParts` from the current `building-spec.ts` verbatim (behavior-preserving), keyed off `params` instead of descriptor fields.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-body-part.test.ts
import { describe, it, expect } from 'vitest';
import { bodyPartType, bodyWings, WALL_MAT, ROOF_MAT, ROOF_KIND } from '@/blueprint/parts/body';
import type { ResolvedPart } from '@/blueprint/types';

function part(params: Record<string, unknown>, size = { w: 3, h: 3 }): ResolvedPart {
  return { id: 'body', type: 'body', at: { x: 0, y: 0 }, size, params, features: [] };
}
const ctx = { materials: { walls: 'timber', roof: 'thatch' }, footprint: { w: 3, h: 3 } };

describe('body part — wings', () => {
  it('rect plan → one wing covering the structure', () => {
    expect(bodyWings(part({ plan: 'rect', levels: 1, roof: 'gable' }))).toEqual([{ x: 0, y: 0, w: 3, h: 3 }]);
  });
  it('cross plan → nave + transept', () => {
    expect(bodyWings(part({ plan: 'cross', levels: 1, roof: 'hip' })).length).toBe(2);
  });
});

describe('body part — toPrims', () => {
  it('rect → a single building prim', () => {
    const prims = bodyPartType.toPrims(part({ plan: 'rect', levels: 2, roof: 'gable' }), ctx);
    expect(prims).toHaveLength(1);
    expect(prims[0].prim).toBe('building');
    if (prims[0].prim === 'building') {
      expect(prims[0].wings[0]).toMatchObject({ x: 0, y: 0, w: 3, h: 3, storeys: 2 });
      expect(prims[0].wallMat).toBe('timber');
      expect(prims[0].roofMat).toBe('thatch');
    }
  });
  it('round → cylinder + cap prims', () => {
    const prims = bodyPartType.toPrims(part({ plan: 'round', levels: 1, roof: 'domed' }, { w: 2, h: 2 }), ctx);
    expect(prims.map(p => p.prim)).toEqual(['cylinder', 'ellipsoid']);
  });
  it('stepped → stacked boxes', () => {
    const prims = bodyPartType.toPrims(part({ plan: 'stepped', levels: 3, levelInset: 1, roof: 'stepped' }), ctx);
    expect(prims.every(p => p.prim === 'box')).toBe(true);
    expect(prims.length).toBeGreaterThanOrEqual(1);
  });
});

describe('body part — material maps', () => {
  it('maps wall + roof + roof-kind tables', () => {
    expect(WALL_MAT.timber).toBe('timber');
    expect(ROOF_MAT.thatch).toBe('thatch');
    expect(ROOF_KIND.conical).toBe('pyramidal');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-body-part.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/parts/body.ts
// The building massing part. Ports the descriptor→geometry mapping (formerly
// building-spec.ts) onto the Blueprint registry, keyed off params not descriptor fields.
import type { Part, ResolvedPart } from '../types';
import type { PartType, CompileCtx, ResolveCtx } from '../registry';
import type { Mat } from '@/assetgen/types';
import type { Wing, RoofKind } from '@/assetgen/geometry/building';
import { STOREY } from '@/assetgen/geometry/building';
import type { Part as Prim } from '@/assetgen/compose';
import { Anchor } from '@/world/anchors';

export type Plan = 'rect' | 'round' | 'L' | 'cross' | 'stepped';

export const WALL_MAT: Record<string, Mat> = {
  mud: 'plaster', wattle: 'plaster', hide: 'plaster',
  timber: 'timber', log: 'timber', brick: 'brick', stone: 'stone', marble: 'stone',
};
export const ROOF_MAT: Record<string, Mat> = {
  thatch: 'thatch', hide: 'thatch', wood: 'timber', tile: 'tile', slate: 'stone', none: 'tile',
};
export const ROOF_KIND: Record<string, RoofKind> = {
  gable: 'gable', gambrel: 'gable', mansard: 'gable', saltbox: 'gable',
  jerkinhead: 'gable', cross_gable: 'gable', lean_to: 'gable',
  hip: 'hip',
  pyramidal: 'pyramidal', conical: 'pyramidal', spire: 'pyramidal',
  tented: 'pyramidal', onion: 'pyramidal', domed: 'pyramidal',
  flat: 'flat', stepped: 'flat',
};

const wallMatOf = (ctx: CompileCtx) => WALL_MAT[ctx.materials.walls] ?? 'plaster';
const roofMatOf = (ctx: CompileCtx) => ROOF_MAT[ctx.materials.roof] ?? 'tile';

/** Wing rectangles for a plan, structure-local (origin 0,0). Ported from building-spec.ts. */
export function bodyWings(p: ResolvedPart): Array<{ x: number; y: number; w: number; h: number }> {
  const { w, h } = p.size;
  switch (p.params.plan as Plan) {
    case 'cross': {
      const naveH = Math.max(1, Math.round(h / 2));
      const transW = Math.max(1, Math.round(w / 2));
      return [
        { x: 0, y: Math.floor((h - naveH) / 2), w, h: naveH },
        { x: Math.floor((w - transW) / 2), y: 0, w: transW, h },
      ];
    }
    case 'L': {
      const barH = Math.max(1, Math.round(h / 2));
      const armW = Math.max(1, Math.round(w / 2));
      return [{ x: 0, y: 0, w, h: barH }, { x: 0, y: 0, w: armW, h }];
    }
    default:
      return [{ x: 0, y: 0, w, h }];
  }
}

function roundPrims(p: ResolvedPart, ctx: CompileCtx): Prim[] {
  const { w, h } = p.size;
  const r = Math.min(w, h) / 2, cx = w / 2, cy = h / 2;
  const wallH = Math.max(1, p.params.levels as number) * STOREY;
  const out: Prim[] = [{ prim: 'cylinder', center: [cx, cy], baseZ: 0, radius: r, height: wallH, material: wallMatOf(ctx) }];
  const roof = p.params.roof as string;
  if (roof === 'flat') return out;
  if (roof === 'domed' || roof === 'onion') {
    out.push({ prim: 'ellipsoid', center: [cx, cy], baseZ: wallH, radii: [r, r, r * 0.8], material: roofMatOf(ctx) });
  } else {
    out.push({ prim: 'cone', center: [cx, cy], baseZ: wallH, radius: r, height: r * 1.2, material: roofMatOf(ctx) });
  }
  return out;
}

function steppedPrims(p: ResolvedPart, ctx: CompileCtx): Prim[] {
  const levels = Math.max(1, p.params.levels as number);
  const inset = Math.max(0, p.params.levelInset as number);
  const mat = wallMatOf(ctx);
  const out: Prim[] = [];
  for (let lvl = 0; lvl < levels; lvl++) {
    const off = inset * lvl;
    const w = p.size.w - 2 * off, h = p.size.h - 2 * off;
    if (w <= 0 || h <= 0) break;
    out.push({ prim: 'box', at: [off + p.at.x, off + p.at.y, lvl * STOREY], size: [w, h, STOREY], material: mat });
  }
  return out;
}

export const bodyPartType: PartType = {
  type: 'body',
  paramSchema: {
    plan: { kind: 'enum', values: ['rect', 'round', 'L', 'cross', 'stepped'], default: 'rect' },
    levels: { kind: 'number', min: 1, max: 8, default: 1 },
    levelInset: { kind: 'number', min: 0, max: 3, default: 0 },
    heightPerLevel: { kind: 'number', min: 0.1, max: 4, default: 1 },
    roof: {
      kind: 'enum',
      values: [
        'flat', 'gable', 'hip', 'conical', 'domed', 'stepped', 'lean_to',
        'gambrel', 'mansard', 'pyramidal', 'saltbox', 'onion', 'spire',
        'tented', 'jerkinhead', 'cross_gable',
      ],
      default: 'gable',
    },
  },
  resolve: (part: Part, _ctx: ResolveCtx) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx) {
    const plan = p.params.plan as Plan;
    if (plan === 'round') return roundPrims(p, ctx);
    if (plan === 'stepped') return steppedPrims(p, ctx);
    const storeys = Math.max(1, p.params.levels as number);
    const wings: Wing[] = bodyWings(p).map(r => ({
      x: r.x + p.at.x, y: r.y + p.at.y, w: r.w, h: r.h, storeys,
      roof: ROOF_KIND[p.params.roof as string] ?? 'gable',
    }));
    return [{
      prim: 'building', wings,
      wallMat: wallMatOf(ctx), roofMat: roofMatOf(ctx), roofStyle: 'gable',
      features: {}, seed: 0,
    }];
  },
  toCollision(p) {
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
    return cells;
  },
  toAnchors: () => [],   // doors live on features; see to-anchors compiler
  toBrief(p) {
    const plan = p.params.plan as Plan;
    const planTrait = plan === 'round' ? 'round plan'
      : plan === 'stepped' ? 'stepped tiers'
      : plan === 'L' ? 'L-shaped plan'
      : plan === 'cross' ? 'cross-shaped plan' : '';
    const levels = Math.max(1, p.params.levels as number);
    const storey = levels === 1 ? 'single-storey' : `${levels} storeys`;
    return [storey, `${(p.params.roof as string).replace('_', '-')} roof`, planTrait].filter(Boolean).join(', ');
  },
};

export type { Anchor };
```

> Note: the `import { Anchor }` / re-export line is a type-only convenience; if tsc flags it, change to `import type { Anchor } from '@/world/anchors';` and drop the `export type { Anchor }` line. The compiler tasks import `Anchor` from `@/world/anchors` directly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-body-part.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/parts/body.ts tests/unit/blueprint-body-part.test.ts
git commit -m "feat(blueprint): body part type (rect/round/L/cross/stepped massing)"
```

---

### Task 6: `wing` + `prim` part types

**Files:**
- Create: `src/blueprint/parts/wing.ts`, `src/blueprint/parts/prim.ts`
- Test: `tests/unit/blueprint-wing-prim-parts.test.ts`

`wing` = an additive rectangular wing (its `size`/`at`/`params.roof` → one `prim:'building'` wing the compiler merges into the body's building prim). `prim` = the escape hatch: `params.prim` is a raw assetgen `Part` (validated only as "is an object"), passed through unchanged — covers anything unregistered.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-wing-prim-parts.test.ts
import { describe, it, expect } from 'vitest';
import { wingPartType } from '@/blueprint/parts/wing';
import { primPartType } from '@/blueprint/parts/prim';
import type { ResolvedPart } from '@/blueprint/types';

const ctx = { materials: { walls: 'stone', roof: 'tile' }, footprint: { w: 5, h: 5 } };

describe('wing part', () => {
  it('emits one building prim wing at its offset', () => {
    const p: ResolvedPart = { id: 'ell', type: 'wing', at: { x: 2, y: 0 }, size: { w: 2, h: 3 }, params: { levels: 1, roof: 'gable' }, features: [] };
    const prims = wingPartType.toPrims(p, ctx);
    expect(prims).toHaveLength(1);
    if (prims[0].prim === 'building') expect(prims[0].wings[0]).toMatchObject({ x: 2, y: 0, w: 2, h: 3 });
  });
  it('blocks its own cells', () => {
    const p: ResolvedPart = { id: 'ell', type: 'wing', at: { x: 2, y: 0 }, size: { w: 1, h: 2 }, params: { levels: 1, roof: 'gable' }, features: [] };
    expect(wingPartType.toCollision(p, ctx).sort()).toEqual([[2, 0], [2, 1]]);
  });
});

describe('prim escape part', () => {
  it('passes a raw assetgen prim through unchanged', () => {
    const raw = { prim: 'box', at: [0, 0, 0], size: [1, 1, 1], material: 'stone' };
    const p: ResolvedPart = { id: 'x', type: 'prim', at: { x: 0, y: 0 }, size: { w: 1, h: 1 }, params: { prim: raw }, features: [] };
    expect(primPartType.toPrims(p, ctx)).toEqual([raw]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-wing-prim-parts.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/parts/wing.ts
import type { PartType, CompileCtx } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';
import type { Wing, RoofKind } from '@/assetgen/geometry/building';
import { WALL_MAT, ROOF_MAT, ROOF_KIND } from './body';

export const wingPartType: PartType = {
  type: 'wing',
  paramSchema: {
    levels: { kind: 'number', min: 1, max: 8, default: 1 },
    roof: { kind: 'enum', values: ['flat', 'gable', 'hip', 'pyramidal', 'lean_to', 'conical', 'domed'], default: 'gable' },
  },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx: CompileCtx): Prim[] {
    const wing: Wing = {
      x: p.at.x, y: p.at.y, w: p.size.w, h: p.size.h,
      storeys: Math.max(1, p.params.levels as number),
      roof: (ROOF_KIND[p.params.roof as string] ?? 'gable') as RoofKind,
    };
    return [{
      prim: 'building', wings: [wing],
      wallMat: WALL_MAT[ctx.materials.walls] ?? 'plaster',
      roofMat: ROOF_MAT[ctx.materials.roof] ?? 'tile',
      roofStyle: 'gable', features: {}, seed: 0,
    }];
  },
  toCollision(p) {
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
    return cells;
  },
  toAnchors: () => [],
  toBrief: () => 'wing',
};
```

```ts
// src/blueprint/parts/prim.ts
// Escape hatch: drop a raw assetgen prim in `params.prim` for anything the semantic
// part vocabulary doesn't (yet) cover. Passed through to the geometry compiler verbatim.
import type { PartType } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';

export const primPartType: PartType = {
  type: 'prim',
  paramSchema: { prim: { kind: 'string', doc: 'raw assetgen Part object (passed through)' } as never },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p): Prim[] {
    const raw = p.params.prim;
    return raw && typeof raw === 'object' ? [raw as Prim] : [];
  },
  toCollision(p) {
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
    return cells;
  },
  toAnchors: () => [],
  toBrief: () => '',
};
```

> The `prim` schema's `prim` field bypasses normal validation (it holds an object, not a scalar). `validateParams` is called with it present; to avoid a type error, the `prim` part's `paramSchema` declares `prim` loosely and `validateParams` will accept any object since the spec kind is `string` — **adjust**: in `param-schema.ts` add a `kind: 'any'` spec (`{ kind: 'any'; default?: unknown }`) that accepts anything, and use it here (`prim: { kind: 'any' }`). Add a one-line test for `kind: 'any'` in the param-schema test and implement the passthrough case. Make that edit as part of this task.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/blueprint-wing-prim-parts.test.ts tests/unit/blueprint-param-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/parts/wing.ts src/blueprint/parts/prim.ts src/blueprint/param-schema.ts tests/unit/blueprint-wing-prim-parts.test.ts tests/unit/blueprint-param-schema.test.ts
git commit -m "feat(blueprint): wing + prim (escape) part types; ParamSchema 'any' kind"
```

---

### Task 7: `tower`, `porch`, `chimney` part types

**Files:**
- Create: `src/blueprint/parts/structural.ts`
- Test: `tests/unit/blueprint-structural-parts.test.ts`

Compact additive parts the spec lists for build-now (no preset exercises them yet, but they round out the v1 vocabulary and prove the multi-part model). `tower` = a square or round vertical mass with its own roof; `porch` = a low lean-to box against the body; `chimney` = a brick stack (a `box` prim) at a structure-local cell.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-structural-parts.test.ts
import { describe, it, expect } from 'vitest';
import { towerPartType, porchPartType, chimneyPartType } from '@/blueprint/parts/structural';
import type { ResolvedPart } from '@/blueprint/types';

const ctx = { materials: { walls: 'stone', roof: 'slate' }, footprint: { w: 4, h: 4 } };
const rp = (type: string, params: Record<string, unknown>, at = { x: 0, y: 0 }, size = { w: 1, h: 1 }): ResolvedPart =>
  ({ id: type, type, at, size, params, features: [] });

describe('structural parts', () => {
  it('square tower → a box prim', () => {
    const prims = towerPartType.toPrims(rp('tower', { levels: 3, shape: 'square', roof: 'pyramidal' }, { x: 0, y: 0 }, { w: 1, h: 1 }), ctx);
    expect(prims.some(p => p.prim === 'box')).toBe(true);
  });
  it('round tower → a cylinder prim', () => {
    const prims = towerPartType.toPrims(rp('tower', { levels: 3, shape: 'round', roof: 'conical' }, { x: 0, y: 0 }, { w: 2, h: 2 }), ctx);
    expect(prims.some(p => p.prim === 'cylinder')).toBe(true);
  });
  it('porch → a low box prim', () => {
    const prims = porchPartType.toPrims(rp('porch', { depth: 1 }, { x: 1, y: 3 }, { w: 2, h: 1 }), ctx);
    expect(prims[0].prim).toBe('box');
  });
  it('chimney → a thin box prim and blocks no cells', () => {
    const p = rp('chimney', { height: 1.5 }, { x: 1, y: 0 }, { w: 1, h: 1 });
    expect(chimneyPartType.toPrims(p, ctx)[0].prim).toBe('box');
    expect(chimneyPartType.toCollision(p, ctx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-structural-parts.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/parts/structural.ts
// Additive structural parts: tower, porch, chimney. Each emits standalone prims the
// geometry compiler unions alongside the body's building prim.
import type { PartType, CompileCtx } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';
import { STOREY } from '@/assetgen/geometry/building';
import { WALL_MAT, ROOF_MAT } from './body';

const cellsOf = (p: { at: { x: number; y: number }; size: { w: number; h: number } }): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) out.push([p.at.x + i, p.at.y + j]);
  return out;
};

export const towerPartType: PartType = {
  type: 'tower',
  paramSchema: {
    levels: { kind: 'number', min: 1, max: 12, default: 3 },
    shape: { kind: 'enum', values: ['square', 'round'], default: 'square' },
    roof: { kind: 'enum', values: ['flat', 'pyramidal', 'conical', 'domed'], default: 'pyramidal' },
  },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx: CompileCtx): Prim[] {
    const wallMat = WALL_MAT[ctx.materials.walls] ?? 'stone';
    const roofMat = ROOF_MAT[ctx.materials.roof] ?? 'stone';
    const h = Math.max(1, p.params.levels as number) * STOREY;
    if (p.params.shape === 'round') {
      const r = Math.min(p.size.w, p.size.h) / 2, cx = p.at.x + p.size.w / 2, cy = p.at.y + p.size.h / 2;
      const out: Prim[] = [{ prim: 'cylinder', center: [cx, cy], baseZ: 0, radius: r, height: h, material: wallMat }];
      if (p.params.roof !== 'flat') out.push({ prim: 'cone', center: [cx, cy], baseZ: h, radius: r, height: r * 1.2, material: roofMat });
      return out;
    }
    const out: Prim[] = [{ prim: 'box', at: [p.at.x, p.at.y, 0], size: [p.size.w, p.size.h, h], material: wallMat }];
    if (p.params.roof !== 'flat') {
      const cx = p.at.x + p.size.w / 2, cy = p.at.y + p.size.h / 2, r = Math.min(p.size.w, p.size.h) / 2;
      out.push({ prim: 'cone', center: [cx, cy], baseZ: h, radius: r, height: r, material: roofMat });
    }
    return out;
  },
  toCollision: (p) => cellsOf(p),
  toAnchors: () => [],
  toBrief: (p) => `${p.params.shape} tower`,
};

export const porchPartType: PartType = {
  type: 'porch',
  paramSchema: { depth: { kind: 'number', min: 1, max: 3, default: 1 } },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx: CompileCtx): Prim[] {
    const wallMat = WALL_MAT[ctx.materials.walls] ?? 'timber';
    return [{ prim: 'box', at: [p.at.x, p.at.y, 0], size: [p.size.w, p.size.h, STOREY * 0.6], material: wallMat }];
  },
  toCollision: (p) => cellsOf(p),
  toAnchors: () => [],
  toBrief: () => 'covered porch',
};

export const chimneyPartType: PartType = {
  type: 'chimney',
  paramSchema: { height: { kind: 'number', min: 0.2, max: 3, default: 1 } },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p): Prim[] {
    const top = Math.max(1, 1) * STOREY + (p.params.height as number);
    return [{ prim: 'box', at: [p.at.x + 0.3, p.at.y + 0.3, 0], size: [0.4, 0.4, top], material: 'brick' }];
  },
  toCollision: () => [],         // a chimney rides the roof; it blocks no ground cell
  toAnchors: () => [],
  toBrief: () => 'chimney',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-structural-parts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/parts/structural.ts tests/unit/blueprint-structural-parts.test.ts
git commit -m "feat(blueprint): tower/porch/chimney structural part types"
```

---

### Task 8: `door` feature — scale-contract sizing (the deferred fix)

**Files:**
- Create: `src/blueprint/features/door.ts`
- Test: `tests/unit/blueprint-door-feature.test.ts`

The door feature's `resolve` derives default `width`/`height` from `src/render/scale-contract.ts` (`DOOR_WIDTH_TILES`, `DOOR_HEIGHT_UNITS`) instead of the hardcoded `0.30`/`1.5`/`0.42`/`2.0` in `assetgen/geometry/building.ts`. `main`/`grand` widen modestly but stay human-relative. This is the fix: every building's door reads at villager height by construction.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-door-feature.test.ts
import { describe, it, expect } from 'vitest';
import { doorFeatureType } from '@/blueprint/features/door';
import { DOOR_HEIGHT_UNITS, DOOR_WIDTH_TILES } from '@/render/scale-contract';

const ctx = { seed: 0, materials: {} };

describe('door feature — scale-contract sizing', () => {
  it('default door derives height from DOOR_HEIGHT_UNITS', () => {
    const { params } = doorFeatureType.resolve({ type: 'door', face: 'south' }, ctx);
    expect(params.height).toBeCloseTo(DOOR_HEIGHT_UNITS, 5);
  });
  it('default door half-width derives from DOOR_WIDTH_TILES', () => {
    const { params } = doorFeatureType.resolve({ type: 'door', face: 'south' }, ctx);
    expect(params.halfW).toBeCloseTo(DOOR_WIDTH_TILES / 2, 5);
  });
  it('main door is a touch wider/taller but stays human-relative (< 1.4× human headroom)', () => {
    const { params } = doorFeatureType.resolve({ type: 'door', face: 'south', params: { main: true } }, ctx);
    expect(params.height as number).toBeGreaterThan(DOOR_HEIGHT_UNITS);
    expect(params.height as number).toBeLessThan(DOOR_HEIGHT_UNITS * 1.4);
  });
  it('honours an explicit height override', () => {
    const { params } = doorFeatureType.resolve({ type: 'door', face: 'south', params: { height: 0.6 } }, ctx);
    expect(params.height).toBe(0.6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-door-feature.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/features/door.ts
// The door feature. Its size derives from the scale contract so it reads at villager
// height by construction — the fix for the long-standing "doors too big" issue.
import type { FeatureType } from '../registry';
import { DOOR_HEIGHT_UNITS, DOOR_WIDTH_TILES } from '@/render/scale-contract';

const MAIN_SCALE = 1.18;   // a main entrance: modestly grander, still human-relative

export const doorFeatureType: FeatureType = {
  type: 'door',
  paramSchema: {
    main: { kind: 'bool', default: false },
    // width/height: half-width along the wall (tiles) and height (height-units).
    // Defaulted from the scale contract in resolve() when left unset (-1 sentinel).
    width: { kind: 'number', min: -1, max: 2, default: -1 },
    height: { kind: 'number', min: -1, max: 4, default: -1 },
  },
  resolve: (f) => {
    const p = f.params ?? {};
    const main = p.main === true;
    const grand = main ? MAIN_SCALE : 1;
    const halfW = (p.width as number) >= 0 ? (p.width as number) : (DOOR_WIDTH_TILES / 2) * grand;
    const height = (p.height as number) >= 0 ? (p.height as number) : DOOR_HEIGHT_UNITS * grand;
    return { params: { main, halfW, height } };
  },
  toBrief: () => 'human-height door',
};
```

> The body/compiler reads `feature.params.halfW`/`.height`/`.main` to build the assetgen `DoorFeature` (`width: halfW`, `height`, `main`). The `-1` sentinel means "unset → derive from contract", letting an explicit `0` width still be expressible if ever needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-door-feature.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/features/door.ts tests/unit/blueprint-door-feature.test.ts
git commit -m "feat(blueprint): door feature sized from scale-contract (fixes oversized doors)"
```

---

### Task 9: `vent` + `window` features

**Files:**
- Create: `src/blueprint/features/vent.ts`, `src/blueprint/features/window.ts`
- Test: `tests/unit/blueprint-vent-window-features.test.ts`

`vent` ports the chimney/smokehole/pipe vent (maps to the assetgen `VentFeature`); `window` is a new cosmetic feature (brief phrase + anchor only — no collision change). Both `resolve` to filled params.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-vent-window-features.test.ts
import { describe, it, expect } from 'vitest';
import { ventFeatureType } from '@/blueprint/features/vent';
import { windowFeatureType } from '@/blueprint/features/window';

const ctx = { seed: 0, materials: {} };

describe('vent feature', () => {
  it('defaults kind to chimney and placement to ridge', () => {
    const { params } = ventFeatureType.resolve({ type: 'vent' }, ctx);
    expect(params.kind).toBe('chimney');
    expect(params.placement).toBe('ridge');
  });
  it('keeps an explicit smokehole', () => {
    const { params } = ventFeatureType.resolve({ type: 'vent', params: { kind: 'smokehole' } }, ctx);
    expect(params.kind).toBe('smokehole');
  });
});

describe('window feature', () => {
  it('resolves and yields a brief phrase', () => {
    const r = windowFeatureType.resolve({ type: 'window', face: 'south' }, ctx);
    expect(r.params).toBeDefined();
    expect(windowFeatureType.toBrief({ id: 'w', type: 'window', face: 'south', params: r.params }, { materials: {}, footprint: { w: 2, h: 2 } })).toMatch(/window/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-vent-window-features.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/features/vent.ts
import type { FeatureType } from '../registry';

export const ventFeatureType: FeatureType = {
  type: 'vent',
  paramSchema: {
    kind: { kind: 'enum', values: ['chimney', 'smokehole', 'pipe'], default: 'chimney' },
    placement: { kind: 'enum', values: ['ridge', 'wall'], default: 'ridge' },
    t: { kind: 'number', min: 0, max: 1, default: 0.5 },
  },
  resolve: (f) => ({ params: { ...{ kind: 'chimney', placement: 'ridge', t: 0.5 }, ...(f.params ?? {}) } }),
  toBrief: (f) => `${f.params.kind as string} vent`,
};
```

```ts
// src/blueprint/features/window.ts
import type { FeatureType } from '../registry';

export const windowFeatureType: FeatureType = {
  type: 'window',
  paramSchema: {
    style: { kind: 'enum', values: ['plain', 'shuttered', 'arched'], default: 'plain' },
  },
  resolve: (f) => ({ params: { style: (f.params?.style as string) ?? 'plain' } }),
  toBrief: (f) => `${f.params.style as string} window`,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-vent-window-features.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/features/vent.ts src/blueprint/features/window.ts tests/unit/blueprint-vent-window-features.test.ts
git commit -m "feat(blueprint): vent + window feature types"
```

---

### Task 10: Register all building part/feature types

**Files:**
- Create: `src/blueprint/register-buildings.ts`
- Test: `tests/unit/blueprint-register-buildings.test.ts`

A single import-for-side-effects module that registers every building part and feature. Idempotent-safe via a guard flag (registry throws on duplicates; the guard lets multiple imports be harmless).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-register-buildings.test.ts
import { describe, it, expect } from 'vitest';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { getPartType, getFeatureType } from '@/blueprint/registry';

describe('register-buildings', () => {
  it('registers all v1 building parts and features (idempotent)', () => {
    ensureBuildingTypesRegistered();
    ensureBuildingTypesRegistered();   // second call must not throw
    for (const t of ['body', 'wing', 'tower', 'porch', 'chimney', 'prim']) expect(getPartType(t).type).toBe(t);
    for (const t of ['door', 'vent', 'window']) expect(getFeatureType(t)?.type).toBe(t);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-register-buildings.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/register-buildings.ts
// Registers every v1 building part + feature. Import this once at app/test bootstrap.
import { registerPartType, registerFeatureType } from './registry';
import { bodyPartType } from './parts/body';
import { wingPartType } from './parts/wing';
import { towerPartType, porchPartType, chimneyPartType } from './parts/structural';
import { primPartType } from './parts/prim';
import { doorFeatureType } from './features/door';
import { ventFeatureType } from './features/vent';
import { windowFeatureType } from './features/window';

let done = false;
export function ensureBuildingTypesRegistered(): void {
  if (done) return;
  done = true;
  for (const pt of [bodyPartType, wingPartType, towerPartType, porchPartType, chimneyPartType, primPartType]) registerPartType(pt);
  for (const ft of [doorFeatureType, ventFeatureType, windowFeatureType]) registerFeatureType(ft);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-register-buildings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/register-buildings.ts tests/unit/blueprint-register-buildings.test.ts
git commit -m "feat(blueprint): building part/feature registration bootstrap"
```

---

## Phase 2 — Compilers

### Task 11: `toGeometry` compiler (building-prim aggregation)

**Files:**
- Create: `src/blueprint/compile/to-geometry.ts`
- Test: `tests/unit/blueprint-to-geometry.test.ts`

Folds resolved parts to a `StructureSpec`. Algorithm: for each part, call `toPrims`; collect all `prim:'building'` outputs and **merge** them into ONE building prim (concat `wings`; build `BuildingFeatures.doors`/`.vents` from the door/vent features attached to body/wing parts via the door's resolved `halfW`/`height`/`main` and the vent's `kind`/`placement`/`t`); append non-building prims as-is. `size` mirrors the old formula from the structure bounding box.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-to-geometry.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

const cottage: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
  materials: { walls: 'wattle', roof: 'thatch' },
  parts: {
    body: {
      type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' },
      features: { door: { type: 'door', face: 'south', params: { main: true } }, smoke: { type: 'vent', params: { kind: 'chimney' } } },
    },
  },
};

describe('toGeometry', () => {
  it('rect body → one building prim with the wing, door, and vent folded in', () => {
    const spec = toGeometry(resolveBlueprint([cottage], 0));
    expect(spec.parts).toHaveLength(1);
    const p = spec.parts[0];
    expect(p.prim).toBe('building');
    if (p.prim === 'building') {
      expect(p.wings).toEqual([{ x: 0, y: 0, w: 2, h: 2, storeys: 1, roof: 'gable' }]);
      expect(p.wallMat).toBe('plaster');   // wattle → plaster
      expect(p.roofMat).toBe('thatch');
      expect(p.features?.doors?.[0]).toMatchObject({ face: 'south', main: true });
      expect(p.features?.vents?.[0]).toMatchObject({ wing: 0, kind: 'chimney' });
    }
  });

  it('round body → cylinder + cap, no building prim', () => {
    const yurt: Blueprint = {
      version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 2, h: 2 },
      materials: { walls: 'hide', roof: 'hide' },
      parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'round', levels: 1, roof: 'domed' } } },
    };
    const spec = toGeometry(resolveBlueprint([yurt], 0));
    expect(spec.parts.map(p => p.prim)).toEqual(['cylinder', 'ellipsoid']);
  });

  it('body + wing → wings merged into one building prim', () => {
    const ell: Blueprint = {
      version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 4, h: 4 },
      materials: { walls: 'stone', roof: 'tile' },
      parts: {
        body: { type: 'body', size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' } },
        ell: { type: 'wing', at: { x: 0, y: 2 }, size: { w: 2, h: 2 }, params: { levels: 1, roof: 'gable' } },
      },
    };
    const spec = toGeometry(resolveBlueprint([ell], 0));
    expect(spec.parts).toHaveLength(1);
    if (spec.parts[0].prim === 'building') expect(spec.parts[0].wings).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-to-geometry.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/compile/to-geometry.ts
// Fold a ResolvedBlueprint to an assetgen StructureSpec. Wing-bearing parts (body/wing)
// merge into ONE prim:'building' (so manifold computes correct hip/valley unions);
// other parts (round/stepped bodies, tower/porch/chimney/prim) append as standalone prims.
import type { ResolvedBlueprint, ResolvedPart } from '../types';
import { getPartType, type CompileCtx } from '../registry';
import type { Part as Prim, StructureSpec } from '@/assetgen/compose';
import type { BuildingFeatures, DoorFeature, VentFeature, WallFace } from '@/assetgen/geometry/building';
import { ISO_TILE_W } from '@/render/iso/iso-constants';

/** A door feature on a part → an assetgen DoorFeature (sizes already resolved from contract). */
function doorOf(f: ResolvedPart['features'][number]): DoorFeature {
  return {
    face: (f.face ?? 'south') as WallFace,
    main: f.params.main === true,
    width: f.params.halfW as number,
    height: f.params.height as number,
  };
}
/** A vent feature on a wing-part → an assetgen VentFeature on wing `wingIdx`. */
function ventOf(f: ResolvedPart['features'][number], wingIdx: number): VentFeature {
  return {
    wing: wingIdx, t: f.params.t as number,
    kind: f.params.kind as VentFeature['kind'],
    placement: f.params.placement as VentFeature['placement'],
  };
}

export function toGeometry(rb: ResolvedBlueprint): StructureSpec {
  const ctx: CompileCtx = { materials: rb.materials, footprint: rb.footprint };

  // structure bounding box (for sprite size), from every part's footprint claim
  let maxX = 0, maxY = 0;
  for (const p of rb.parts) { maxX = Math.max(maxX, p.at.x + p.size.w); maxY = Math.max(maxY, p.at.y + p.size.h); }
  const size = Math.min(640, Math.max(128, Math.round((maxX + maxY) * ISO_TILE_W * 0.65)));

  let building: Extract<Prim, { prim: 'building' }> | null = null;
  const others: Prim[] = [];
  const doors: DoorFeature[] = [];
  const vents: VentFeature[] = [];

  for (const part of rb.parts) {
    const pt = getPartType(part.type);
    const prims = pt.toPrims(part, ctx);
    for (const prim of prims) {
      if (prim.prim === 'building') {
        if (!building) {
          building = { ...prim, wings: [...prim.wings], features: {}, seed: 0 };
        } else {
          building.wings.push(...prim.wings);
        }
        const wingIdx = building.wings.length - prim.wings.length;   // index of this part's first wing
        for (const f of part.features) {
          if (f.type === 'door') doors.push(doorOf(f));
          else if (f.type === 'vent') vents.push(ventOf(f, wingIdx));
        }
      } else {
        others.push(prim);
      }
    }
  }

  const parts: Prim[] = [];
  if (building) {
    const features: BuildingFeatures = {};
    if (doors.length) features.doors = doors;
    if (vents.length) features.vents = vents;
    building.features = features;
    parts.push(building);
  } else {
    // Round/stepped bodies carry no building prim; their door/vent are not rendered as
    // wall openings (the silhouette is a solid mass) — matches today's behaviour.
  }
  parts.push(...others);

  return { size, parts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-to-geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/compile/to-geometry.ts tests/unit/blueprint-to-geometry.test.ts
git commit -m "feat(blueprint): toGeometry compiler (building-prim aggregation)"
```

---

### Task 12: `toCollision` compiler

**Files:**
- Create: `src/blueprint/compile/to-collision.ts`
- Test: `tests/unit/blueprint-to-collision.test.ts`

Returns `{ footprint, blocked: string[], doorCells: string[] }`. `blocked` = union of every part's `toCollision` cells (as `"x,y"`). `doorCells` = the cell just **inside** each door (so a mortal can step onto it). Footprint cells not in `blocked` are walkable lawn. A blocked cell that is also a doorCell is passable.

The door cell derivation: for a door with `face`, find the body/wing cell on that face nearest the wall centre. To keep it simple and behaviour-matching, the door's host part records its wall-centre cell. The compiler computes: for each door feature on a part, the cell = the part's edge cell on `face` at the midpoint of that edge.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-to-collision.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toCollision } from '@/blueprint/compile/to-collision';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

const cottage: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
  materials: { walls: 'wattle', roof: 'thatch' },
  parts: {
    body: {
      type: 'body', at: { x: 0, y: 0 }, size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' },
      features: { door: { type: 'door', face: 'south', params: { main: true } } },
    },
  },
};

describe('toCollision', () => {
  it('blocks the 2x2 structure, leaves the rest of the 3x3 plot as lawn', () => {
    const c = toCollision(resolveBlueprint([cottage], 0));
    expect(c.footprint).toEqual({ w: 3, h: 3 });
    expect(new Set(c.blocked)).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
  });
  it('marks a door cell on the south edge of the body', () => {
    const c = toCollision(resolveBlueprint([cottage], 0));
    // south edge of a 2-tall body at y∈{0,1} → door cell at y=1
    expect(c.doorCells.some(k => k.endsWith(',1'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-to-collision.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/compile/to-collision.ts
// Precompute passability: blocked structure cells (union of part claims) + door cells
// (passable). Footprint cells not in `blocked` are walkable lawn.
import type { ResolvedBlueprint, ResolvedPart, ResolvedFeature, WallFace } from '../types';
import { getPartType, type CompileCtx } from '../registry';

const key = (x: number, y: number) => `${x},${y}`;

/** The structure-local cell a door on `face` occupies — midpoint of that edge of the part. */
function doorCellFor(part: ResolvedPart, face: WallFace): [number, number] {
  const { x, y } = part.at, { w, h } = part.size;
  const midX = x + Math.floor(w / 2), midY = y + Math.floor(h / 2);
  switch (face) {
    case 'south': return [midX, y + h - 1];
    case 'north': return [midX, y];
    case 'east':  return [x + w - 1, midY];
    case 'west':  return [x, midY];
  }
}

export function toCollision(rb: ResolvedBlueprint): { footprint: { w: number; h: number }; blocked: string[]; doorCells: string[] } {
  const ctx: CompileCtx = { materials: rb.materials, footprint: rb.footprint };
  const blocked = new Set<string>();
  const doorCells = new Set<string>();
  for (const part of rb.parts) {
    const pt = getPartType(part.type);
    for (const [x, y] of pt.toCollision(part, ctx)) blocked.add(key(x, y));
    for (const f of part.features as ResolvedFeature[]) {
      if (f.type !== 'door') continue;
      const [dx, dy] = doorCellFor(part, (f.face ?? 'south') as WallFace);
      doorCells.add(key(dx, dy));
    }
  }
  return { footprint: { ...rb.footprint }, blocked: [...blocked], doorCells: [...doorCells] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-to-collision.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/compile/to-collision.ts tests/unit/blueprint-to-collision.test.ts
git commit -m "feat(blueprint): toCollision compiler (blocked cells + door cells + lawn)"
```

---

### Task 13: `toAnchors` compiler

**Files:**
- Create: `src/blueprint/compile/to-anchors.ts`
- Test: `tests/unit/blueprint-to-anchors.test.ts`

Produces world-space `Anchor[]` for a placed blueprint (origin = footprint top-left in world tiles). For each door feature: a `door` anchor at the wall threshold with the outward facing, ported from the current `buildingAnchors`/`outwardFacing` logic but using the door cell from `toCollision`'s `doorCellFor`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-to-anchors.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toAnchors } from '@/blueprint/compile/to-anchors';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

const cottage: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
  materials: { walls: 'wattle', roof: 'thatch' },
  parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' }, features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
};

describe('toAnchors', () => {
  it('emits a south-facing main door anchor at world origin offset', () => {
    const anchors = toAnchors(resolveBlueprint([cottage], 0), 10, 20);
    const door = anchors.find(a => a.kind === 'door');
    expect(door).toBeDefined();
    expect(door!.main).toBe(true);
    expect(door!.facing).toEqual([0, 1]);     // south
    expect(door!.y).toBeGreaterThan(20);       // offset into the world
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-to-anchors.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/compile/to-anchors.ts
// World-space anchors for a placed blueprint. Ports buildingAnchors/outwardFacing,
// driven by each part's door features.
import type { ResolvedBlueprint, ResolvedPart, WallFace } from '../types';
import type { Anchor } from '@/world/anchors';

const FACING: Record<WallFace, [number, number]> = {
  south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0],
};

function doorCellFor(part: ResolvedPart, face: WallFace): [number, number] {
  const { x, y } = part.at, { w, h } = part.size;
  const midX = x + Math.floor(w / 2), midY = y + Math.floor(h / 2);
  switch (face) {
    case 'south': return [midX, y + h - 1];
    case 'north': return [midX, y];
    case 'east':  return [x + w - 1, midY];
    case 'west':  return [x, midY];
  }
}

export function toAnchors(rb: ResolvedBlueprint, originX: number, originY: number): Anchor[] {
  const out: Anchor[] = [];
  for (const part of rb.parts) {
    for (const f of part.features) {
      if (f.type !== 'door') continue;
      const face = (f.face ?? 'south') as WallFace;
      const [cx, cy] = doorCellFor(part, face);
      const fdir = FACING[face];
      const x = originX + cx + (fdir[0] > 0 ? 1 : fdir[0] < 0 ? 0 : 0.5);
      const y = originY + cy + (fdir[1] > 0 ? 1 : fdir[1] < 0 ? 0 : 0.5);
      out.push({ kind: 'door', x, y, facing: fdir, main: f.params.main === true });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-to-anchors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/compile/to-anchors.ts tests/unit/blueprint-to-anchors.test.ts
git commit -m "feat(blueprint): toAnchors compiler (door anchors)"
```

---

### Task 14: `toBrief` compiler

**Files:**
- Create: `src/blueprint/compile/to-brief.ts`
- Test: `tests/unit/blueprint-to-brief.test.ts`

Produces the assetgen `AssetBrief`, porting `buildingBrief` (`src/assetgen/producers/building-producer.ts`) but reading the blueprint: subject from `preset`/`category`, traits from each part/feature's `toBrief`, materials from `rb.materials`, door face from the body's door feature, height from the body params, the same `negatives`/`guidance`/`view` block. The `doorFace` helper and `DETAILS` flavour list port over verbatim.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-to-brief.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toBrief } from '@/blueprint/compile/to-brief';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

const cottage: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', preset: 'cottage', category: 'residential', era: 'medieval',
  footprint: { w: 3, h: 3 }, materials: { walls: 'wattle', roof: 'thatch' },
  parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' }, features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
};

describe('toBrief', () => {
  it('produces a building brief with subject, traits, materials, and door face', () => {
    const brief = toBrief(resolveBlueprint([cottage], 0), 7);
    expect(brief.kind).toBe('building');
    expect(brief.subject).toBe('cottage');
    expect(brief.traits).toContain('human-height door');
    expect(brief.traits.some(t => /single-storey/.test(t))).toBe(true);
    expect(brief.materials.find(m => m.part === 'walls')?.material).toBe('wattle');
    expect(brief.door.face).toBe('s');
    expect(brief.footprint).toEqual({ w: 2, h: 2 });   // structure bbox
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-to-brief.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/compile/to-brief.ts
// Port of buildingBrief onto the Blueprint. Subject/traits/materials/door come from
// the resolved parts+features; the guidance/negatives block is unchanged.
import type { ResolvedBlueprint, ResolvedPart, WallFace } from '../types';
import { getPartType, getFeatureType, type CompileCtx } from '../registry';
import {
  WALL_COLORS, ROOF_COLORS, GROUND_COLORS, NEUTRAL,
} from '@/world/building-descriptor';
import type { AssetBrief, BriefMaterial, DoorFace } from '@/assetgen/asset-brief';
import { STOREY } from '@/assetgen/geometry/building';

const DETAILS = ['weathered', 'moss-streaked', 'sun-bleached', 'newly-built', 'soot-stained', 'ivy-clad'];

/** Map a footprint-relative door cell to the face it presents (s>e>n>w on ties). Ported. */
function doorFaceLetter(face: WallFace): DoorFace {
  return ({ south: 's', east: 'e', north: 'n', west: 'w' } as Record<WallFace, DoorFace>)[face];
}

export function toBrief(rb: ResolvedBlueprint, instanceSeed: number): AssetBrief {
  const ctx: CompileCtx = { materials: rb.materials, footprint: rb.footprint };
  const body = rb.parts.find(p => p.type === 'body') ?? rb.parts[0];

  // structure bbox
  let maxX = 0, maxY = 0;
  for (const p of rb.parts) { maxX = Math.max(maxX, p.at.x + p.size.w); maxY = Math.max(maxY, p.at.y + p.size.h); }

  const wallsMat = rb.materials.walls ?? 'stone';
  const roofMat = rb.materials.roof;
  const groundMat = rb.materials.ground;
  const materials: BriefMaterial[] = [{ part: 'walls', material: wallsMat, color: WALL_COLORS[wallsMat as never] ?? NEUTRAL }];
  if (roofMat && roofMat !== 'none') materials.push({ part: 'roof', material: roofMat, color: ROOF_COLORS[roofMat as never] ?? NEUTRAL });
  if (groundMat) materials.push({ part: 'ground', material: groundMat, color: GROUND_COLORS[groundMat as never] ?? NEUTRAL });
  const paletteAnchors = [...new Set(materials.map(m => m.color))];

  // traits: each part + feature contributes a phrase
  const partTraits: string[] = [];
  for (const p of rb.parts) partTraits.push(getPartType(p.type).toBrief(p, ctx));
  for (const p of rb.parts) for (const f of p.features) { const ft = getFeatureType(f.type); if (ft) partTraits.push(ft.toBrief(f, ctx)); }
  const detail = DETAILS[((instanceSeed % DETAILS.length) + DETAILS.length) % DETAILS.length];
  const traits = [`${wallsMat}-walled`, ...partTraits.filter(Boolean), detail];

  const levels = Math.max(1, (body?.params.levels as number) ?? 1);
  const heightUnits = levels * STOREY;

  const doorFeat = body?.features.find(f => f.type === 'door');
  const face = doorFaceLetter((doorFeat?.face ?? 'south') as WallFace);
  // door cell (structure-local) for the brief's door coords
  const dc = doorFeat ? doorCellFor(body, (doorFeat.face ?? 'south') as WallFace) : [0, 0];

  const subject = (rb.preset ?? rb.category ?? 'building').replace(/_(small|large|tiny|big)$/, '').replace(/_/g, ' ');

  return {
    kind: 'building', subject, traits, materials, view: 'iso-3q', era: rb.era!,
    footprint: { w: maxX, h: maxY },
    heightUnits,
    door: { x: dc[0], y: dc[1], face },
    paletteAnchors,
    guidance: { source: 'none', strength: 0 },
    negatives: [
      'blurry', 'text', 'watermark',
      'ground', 'terrain', 'grass', 'dirt patch', 'base tile', 'floor slab',
      'foundation', 'plinth', 'pedestal', 'platform', 'shadow', 'background',
      'multiple doors', 'door on side wall', 'door on rear wall', 'doorway facing away',
      'flat front view', 'straight-on elevation', 'blank front wall',
    ],
    seed: instanceSeed,
  };
}

function doorCellFor(part: ResolvedPart, face: WallFace): [number, number] {
  const { x, y } = part.at, { w, h } = part.size;
  const midX = x + Math.floor(w / 2), midY = y + Math.floor(h / 2);
  switch (face) {
    case 'south': return [midX, y + h - 1];
    case 'north': return [midX, y];
    case 'east':  return [x + w - 1, midY];
    case 'west':  return [x, midY];
  }
}
```

> `rb.materials.ground` is the migrated home for the old `groundMaterial`; presets put it in `materials.ground`. The colour tables (`WALL_COLORS` etc.) are temporarily imported from `building-descriptor.ts`; Task 18 relocates them into `src/blueprint/materials.ts` and deletes the descriptor file. Until then this import keeps the build green.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-to-brief.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/compile/to-brief.ts tests/unit/blueprint-to-brief.test.ts
git commit -m "feat(blueprint): toBrief compiler (ports buildingBrief)"
```

---

## Phase 3 — Presets, entity, migration

### Task 15: Migrate the 11 presets + `synthesizeBlueprint`

**Files:**
- Create: `src/blueprint/presets/index.ts`
- Test: `tests/unit/blueprint-presets.test.ts`

Re-express the 11 presets (cottage, tavern, market_stall, temple_small, farm_barn, tower, castle_keep, dock, shrine, guard_post, yurt, longhouse) as `Blueprint`s. Each old descriptor maps mechanically: `footprint`→`footprint`; `structure`→ body `at`/`size` (default = full footprint); `plan`/`levels`/`levelInset`/`heightPerLevel`/`roof`→ body `params`; `walls`/`roofMat`/`groundMaterial`→`materials.{walls,roof,ground}`; `door`→ a `door` feature on the body with `face` derived from the door cell; `vents`→ `vent` features. `synthesizeBlueprint(name, patches?)` resolves `[preset, ...patches]` with a seed.

> The door `face` for each preset is derived from the old `door:{x,y}` against the footprint (s>e>n>w nearest edge) — precompute and hardcode the face in each preset (e.g. cottage door {1,1} in a 2×2 structure → south).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-presets.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { BUILDING_BLUEPRINTS, synthesizeBlueprint, getBlueprintPreset } from '@/blueprint/presets';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { toGeometry } from '@/blueprint/compile/to-geometry';

beforeAll(() => ensureBuildingTypesRegistered());

const NAMES = ['cottage','tavern','market_stall','temple_small','farm_barn','tower','castle_keep','dock','shrine','guard_post','yurt','longhouse'];

describe('blueprint presets', () => {
  it('defines all 11+ named presets', () => {
    for (const n of NAMES) expect(getBlueprintPreset(n)).toBeDefined();
  });
  it('every preset resolves + compiles to a non-empty StructureSpec', () => {
    for (const n of NAMES) {
      const rb = synthesizeBlueprint(n)!;
      const spec = toGeometry(rb);
      expect(spec.parts.length, n).toBeGreaterThan(0);
    }
  });
  it('cottage has a 2x2 body on a 3x3 plot and a south door', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const body = rb.parts.find(p => p.type === 'body')!;
    expect(body.size).toEqual({ w: 2, h: 2 });
    expect(rb.footprint).toEqual({ w: 3, h: 3 });
    expect(body.features.find(f => f.type === 'door')?.face).toBe('south');
  });
  it('synthesizeBlueprint applies an override patch (levels bump)', () => {
    const rb = synthesizeBlueprint('cottage', [{ parts: { body: { type: 'body', params: { levels: 2 } } } }])!;
    expect(rb.parts.find(p => p.type === 'body')!.params.levels).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-presets.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/presets/index.ts
// The 11 building presets, re-expressed as Blueprints. Mechanical port of the old
// BUILDING_PRESETS descriptors (src/world/building-presets.ts).
import { BLUEPRINT_VERSION, type Blueprint, type BlueprintPatch, type ResolvedBlueprint } from '../types';
import { resolveBlueprint } from '../resolve';
import { ensureBuildingTypesRegistered } from '../register-buildings';

const bp = (preset: string, b: Omit<Blueprint, 'version' | 'class' | 'preset'>): Blueprint =>
  ({ version: BLUEPRINT_VERSION, class: 'building', preset, ...b });

export const BUILDING_BLUEPRINTS: Record<string, Blueprint> = {
  cottage: bp('cottage', {
    category: 'residential', era: 'medieval', footprint: { w: 3, h: 3 },
    materials: { walls: 'wattle', roof: 'thatch', ground: 'packed_dirt' },
    parts: { body: {
      type: 'body', at: { x: 0, y: 0 }, size: { w: 2, h: 2 },
      params: { plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1, roof: 'gable' },
      features: { door: { type: 'door', face: 'south', params: { main: true } }, smoke: { type: 'vent', face: 'north', params: { kind: 'chimney' } } },
    } },
  }),
  tavern: bp('tavern', {
    category: 'commercial', era: 'medieval', footprint: { w: 3, h: 3 },
    materials: { walls: 'timber', roof: 'tile', ground: 'packed_dirt' },
    parts: { body: {
      type: 'body', size: { w: 3, h: 3 }, params: { plan: 'rect', levels: 2, roof: 'hip' },
      features: { door: { type: 'door', face: 'south', params: { main: true } }, smoke: { type: 'vent', params: { kind: 'chimney' } } },
    } },
  }),
  market_stall: bp('market_stall', {
    category: 'commercial', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'timber', roof: 'thatch' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'lean_to' }, features: { door: { type: 'door', face: 'west' } } } },
  }),
  temple_small: bp('temple_small', {
    category: 'religious', era: 'classical', footprint: { w: 3, h: 3 },
    materials: { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'cross', levels: 1, heightPerLevel: 1.5, roof: 'hip' }, features: { door: { type: 'door', face: 'south', params: { main: true } }, smoke: { type: 'vent', params: { kind: 'smokehole' } } } } },
  }),
  farm_barn: bp('farm_barn', {
    category: 'farm', era: 'medieval', footprint: { w: 3, h: 2 },
    materials: { walls: 'timber', roof: 'wood', ground: 'dirt' },
    parts: { body: { type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect', levels: 1, heightPerLevel: 1.2, roof: 'gable' }, features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
  }),
  tower: bp('tower', {
    category: 'military', era: 'medieval', footprint: { w: 2, h: 3 },
    materials: { walls: 'stone', roof: 'slate', ground: 'flagstone' },
    parts: { body: { type: 'body', size: { w: 2, h: 3 }, params: { plan: 'rect', levels: 3, heightPerLevel: 1, roof: 'flat' }, features: { door: { type: 'door', face: 'west' } } } },
  }),
  castle_keep: bp('castle_keep', {
    category: 'military', era: 'medieval', footprint: { w: 3, h: 3 },
    materials: { walls: 'stone', roof: 'slate', ground: 'gravel' },
    parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'stepped', levels: 4, levelInset: 1, heightPerLevel: 0.7, roof: 'stepped' }, features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
  }),
  dock: bp('dock', {
    category: 'special', era: 'medieval', footprint: { w: 2, h: 3 },
    materials: { walls: 'timber', roof: 'wood', ground: 'wood' },
    parts: { body: { type: 'body', size: { w: 2, h: 3 }, params: { plan: 'rect', levels: 1, heightPerLevel: 0.2, roof: 'flat' }, features: { door: { type: 'door', face: 'north' } } } },
  }),
  shrine: bp('shrine', {
    category: 'religious', era: 'classical', footprint: { w: 2, h: 2 },
    materials: { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' }, features: { door: { type: 'door', face: 'west' } } } },
  }),
  guard_post: bp('guard_post', {
    category: 'military', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'timber', roof: 'wood' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, heightPerLevel: 1.2, roof: 'hip' }, features: { door: { type: 'door', face: 'west' } } } },
  }),
  yurt: bp('yurt', {
    category: 'residential', era: 'primordial', footprint: { w: 2, h: 2 },
    materials: { walls: 'hide', roof: 'hide', ground: 'dirt' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'round', levels: 1, heightPerLevel: 0.9, roof: 'domed' }, features: { door: { type: 'door', face: 'west' }, smoke: { type: 'vent', params: { kind: 'smokehole' } } } } },
  }),
  longhouse: bp('longhouse', {
    category: 'residential', era: 'medieval', footprint: { w: 4, h: 2 },
    materials: { walls: 'log', roof: 'thatch', ground: 'packed_dirt' },
    parts: { body: { type: 'body', size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 1, heightPerLevel: 1.2, roof: 'gable' }, features: { door: { type: 'door', face: 'south', params: { main: true } }, smoke: { type: 'vent', params: { kind: 'smokehole' } } } } },
  }),
};

export function getBlueprintPreset(name: string): Blueprint | undefined { return BUILDING_BLUEPRINTS[name]; }

/** Resolve `name` (+ optional override patches) into a ResolvedBlueprint. Seed from name. */
export function synthesizeBlueprint(name: string, patches: BlueprintPatch[] = [], seed?: number): ResolvedBlueprint | undefined {
  ensureBuildingTypesRegistered();
  const base = BUILDING_BLUEPRINTS[name];
  if (!base) return undefined;
  const s = seed ?? [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return resolveBlueprint([base, ...patches], s);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-presets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/presets/index.ts tests/unit/blueprint-presets.test.ts
git commit -m "feat(blueprint): migrate 11 building presets + synthesizeBlueprint"
```

---

### Task 16: `blueprintEntity` + `blueprintOf`

**Files:**
- Create: `src/blueprint/entity.ts`
- Test: `tests/unit/blueprint-entity.test.ts`

Builds a building `Entity` from a `ResolvedBlueprint`, storing `properties.blueprint` (the resolved doc + precomputed `collision` from `toCollision` + `anchors` from `toAnchors`). Mirrors the old `buildingEntity` shape (`kind`, `tags`, `footprint`, `era`, `religiousSignificance`, `sortYOffset`) so downstream indexing is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blueprint-entity.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { blueprintEntity, blueprintOf } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';

beforeAll(() => ensureBuildingTypesRegistered());

describe('blueprintEntity', () => {
  it('builds a building entity carrying the resolved blueprint + collision + anchors', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const e = blueprintEntity('b1', rb, 5, 6);
    expect(e.kind).toBe('cottage');
    expect(e.tags).toContain('building');
    expect(e.properties.footprint).toEqual({ w: 3, h: 3 });
    const stored = blueprintOf(e)!;
    expect(stored.collision.blocked.length).toBeGreaterThan(0);
    expect(stored.anchors.some(a => a.kind === 'door')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-entity.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/blueprint/entity.ts
import type { Entity, ReligiousSignificance } from '@/core/types';
import type { ResolvedBlueprint } from './types';
import type { Anchor } from '@/world/anchors';
import { toCollision } from './compile/to-collision';
import { toAnchors } from './compile/to-anchors';

export interface StoredBlueprint {
  rb: ResolvedBlueprint;
  collision: { footprint: { w: number; h: number }; blocked: string[]; doorCells: string[] };
  anchors: Anchor[];
}

export function blueprintOf(e: Entity): StoredBlueprint | undefined {
  return (e.properties as { blueprint?: StoredBlueprint } | undefined)?.blueprint;
}

export function blueprintEntity(
  id: string, rb: ResolvedBlueprint, x: number, y: number,
  extra: { poiId?: string; religiousSignificance?: ReligiousSignificance; state?: string } = {},
): Entity {
  const collision = toCollision(rb);
  const anchors = toAnchors(rb, x, y);
  return {
    id,
    kind: rb.preset ?? 'building',
    x, y,
    tags: ['building', rb.category ?? 'residential'],
    properties: {
      category: 'building',
      blueprint: { rb, collision, anchors } satisfies StoredBlueprint,
      footprint: { ...rb.footprint },
      anchors,
      sortYOffset: rb.footprint.h,
      era: rb.era,
      poiId: extra.poiId,
      religiousSignificance: extra.religiousSignificance ?? (rb.category === 'religious' ? 'sacred' : 'neutral'),
      state: extra.state ?? 'intact',
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-entity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/entity.ts tests/unit/blueprint-entity.test.ts
git commit -m "feat(blueprint): blueprintEntity + blueprintOf (entity payload)"
```

---

### Task 17: Repoint consumers to read `blueprint` (build stays green; descriptor still exists)

**Files:**
- Modify: `src/world/building-collision.ts`, `src/render/iso/iso-renderer.ts`, `src/render/parametric-building-source.ts`, `src/world/building-placer.ts`, `src/sim/command/building-verbs.ts`, `src/render/ground-material.ts`, `src/render/selection-outline.ts`, `src/world/building-helpers.ts`
- Test: update `tests/unit/building-collision-*.test.ts`, `tests/unit/iso-renderer.test.ts`, `tests/unit/parametric-building-source.test.ts`, `tests/unit/place-building-verb.test.ts`, `tests/integration/default-world-generation.test.ts`

This is the switch from `properties.descriptor` to `properties.blueprint`. Do it as one task with sub-steps because the consumers interlock through the entity payload. Each sub-step: change a consumer + its test, run, keep green. The old `building-descriptor.ts` still exists (deleted in Task 18), so any not-yet-migrated path compiles.

- [ ] **Step 1: `building-collision.ts` reads `blueprint.collision`**

Replace the descriptor read in `isFootprintCellPassable` with the precomputed mask:

```ts
// src/world/building-collision.ts — isFootprintCellPassable body
import { blueprintOf } from '@/blueprint/entity';
// ...
export function isFootprintCellPassable(building: Entity, tileX: number, tileY: number): boolean {
  const stored = blueprintOf(building);
  const localX = tileX - Math.floor(building.x);
  const localY = tileY - Math.floor(building.y);
  if (!stored) return false;   // unknown building → solid
  const key = `${localX},${localY}`;
  if (stored.collision.doorCells.includes(key)) return true;     // door → passable
  return !stored.collision.blocked.includes(key);                // lawn → passable; structure → solid
}
```

Update `tests/unit/building-collision-door.test.ts` + `building-collision-lawn.test.ts` to build entities via `blueprintEntity(synthesizeBlueprint(...))` instead of `buildingEntity(synthesizeFromPreset(...))`. Run: `npx vitest run tests/unit/building-collision-door.test.ts tests/unit/building-collision-lawn.test.ts tests/unit/pathfinding-lawn.test.ts` → PASS.

- [ ] **Step 2: `iso-renderer.ts` reads the blueprint structure bbox**

Replace the `descriptor`/`structureRect` block (lines ~89-99) with a blueprint read:

```ts
import { blueprintOf } from '@/blueprint/entity';
// ...
const stored = blueprintOf(e);
if (stored) {
  if (hideBuildings) continue;
  // structure bbox from resolved parts
  let sw = 0, sh = 0, sx = 0, sy = 0;
  for (const p of stored.rb.parts) { sx = Math.min(sx, p.at.x); sy = Math.min(sy, p.at.y); sw = Math.max(sw, p.at.x + p.size.w); sh = Math.max(sh, p.at.y + p.size.h); }
  const s = { dx: sx, dy: sy, w: sw - sx, h: sh - sy };
  const tx = Math.floor(e.x) + s.dx, ty = Math.floor(e.y) + s.dy;
  const key = buildingSortKey({ tx, ty, footprintW: s.w, footprintH: s.h });
  buildingById.set(e.id, { e, s });
  entries.push({ id: e.id, kind: 'building', tx, ty, z: 0, sortTx: key.sortTx, sortTy: key.sortTy, kindPriority: KIND_PRIORITY.building });
  continue;
}
```

The `StructureRect` type import becomes a local inline shape `{ dx; dy; w; h }`; update the `buildingById` map value type accordingly. Update `tests/unit/iso-renderer.test.ts` to use `blueprintEntity`. Run those + the render tests → PASS.

- [ ] **Step 3: `parametric-building-source.ts` keys on the blueprint, uses `toGeometry`**

```ts
import { blueprintOf } from '@/blueprint/entity';
import { toGeometry } from '@/blueprint/compile/to-geometry';
// keyOf(e) = stable JSON of stored.rb; toSpec default = (e) => toGeometry(blueprintOf(e)!.rb)
```

Rework `descriptorOf`→`blueprintOf`, `keyOf` to hash `stored.rb`, and the default `toSpec` to `toGeometry`. Update `tests/unit/parametric-building-source.test.ts`. Run → PASS.

- [ ] **Step 4: `building-placer.ts` synthesizes + places blueprints**

Swap `synthesizeFromPreset`/`buildingEntity` for `synthesizeBlueprint`/`blueprintEntity`; `descriptor.footprint`→`rb.footprint`; `descriptor.door`→ derive door tile from `stored.anchors` (first door anchor) or `collision.doorCells[0]`. Update `default-world-generation.test.ts` if it asserts descriptor shape. Run → PASS.

- [ ] **Step 5: `building-verbs.ts` resolves a blueprint**

`resolveDescriptor`→`resolveBlueprint` from `{ preset, overrides }` (overrides become a `BlueprintPatch`) or a raw `{ blueprint }`. Place via `blueprintEntity`. Update `tests/unit/place-building-verb.test.ts`. Run → PASS.

- [ ] **Step 6: `ground-material.ts`, `selection-outline.ts`, `building-helpers.ts`**

- `ground-material.ts`: read `blueprintOf(b).rb.materials.ground` + footprint instead of `descriptor.groundMaterial`/`apron`. (Apron is dropped — it was already removed from the iso renderer per the code comment; keep ground tinting by `materials.ground`.)
- `selection-outline.ts`: `descriptorFootprint` → read `blueprintOf(e)?.rb.footprint`.
- `building-helpers.ts`: `descriptorOf` → `blueprintOf(e)?.rb`; the display info calls `toBrief(rb, hashStr(e.id))` instead of `buildingBrief(d, ...)`.

Update `tests/unit/building-helpers.test.ts`, `tests/unit/ground-material.test.ts`. Run the full suite: `npm test` → all green (old descriptor files still present but now unused by these paths).

- [ ] **Step 7: Commit**

```bash
git add src/world/building-collision.ts src/render/iso/iso-renderer.ts src/render/parametric-building-source.ts src/world/building-placer.ts src/sim/command/building-verbs.ts src/render/ground-material.ts src/render/selection-outline.ts src/world/building-helpers.ts tests/
git commit -m "refactor(blueprint): repoint building consumers to properties.blueprint"
```

---

### Task 18: Delete `BuildingDescriptor`/`descriptorToSpec`/old presets; relocate material tables; guard

**Files:**
- Create: `src/blueprint/materials.ts` (relocated colour tables)
- Delete: `src/world/building-descriptor.ts`, `src/render/iso/building-spec.ts`, `src/world/building-presets.ts`
- Modify: `src/blueprint/compile/to-brief.ts` (import from new `materials.ts`), `src/render/building-massing-model.ts` + `src/render/building-massing.ts` (port to blueprint or delete if unused), `src/assetgen/producers/building-producer.ts` (delete old `buildingBrief` or repoint), `src/assetgen/view-registry.ts`, `src/map/building-templates.ts` (already deprecated)
- Create: `tests/unit/no-building-descriptor.test.ts` (guard)
- Delete/replace: `tests/unit/building-descriptor.test.ts`, `tests/unit/building-spec.test.ts`, `tests/unit/building-structure-rect.test.ts`, `tests/unit/building-producer.test.ts`, `tests/unit/building-presets.test.ts`, `tests/unit/building-massing*.test.ts`, `tests/unit/building-vents.test.ts`, `tests/unit/building-anchors.test.ts`

- [ ] **Step 1: Relocate material colour tables**

Create `src/blueprint/materials.ts` with `WALL_COLORS`/`ROOF_COLORS`/`GROUND_COLORS`/`NEUTRAL` (moved verbatim from `building-descriptor.ts`). Repoint `to-brief.ts` and any other importer to `@/blueprint/materials`.

- [ ] **Step 2: Resolve the remaining descriptor consumers**

For each file still importing from `building-descriptor`/`building-spec`/`building-presets`:
- `building-massing-model.ts` + `building-massing.ts` (topdown silhouette): these feed the secondary topdown renderer. Port `buildingMassing` to take a `ResolvedBlueprint` (read `body` params) **or**, if the topdown renderer path is dead in the iso game, delete both files and their tests. Verify with `grep -rn "drawBuildingMassing\|buildingMassing\|building-massing" src/` — if only self-referential + tests, delete. Otherwise port the body-param reads.
- `building-producer.ts`: delete the old `buildingBrief` (superseded by `toBrief`); repoint `building-helpers.ts` (already done in Task 17) and `view-registry.ts` to `toBrief`. If `view-registry.ts` only referenced types, drop the import.
- `building-templates.ts`: already `@deprecated`; delete the `BuildingDescriptor` reference (it's in a comment/TODO) — no code change needed beyond removing the stale doc line.

- [ ] **Step 3: Delete the three core files**

```bash
git rm src/world/building-descriptor.ts src/render/iso/building-spec.ts src/world/building-presets.ts
```

- [ ] **Step 4: Write the guard test**

```ts
// tests/unit/no-building-descriptor.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('BuildingDescriptor is fully retired', () => {
  it('no src file imports building-descriptor / building-spec / building-presets or descriptorToSpec', () => {
    const offenders: string[] = [];
    for (const f of walk('src')) {
      const t = readFileSync(f, 'utf8');
      if (/building-descriptor|iso\/building-spec|world\/building-presets|descriptorToSpec|BuildingDescriptor/.test(t)) offenders.push(f);
    }
    expect(offenders, `still referencing the retired descriptor:\n${offenders.join('\n')}`).toEqual([]);
  });
});
```

- [ ] **Step 5: Delete/replace obsolete tests**

Remove the descriptor-era tests listed in Files. Any behaviour they guarded that still matters (vents, anchors, structure-rect) is now covered by the blueprint tests + the golden regression in Task 19.

- [ ] **Step 6: Run the full suite + build**

Run: `npm test` → all green. Run: `npm run build` → tsc clean, manifold.wasm emitted.
Expected: PASS; guard test green.

- [ ] **Step 7: Commit**

```bash
git add src/blueprint/materials.ts src/blueprint/compile/to-brief.ts tests/unit/no-building-descriptor.test.ts
git rm src/world/building-descriptor.ts src/render/iso/building-spec.ts src/world/building-presets.ts
git add -u src/ tests/
git commit -m "refactor(blueprint): delete BuildingDescriptor/descriptorToSpec/old presets; guard the cut"
```

> Note: this is the one task where `git add -u` is used to capture the deletions of obsolete tests and the small repoints across several files. It stages only already-tracked modifications/removals (not new untracked files) — consistent with the project's "explicit paths" rule for the surgical edits, and is the intended clean-cut commit.

---

## Phase 4 — Regression & verification

### Task 19: Golden regression + door-size proof + full verification

**Files:**
- Create: `tests/unit/blueprint-golden-regression.test.ts`
- Test: as below

Proves the unification preserves behaviour for the three plan families and that the door fix holds.

- [ ] **Step 1: Write the regression test**

```ts
// tests/unit/blueprint-golden-regression.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { DOOR_HEIGHT_UNITS } from '@/render/scale-contract';

beforeAll(() => ensureBuildingTypesRegistered());

describe('blueprint golden regression', () => {
  it('cottage (rect) → one building prim, 2x2 wing, thatch/plaster, main door south', () => {
    const spec = toGeometry(synthesizeBlueprint('cottage')!);
    const p = spec.parts[0];
    expect(p.prim).toBe('building');
    if (p.prim === 'building') {
      expect(p.wings).toEqual([{ x: 0, y: 0, w: 2, h: 2, storeys: 1, roof: 'gable' }]);
      expect(p.roofMat).toBe('thatch');
      expect(p.wallMat).toBe('plaster');
      expect(p.features?.doors?.[0]).toMatchObject({ face: 'south', main: true });
    }
  });

  it('yurt (round) → cylinder + dome', () => {
    const spec = toGeometry(synthesizeBlueprint('yurt')!);
    expect(spec.parts.map(p => p.prim)).toEqual(['cylinder', 'ellipsoid']);
  });

  it('castle_keep (stepped) → multiple stacked boxes', () => {
    const spec = toGeometry(synthesizeBlueprint('castle_keep')!);
    expect(spec.parts.every(p => p.prim === 'box')).toBe(true);
    expect(spec.parts.length).toBeGreaterThanOrEqual(2);
  });

  it('every preset main door is sized to the scale contract (height ≈ DOOR_HEIGHT_UNITS, ≤1.4×)', () => {
    for (const name of ['cottage', 'tavern', 'temple_small', 'longhouse']) {
      const spec = toGeometry(synthesizeBlueprint(name)!);
      const b = spec.parts.find(p => p.prim === 'building');
      const door = b && b.prim === 'building' ? b.features?.doors?.[0] : undefined;
      expect(door, name).toBeDefined();
      expect(door!.height!, name).toBeGreaterThanOrEqual(DOOR_HEIGHT_UNITS);
      expect(door!.height!, name).toBeLessThanOrEqual(DOOR_HEIGHT_UNITS * 1.4);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails, then passes**

Run: `npx vitest run tests/unit/blueprint-golden-regression.test.ts`
Expected: PASS (if any assertion fails, it pinpoints a behaviour drift to fix in the relevant compiler/part before continuing).

- [ ] **Step 3: Full verification**

Run: `npm test` → all green (full suite, including the guard).
Run: `npm run build` → tsc clean; build emits `manifold.wasm`.
Run: `npx vitest run tests/unit/no-random-in-sim.test.ts tests/unit/no-three-in-bundle.test.ts` → guards green.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/blueprint-golden-regression.test.ts
git commit -m "test(blueprint): golden regression (rect/round/stepped) + door-size proof"
```

- [ ] **Step 5: Manual eyeball (deferred, note for the user)**

`npm run dev` → New World → confirm cottages render with walkable yards and **doors at villager height** (the deferred fix). Auto mode still shows baked 3×3 cottage art until sprites are regenerated by kind; Force-fallback shows the parametric blueprint geometry. Record the result in memory ([[project-door-sizing-followup]] → resolved/▢).

---

## Self-review (completed by plan author)

**Spec coverage:**
- One unified authoring model → Tasks 1-4 (types/schema/registry/resolve). ✅
- Semantic parts → primitives, `prim` escape → Tasks 5-7, 6. ✅
- Partial-patch layering, id-keyed, null-delete, seeded resolve → Task 4. ✅
- Self-describing registry (`paramSchema`) → Tasks 2-3. ✅
- Four compilers (toGeometry/toCollision/toAnchors/toBrief) → Tasks 11-14. ✅
- Building parts (body/wing/roof/tower/porch/chimney/prim): body/wing/tower/porch/chimney/prim built; **`roof` folded into `body.params.roof`** (a `roof` part type is not separately needed — roofs are intrinsic to the manifold building prim and per-wing `roof`; noted as an intentional simplification within the granted latitude). ✅ (with note)
- Features (door/vent/window) → Tasks 8-9. ✅
- 11 presets migrated → Task 15. ✅
- Door-sizing fix in `doorFeature.resolve` from scale-contract → Task 8 + proof in Task 19. ✅
- Clean cut, delete descriptor/spec/old presets, guard → Task 18. ✅
- Golden regression (cottage/yurt/castle_keep), walkable-lawn carryover, door-size → Tasks 12, 17(step 1), 19. ✅
- `version` from day one → Task 1. ✅

**Deviation flagged for the user:** the spec's separate `roof` part type is folded into `body.params.roof` (roofs are intrinsic to the building prim; no preset needs a standalone roof part). If you want `roof` as a first-class registered part later, it's an additive registration — no model change.

**Placeholder scan:** none — every code step has full code.

**Type consistency:** `ResolvedBlueprint`/`ResolvedPart`/`ResolvedFeature` shapes are consistent across resolve → compilers → entity. `blueprintOf` returns `StoredBlueprint { rb, collision, anchors }` consistently in Tasks 16-19. `toGeometry`/`toCollision`/`toAnchors`/`toBrief` signatures stable from definition through use.

**Risk note:** Task 17 is the widest task (8 consumers). It is structured as independent green-keeping sub-steps; if any sub-step is too large for one subagent, split it per-consumer.
