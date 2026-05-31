# game.ts Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `src/game.ts` from a 1444-line god object to a ~250–300-line coordinator by extracting nine cohesive clusters into dependency-injected modules under `src/game/`, adding unit tests for the isolated logic.

**Architecture:** Controller objects owned by `Game`, matching the codebase's `mountX()`/`createX()` → `Handle` idiom. `Game` keeps `state`, `scheduler`, `timeline`, the RAF loop, and `destroy()`; each cluster becomes a focused module with narrow injected deps. Extraction is bottom-up so the test suite stays green at every commit. `FrameRenderer` and `InteractionController` receive individual UI-handle deps (not a `GameUi` reference), so extracting `GameUi` last does not ripple back into them.

**Tech Stack:** TypeScript ES modules, Vite, Vitest (global `environment: 'jsdom'`), Canvas 2D. Path alias `@/` → `src/`.

**Spec:** `docs/superpowers/specs/2026-05-30-game-ts-decomposition-design.md`

**Public API that MUST stay stable** (consumed by `main.ts`, `embed/api.ts`, `embed/mount.ts`): `new Game(container, options?)`, `game.generateWorld(worldSeed?, terrainOptions?)`, `game.destroy()`.

**Test commands:**
- Single file: `npx vitest run tests/unit/<name>.test.ts`
- Full suite: `npm test -- --run` (expect 746 baseline + new tests)
- Typecheck: `npx tsc --noEmit` (expect exit 0)

**Environment note (from handoff):** Claude's temp dir can corrupt tool output because pi.dev runs in this repo. Run `tsc`/`test` as background tasks and read the `.output`; if `Read` starts truncating, stop editing.

---

## Shared types used across tasks

These names are referenced by multiple tasks. Defined in Task 0.

```ts
// src/game/viewport.ts
export interface Viewport { width: number; height: number; } // CSS px (canvas.width / devicePixelRatio)
```

```ts
// src/game/interaction-state.ts
import type { OverlayHitAreas } from '@/render/sim-overlay';
export interface InteractionState {
  overlayHitAreas: OverlayHitAreas;
  poiOverlay: { poiId: string; tileX: number; tileY: number } | null;
  hoverTile: { x: number; y: number } | null;
  hoverScreen: { x: number; y: number } | null;
}
export function createInteractionState(): InteractionState {
  return { overlayHitAreas: [], poiOverlay: null, hoverTile: null, hoverScreen: null };
}
```

```ts
// src/game/render-context.ts (deps interface — full impl in Task 1)
export interface RenderContextDeps {
  state: GameState;
  viewport: Viewport;
  sheets: Map<string, HTMLCanvasElement>;
  assets: AssetManager;
  decorationImages: DecorationImageCache;
  devMode: DevModeState;
}
```

---

## Task 0: Scaffolding — Viewport + InteractionState

**Files:**
- Create: `src/game/viewport.ts`
- Create: `src/game/interaction-state.ts`
- Test: `tests/unit/interaction-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/interaction-state.test.ts
import { describe, it, expect } from 'vitest';
import { createInteractionState } from '@/game/interaction-state';

describe('createInteractionState', () => {
  it('starts empty', () => {
    const s = createInteractionState();
    expect(s.overlayHitAreas).toEqual([]);
    expect(s.poiOverlay).toBeNull();
    expect(s.hoverTile).toBeNull();
    expect(s.hoverScreen).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/unit/interaction-state.test.ts`
Expected: FAIL — cannot resolve `@/game/interaction-state`.

- [ ] **Step 3: Create the two files**

```ts
// src/game/viewport.ts
export interface Viewport {
  /** CSS pixels: canvas.width / devicePixelRatio */
  width: number;
  /** CSS pixels: canvas.height / devicePixelRatio */
  height: number;
}
```

```ts
// src/game/interaction-state.ts
import type { OverlayHitAreas } from '@/render/sim-overlay';

export interface InteractionState {
  overlayHitAreas: OverlayHitAreas;
  poiOverlay: { poiId: string; tileX: number; tileY: number } | null;
  hoverTile: { x: number; y: number } | null;
  hoverScreen: { x: number; y: number } | null;
}

export function createInteractionState(): InteractionState {
  return { overlayHitAreas: [], poiOverlay: null, hoverTile: null, hoverScreen: null };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/unit/interaction-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/viewport.ts src/game/interaction-state.ts tests/unit/interaction-state.test.ts
git commit -m "refactor(game): add Viewport + InteractionState scaffolding"
```

---

## Task 1: Extract `buildRenderContext` (dedup 3× → 1×)

**Files:**
- Create: `src/game/render-context.ts`
- Modify: `src/game.ts` (replace 3 inline `RenderContext` literals at ~806-825, ~586-605, ~1018-1037)
- Test: `tests/unit/render-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/render-context.test.ts
import { describe, it, expect } from 'vitest';
import { buildRenderContext } from '@/game/render-context';
import { createState } from '@/core/state';
import { AssetManager } from '@/render/asset-manager';
import { DecorationImageCache } from '@/render/decoration-image-cache';
import { createDevMode } from '@/dev/DevMode';

describe('buildRenderContext', () => {
  it('maps state fields and uses viewport for canvas size; empty npcs when no world', () => {
    const state = createState();
    state.map = { width: 4, height: 4, tiles: [] } as any;
    const rc = buildRenderContext({
      state,
      viewport: { width: 800, height: 600 },
      sheets: new Map(),
      assets: new AssetManager(),
      decorationImages: new DecorationImageCache(),
      devMode: createDevMode(),
    });
    expect(rc.canvasWidth).toBe(800);
    expect(rc.canvasHeight).toBe(600);
    expect(rc.npcs).toEqual([]); // no world yet
    expect(rc.map).toBe(state.map);
    expect(rc.camera).toBe(state.camera);
    expect(rc.showLabels).toBe(state.showLabels);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/unit/render-context.test.ts`
Expected: FAIL — cannot resolve `@/game/render-context`.

- [ ] **Step 3: Create `src/game/render-context.ts`**

```ts
// src/game/render-context.ts
import type { GameState, RenderContext, DevModeState } from '@/core/types';
import type { AssetManager } from '@/render/asset-manager';
import type { DecorationImageCache } from '@/render/decoration-image-cache';
import type { Viewport } from './viewport';
import { toRenderNpc } from '@/world/npc-helpers';

export interface RenderContextDeps {
  state: GameState;
  viewport: Viewport;
  sheets: Map<string, HTMLCanvasElement>;
  assets: AssetManager;
  decorationImages: DecorationImageCache;
  devMode: DevModeState;
}

/** Single source of truth for the per-frame RenderContext.
 *  `map`/`world` are asserted non-null — every caller guards before calling. */
export function buildRenderContext(deps: RenderContextDeps): RenderContext {
  const { state, viewport, sheets, assets, decorationImages, devMode } = deps;
  return {
    map: state.map!,
    camera: state.camera,
    canvasWidth: viewport.width,
    canvasHeight: viewport.height,
    npcs: state.world ? state.world.query({ kind: 'npc' }).map(toRenderNpc) : [],
    npcSheets: sheets,
    visualMap: state.visualMap,
    blobMap: state.blobMap ?? null,
    tileAtlas: assets.getTileAtlas(),
    terrainSheets: assets.getTerrainSheets(),
    buildingSprites: assets.getBuildingSprites(),
    treeSheets: assets.getTreeSheets(),
    world: state.world!,
    showLabels: state.showLabels,
    showPoiMarkers: state.showPoiMarkers,
    generatedDecorations: state.generatedDecorations,
    resolveDecorationImage: (id: string) => decorationImages.get(id),
    devMode,
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/unit/render-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Add a viewport helper + rewire the 3 call sites in `game.ts`**

Add import near top of `game.ts`:
```ts
import { buildRenderContext, type RenderContextDeps } from '@/game/render-context';
```

Add a private helper to the `Game` class (place near `resize()`):
```ts
private viewport(): { width: number; height: number } {
  return {
    width: this.canvas.width / devicePixelRatio,
    height: this.canvas.height / devicePixelRatio,
  };
}

private renderDeps(): RenderContextDeps {
  return {
    state: this.state,
    viewport: this.viewport(),
    sheets: this.sheets,
    assets: this.assets,
    decorationImages: this.decorationImages,
    devMode: this.devMode,
  };
}
```

Replace the inline `const rc: RenderContext = { ... }` literal in `render()` (~806-825) with:
```ts
const rc = buildRenderContext(this.renderDeps());
```
Replace the inline literal in `onRightClick()` (~586-605) with the same line.
Replace the inline literal in `updateTooltip()` (~1018-1037) with the same line.

Note: the former `render()` literal used `world: this.state.world!`; the other two were inside `if (!this.state.world) return` guards. `buildRenderContext` returns `world: state.world!` — all three call sites still guard `state.world` before reaching the call, so behavior is unchanged. The `RenderContext` type import in `game.ts` may now be unused; remove it from the import on line 7 if `tsc` flags it.

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: exit 0; 746 + 2 new tests pass.

- [ ] **Step 7: Manual smoke**

Run `npm run dev`, open the app, generate a world, confirm the map + NPCs render, and right-click + hover still work. (RenderContext now flows through one builder.)

- [ ] **Step 8: Commit**

```bash
git add src/game/render-context.ts tests/unit/render-context.test.ts src/game.ts
git commit -m "refactor(game): extract buildRenderContext, dedup 3 inline RenderContext literals"
```

---

## Task 2: Relocate `simStateFromEntity` and `advanceNpcFrames`

**Files:**
- Modify: `src/world/npc-helpers.ts` (add `simStateFromEntity`)
- Modify: `src/render/npc-animator.ts` (add `advanceNpcFrames`)
- Modify: `src/game.ts` (remove the bottom `simStateFromEntity` fn + `updateNpcFrames` method; import from new homes)
- Test: `tests/unit/advance-npc-frames.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/advance-npc-frames.test.ts
import { describe, it, expect } from 'vitest';
import { advanceNpcFrames } from '@/render/npc-animator';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';

describe('advanceNpcFrames', () => {
  it('advances frame after FRAME_MS and wraps 1..8', () => {
    const world = new World();
    const props = initNpcProps('Bria', 'farmer', 1);
    props.frame = 1; props.frameTimer = 0;
    world.addEntity({ id: 'n1', kind: 'npc', x: 0, y: 0, properties: props as any, tags: [] });
    advanceNpcFrames(world, 200); // > FRAME_MS (150)
    const after = world.query({ kind: 'npc' })[0].properties as any;
    expect(after.frame).toBe(2);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/unit/advance-npc-frames.test.ts`
Expected: FAIL — `advanceNpcFrames` is not exported.

- [ ] **Step 3: Add `advanceNpcFrames` to `src/render/npc-animator.ts`**

Append:
```ts
import type { World } from '@/world/world';
import type { NpcProperties } from '@/core/types';

/** Advance walk-cycle frames on the canonical entity properties (source of truth). */
export function advanceNpcFrames(world: World, deltaMs: number): void {
  for (const e of world.query({ kind: 'npc' })) {
    const p = e.properties as unknown as NpcProperties;
    p.frameTimer += deltaMs;
    if (p.frameTimer >= FRAME_MS) {
      p.frameTimer -= FRAME_MS;
      p.frame = (p.frame % 8) + 1;
    }
  }
}
```
(If importing `World`/`NpcProperties` would create a cycle, use `import type` only — both are type-only here, so no runtime cycle.)

- [ ] **Step 4: Add `simStateFromEntity` to `src/world/npc-helpers.ts`**

Append (body copied verbatim from `game.ts:1432-1443`):
```ts
import type { NpcSimState } from '@/core/types';

/** Adapter: build the render-only NpcSimState view from an entity. */
export function simStateFromEntity(e: Entity): NpcSimState {
  const p = e.properties as unknown as NpcProperties;
  return {
    npcId: e.id, name: p.name, role: p.role, personality: p.personality,
    beliefs: p.beliefs, needs: p.needs, mood: p.mood,
    recentEvents: [],
    relationships: p.relationships,
    whisperCooldown: p.whisperCooldown,
    homeBuildingId: p.homeBuildingId, homePoiId: p.homePoiId,
    activity: p.activity,
  };
}
```
(`Entity`, `NpcProperties` are already imported in `npc-helpers.ts`; add `NpcSimState` to its type imports if absent.)

- [ ] **Step 5: Rewire `game.ts`**

- Delete the `private updateNpcFrames(deltaMs)` method (~751-761).
- Delete the standalone `function simStateFromEntity(...)` at the bottom (~1432-1443).
- Add to imports: `advanceNpcFrames` from `@/render/npc-animator`, and `simStateFromEntity` from `@/world/npc-helpers`.
- In `startLoop()`'s loop body, replace `this.updateNpcFrames(deltaMs)` with `advanceNpcFrames(this.state.world, deltaMs)`.

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: exit 0; suite + 1 new test pass.

- [ ] **Step 7: Commit**

```bash
git add src/world/npc-helpers.ts src/render/npc-animator.ts src/game.ts tests/unit/advance-npc-frames.test.ts
git commit -m "refactor(game): relocate simStateFromEntity + advanceNpcFrames to helpers"
```

---

## Task 3: Extract `camera-follow` and `llm-backfill`

**Files:**
- Create: `src/game/camera-follow.ts`
- Create: `src/game/llm-backfill.ts`
- Modify: `src/game.ts`
- Test: `tests/unit/camera-follow.test.ts`, `tests/unit/llm-backfill.test.ts`

### 3a — camera-follow

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/camera-follow.test.ts
import { describe, it, expect } from 'vitest';
import { applyFollowCamera } from '@/game/camera-follow';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { TILE_SIZE } from '@/core/constants';

describe('applyFollowCamera', () => {
  it('no-ops when followNpc is false', () => {
    const state = createState();
    state.followNpc = false;
    const before = { ...state.camera };
    applyFollowCamera(state, { width: 800, height: 600 });
    expect(state.camera.x).toBe(before.x);
  });

  it('lerps camera 15% toward the selected npc', () => {
    const state = createState();
    const world = new World();
    world.addEntity({ id: 'n1', kind: 'npc', x: 10, y: 10, properties: initNpcProps('A', 'farmer', 1) as any, tags: [] });
    state.world = world;
    state.selectedNpcId = 'n1';
    state.followNpc = true;
    state.camera.x = 0; state.camera.y = 0; state.camera.zoom = 1;
    const viewW = 800, viewH = 600;
    const targetX = (10 + 0.5) * TILE_SIZE - viewW / 2;
    applyFollowCamera(state, { width: viewW, height: viewH });
    expect(state.camera.x).toBeCloseTo(targetX * 0.15, 5);
  });

  it('clears followNpc when the selected npc is gone', () => {
    const state = createState();
    state.world = new World();
    state.selectedNpcId = 'missing';
    state.followNpc = true;
    applyFollowCamera(state, { width: 800, height: 600 });
    expect(state.followNpc).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/unit/camera-follow.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/game/camera-follow.ts`**

```ts
// src/game/camera-follow.ts
import type { GameState } from '@/core/types';
import type { Viewport } from './viewport';
import { getNpc } from '@/world/npc-helpers';
import { TILE_SIZE } from '@/core/constants';

/** Smoothly track the followed NPC. Mutates state.camera; clears followNpc if the npc vanished. */
export function applyFollowCamera(state: GameState, viewport: Viewport): void {
  if (!state.followNpc || !state.selectedNpcId || !state.world) return;
  const e = getNpc(state.world, state.selectedNpcId);
  if (!e) { state.followNpc = false; return; }
  const cam = state.camera;
  const viewW = viewport.width / cam.zoom;
  const viewH = viewport.height / cam.zoom;
  const targetX = (e.x + 0.5) * TILE_SIZE - viewW / 2;
  const targetY = (e.y + 0.5) * TILE_SIZE - viewH / 2;
  cam.x += (targetX - cam.x) * 0.15;
  cam.y += (targetY - cam.y) * 0.15;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/unit/camera-follow.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `game.ts`**

- Delete the `private applyFollowCamera()` method (~997-1008).
- Import `applyFollowCamera` from `@/game/camera-follow`.
- In `startLoop()`'s loop, replace `this.applyFollowCamera()` with `applyFollowCamera(this.state, this.viewport())`.

### 3b — llm-backfill

- [ ] **Step 6: Write the failing test**

```ts
// tests/unit/llm-backfill.test.ts
import { describe, it, expect } from 'vitest';
import { parseLLMJson, getNearbyNpcNames, getActiveEventsForPoi } from '@/game/llm-backfill';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';

describe('parseLLMJson', () => {
  it('parses JSON content', () => {
    expect(parseLLMJson('{"narration":"hi"}')).toEqual({ narration: 'hi' });
  });
  it('falls back to narration for non-JSON', () => {
    expect(parseLLMJson('just text')).toEqual({ narration: 'just text' });
  });
});

describe('getNearbyNpcNames', () => {
  it('returns names of other npcs within radius, excluding self', () => {
    const world = new World();
    const a = { id: 'a', kind: 'npc', x: 5, y: 5, properties: initNpcProps('Ana', 'farmer', 1) as any, tags: [] };
    const b = { id: 'b', kind: 'npc', x: 6, y: 5, properties: initNpcProps('Bo', 'farmer', 2) as any, tags: [] };
    world.addEntity(a); world.addEntity(b);
    expect(getNearbyNpcNames(world, a as any, 3)).toEqual(['Bo']);
  });
});

describe('getActiveEventsForPoi', () => {
  it('returns [] for undefined poi', () => {
    expect(getActiveEventsForPoi(new World(), undefined)).toEqual([]);
  });
  it('maps active events to their types', () => {
    const world = new World();
    world.activeEvents.set('poi1', [{ type: 'drought', poiId: 'poi1', severity: 1, durationTicks: 10, ticksElapsed: 0 }] as any);
    expect(getActiveEventsForPoi(world, 'poi1')).toEqual(['drought']);
  });
});
```

- [ ] **Step 7: Run test, verify it fails**

Run: `npx vitest run tests/unit/llm-backfill.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 8: Create `src/game/llm-backfill.ts`**

Move the three helpers + `triggerLlmBackfill` body from `game.ts:1286-1361`. The provider is now injected via an `LLMClient` (default `MockLLMProvider(100)`), turning the hardcoded mock into a seam.

```ts
// src/game/llm-backfill.ts
import type { Entity, GameState, SettlementEventType } from '@/core/types';
import type { World } from '@/world/world';
import { npcProps, getRecentEventDescriptions } from '@/world/npc-helpers';
import { buildNpcPrompt, type NpcPromptContext } from '@/llm/npc-prompt-builder';
import { applyLLMWriteback, type LLMResponse } from '@/llm/state-writeback';
import { LLMClient, MockLLMProvider } from '@/llm/llm-client';
import type { LlmDisplayHandle } from '@/ui/llm-display';

export function parseLLMJson(content: string): LLMResponse {
  try { return JSON.parse(content); } catch { return { narration: content }; }
}

export function getNearbyNpcNames(world: World, npc: Entity, radius: number): string[] {
  const nearby = world.query({
    region: { x: Math.floor(npc.x) - radius, y: Math.floor(npc.y) - radius, w: radius * 2 + 1, h: radius * 2 + 1 },
    kind: 'npc',
  });
  return nearby.filter(e => e.id !== npc.id).map(e => npcProps(e).name);
}

export function getActiveEventsForPoi(world: World, poiId?: string): SettlementEventType[] {
  if (!poiId) return [];
  const events = world.activeEvents.get(poiId);
  return events?.map(e => e.type) ?? [];
}

export interface LlmBackfillDeps {
  state: GameState;
  llmDisplay: LlmDisplayHandle;
  /** Configured client; defaults to the mock so the seam is explicit. */
  client?: LLMClient;
  /** Called after writeback so the caller can refresh the info panel. */
  onWriteback?: () => void;
}

export class LlmBackfillService {
  private client: LLMClient;
  constructor(private deps: LlmBackfillDeps) {
    this.client = deps.client ?? new LLMClient(new MockLLMProvider(100));
  }

  async trigger(npcEntity: Entity): Promise<void> {
    const { state, llmDisplay } = this.deps;
    if (!state.world) return;
    const props = npcProps(npcEntity);
    const player = state.spirits.get('player');
    if (!player) return;

    const context: NpcPromptContext = {
      npc: npcEntity,
      world: state.world,
      recentEvents: getRecentEventDescriptions(props),
      previousInteractions: [],
      nearbyNpcNames: getNearbyNpcNames(state.world, npcEntity, 3),
      activeEvents: getActiveEventsForPoi(state.world, props.homePoiId),
      playerSpiritId: 'player',
    };

    const prompt = buildNpcPrompt(context);
    try {
      const response = await this.client.generateNpcBackfill(prompt.system, prompt.user, {
        maxTokens: 200, temperature: 0.7,
      });
      const writeback = applyLLMWriteback(npcEntity, parseLLMJson(response.content), 'player', state.eventLog);
      if (writeback.narration && writeback.dialogue) llmDisplay.showBoth(props.name, writeback.dialogue, writeback.narration);
      else if (writeback.dialogue) llmDisplay.showDialogue(props.name, writeback.dialogue);
      else if (writeback.narration) llmDisplay.showNarration(writeback.narration);
      this.deps.onWriteback?.();
    } catch (err) {
      console.error('[LLM] Backfill failed:', err);
    }
  }
}
```

- [ ] **Step 9: Run test, verify it passes**

Run: `npx vitest run tests/unit/llm-backfill.test.ts`
Expected: PASS.

- [ ] **Step 10: Rewire `game.ts`**

- Delete `triggerLlmBackfill`, `parseLLMJson`, `getNearbyNpcNames`, `getActiveEventsForPoi` methods (~1285-1361) and the commented-out `showNarrationPopup` block (~1362-1376).
- Add field + construct in the constructor (after `llmClient` is built):
  ```ts
  private llmBackfill!: LlmBackfillService;
  // ...in constructor, after this.llmDisplay is created:
  this.llmBackfill = new LlmBackfillService({
    state: this.state,
    llmDisplay: this.llmDisplay,
    client: this.llmClient,           // configured provider, not the hardcoded mock
    onWriteback: () => { this.lastInfoRefresh = 0; },
  });
  ```
- In `render()`'s info-panel `onLlmBackfill` callback, replace `await this.triggerLlmBackfill(entity)` with `await this.llmBackfill.trigger(entity)`.
- Add import: `import { LlmBackfillService } from '@/game/llm-backfill';`. Remove now-unused imports (`buildNpcPrompt`, `NpcPromptContext`, `applyLLMWriteback`, `LLMResponse`, `MockLLMProvider`, `getRecentEventDescriptions`, `SettlementEventType`) from `game.ts` if `tsc` flags them.

- [ ] **Step 11: Typecheck + full suite + smoke**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: exit 0; suite + new tests pass.
Smoke: in the app, select an NPC and click the LLM-backfill button — narration still appears.

- [ ] **Step 12: Commit**

```bash
git add src/game/camera-follow.ts src/game/llm-backfill.ts src/game.ts tests/unit/camera-follow.test.ts tests/unit/llm-backfill.test.ts
git commit -m "refactor(game): extract camera-follow + LlmBackfillService (provider now injectable)"
```

---

## Task 4: Extract `DivineActionsController` (unify dispatcher + info-panel call sites)

**Files:**
- Create: `src/game/divine-actions-controller.ts`
- Modify: `src/game.ts`
- Test: `tests/unit/divine-actions-controller.test.ts`

**Behavior unification (intentional):** the dispatcher `whisper` handler previously set the gold-flash timer but did *not* trigger a `DivineEffects` particle; the info-panel `onWhisper` did the reverse-plus. After unification, **both** paths set the flash timer and trigger the effect. This is the intended single behavior; note it in the commit.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/divine-actions-controller.test.ts
import { describe, it, expect } from 'vitest';
import { DivineActionsController } from '@/game/divine-actions-controller';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { DivineEffects } from '@/render/divine-effects';

function setup() {
  const state = createState();
  const world = new World();
  world.addEntity({ id: 'n1', kind: 'npc', x: 2, y: 3, properties: initNpcProps('Ana', 'farmer', 1) as any, tags: [] });
  state.world = world;
  const player = state.spirits.get('player')!;
  player.power = 100; // ensure affordable
  return { state, world };
}

describe('DivineActionsController', () => {
  it('whisper succeeds, sets lastCastTime via injected clock, triggers effect', () => {
    const { state, world } = setup();
    let triggers = 0;
    const fx = { trigger: () => { triggers++; } } as unknown as DivineEffects;
    const ctrl = new DivineActionsController({ state, divineEffects: fx, now: () => 12345 });
    const npc = world.query({ kind: 'npc' })[0];
    expect(ctrl.whisper(npc)).toBe(true);
    expect(ctrl.lastCastTime).toBe(12345);
    expect(triggers).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/unit/divine-actions-controller.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/game/divine-actions-controller.ts`**

```ts
// src/game/divine-actions-controller.ts
import type { Entity, GameState } from '@/core/types';
import type { Spirit } from '@/core/spirit';
import type { DivineEffects } from '@/render/divine-effects';
import type { OverlayDispatcher } from '@/ui/overlay-dispatcher';
import { whisper, omen, dream, miracle, answerPrayer } from '@/sim/divine-actions';
import { getNpc, npcProps } from '@/world/npc-helpers';

export interface DivineActionsDeps {
  state: GameState;
  divineEffects: DivineEffects;
  /** Clock for the gold-flash timer; defaults to performance.now. */
  now?: () => number;
}

/** Single owner of divine-action invocation: dispatcher handlers AND info-panel buttons. */
export class DivineActionsController {
  lastCastTime = -Infinity;
  private now: () => number;
  constructor(private deps: DivineActionsDeps) {
    this.now = deps.now ?? (() => performance.now());
  }

  private player(): Spirit { return this.deps.state.spirits.get('player')!; }
  private log() { return this.deps.state.eventLog; }
  private flash() { this.lastCastTime = this.now(); }

  whisper(npc: Entity): boolean {
    if (whisper(this.player(), npc, this.log())) {
      this.flash();
      this.deps.divineEffects.trigger('whisper', npc.x, npc.y);
      return true;
    }
    return false;
  }
  dream(npc: Entity): void {
    if (dream(this.player(), npc, this.log())) this.deps.divineEffects.trigger('dream', npc.x, npc.y);
  }
  answerPrayer(npc: Entity): void { answerPrayer(this.player(), npc, this.log()); }

  omenAt(poiId: string): boolean {
    const world = this.deps.state.world; if (!world) return false;
    return omen(this.player(), poiId, world, this.log());
  }
  miracleAt(poiId: string): boolean {
    const world = this.deps.state.world; if (!world) return false;
    return miracle(this.player(), poiId, world, this.log());
  }

  /** Info-panel variants: resolve the NPC's home POI, cast, and play the effect at the POI. */
  omenForNpc(npc: Entity): void {
    const poiId = npcProps(npc).homePoiId;
    if (poiId && this.omenAt(poiId)) this.triggerAtPoi('omen', poiId);
  }
  miracleForNpc(npc: Entity): void {
    const poiId = npcProps(npc).homePoiId;
    if (poiId && this.miracleAt(poiId)) this.triggerAtPoi('miracle', poiId);
  }
  private triggerAtPoi(kind: 'omen' | 'miracle', poiId: string): void {
    const poi = this.deps.state.worldSeed?.pois.find(p => p.id === poiId);
    if (poi?.position) this.deps.divineEffects.trigger(kind, poi.position.x, poi.position.y);
  }

  /** Register the five overlay-dispatch handlers. */
  register(dispatcher: OverlayDispatcher): void {
    const world = () => this.deps.state.world;
    dispatcher.register('whisper', (p) => { const w = world(); if (!w) return false; const e = getNpc(w, (p as any).npcId); return !!e && this.whisper(e); });
    dispatcher.register('omen', (p) => this.omenAt((p as any).poiId));
    dispatcher.register('dream', (p) => { const w = world(); if (!w) return false; const e = getNpc(w, (p as any).npcId); if (e) { this.dream(e); return true; } return false; });
    dispatcher.register('miracle', (p) => this.miracleAt((p as any).poiId));
    dispatcher.register('answer_prayer', (p) => { const w = world(); if (!w) return false; const e = getNpc(w, (p as any).npcId); if (e) { this.answerPrayer(e); return true; } return false; });
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/unit/divine-actions-controller.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `game.ts`**

- Add field `private divine!: DivineActionsController;`.
- In the constructor, **replace the five `this.dispatcher.register(...)` blocks (lines ~140-186)** with:
  ```ts
  this.divine = new DivineActionsController({ state: this.state, divineEffects: this.divineEffects });
  this.divine.register(this.dispatcher);
  ```
  **Ordering:** `this.divineEffects` is currently constructed at ~366. Move the `divineEffects` construction (`this.divineEffects = new DivineEffects();`) to *before* this block, or construct `this.divine` after `this.divineEffects` exists. Simplest: construct `this.divineEffects = new DivineEffects();` near the top of the constructor (right after `this.state = createState();`), then the `this.divine` block, then remove the later duplicate `this.divineEffects = new DivineEffects();` at ~366.
- In `render()`'s NPC info-panel callbacks, replace bodies:
  - `onWhisper` → `() => { this.divine.whisper(entity); }`
  - `onDream` → `() => { this.divine.dream(entity); }`
  - `onAnswerPrayer` → `() => { this.divine.answerPrayer(entity); }`
  - `onOmen` → `() => { this.divine.omenForNpc(entity); }`
  - `onMiracle` → `() => { this.divine.miracleForNpc(entity); }`
- Replace the gold-flash read in `render()` (`const flashAge = performance.now() - this.lastWhisperTime;`) with `... - this.divine.lastCastTime;`.
- Delete the `private lastWhisperTime` field (~91) and all remaining references.
- Add import: `import { DivineActionsController } from '@/game/divine-actions-controller';`. Remove the now-unused `whisper, omen, dream, miracle, answerPrayer` import from `game.ts` if `tsc` flags it.

- [ ] **Step 6: Typecheck + full suite + smoke**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: exit 0; suite + new test pass.
Smoke: cast whisper via the overlay click AND via the info-panel button — both flash gold and spawn a particle.

- [ ] **Step 7: Commit**

```bash
git add src/game/divine-actions-controller.ts src/game.ts tests/unit/divine-actions-controller.test.ts
git commit -m "refactor(game): extract DivineActionsController, unify dispatcher + info-panel cast paths"
```

---

## Task 5: Extract `DevModeController` (+ pure undo/redo reducer)

**Files:**
- Create: `src/game/dev-mode-history.ts` (pure reducer)
- Create: `src/game/dev-mode-controller.ts`
- Modify: `src/game.ts`
- Test: `tests/unit/dev-mode-history.test.ts`, `tests/unit/dev-mode-controller.test.ts`

### 5a — pure history reducer

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/dev-mode-history.test.ts
import { describe, it, expect } from 'vitest';
import { applyUndo, applyRedo } from '@/game/dev-mode-history';
import { World } from '@/world/world';
import type { UndoAction } from '@/core/types';

describe('dev-mode history reducer', () => {
  it('undo of entity_create removes the entity; redo re-adds it', () => {
    const world = new World();
    const entity = { id: 'e1', kind: 'rock', x: 1, y: 1, properties: {}, tags: [] };
    world.addEntity(entity as any);
    const action: UndoAction = { type: 'entity_create', target: { tileX: 1, tileY: 1, entityId: 'e1' }, before: null, after: JSON.parse(JSON.stringify(entity)) };
    applyUndo(action, world, null);
    expect(world.query({}).find(e => e.id === 'e1')).toBeUndefined();
    applyRedo(action, world, null);
    expect(world.query({}).find(e => e.id === 'e1')).toBeDefined();
  });

  it('undo of entity_delete re-adds; undo of entity_update restores before-snapshot', () => {
    const world = new World();
    const entity = { id: 'e2', kind: 'tree', x: 0, y: 0, properties: { hp: 5 }, tags: [] };
    world.addEntity(entity as any);
    const before = JSON.parse(JSON.stringify(entity));
    world.updateEntity('e2', { properties: { hp: 9 } });
    const upd: UndoAction = { type: 'entity_update', target: { tileX: 0, tileY: 0, entityId: 'e2' }, before, after: { ...entity, properties: { hp: 9 } } };
    applyUndo(upd, world, null);
    expect((world.query({}).find(e => e.id === 'e2')!.properties as any).hp).toBe(5);
  });

  it('tile_update restores tile fields', () => {
    const map = { width: 2, height: 2, tiles: [[{ type: 'grass', walkable: true }, { type: 'grass', walkable: true }], [{ type: 'grass', walkable: true }, { type: 'grass', walkable: true }]] } as any;
    const action: UndoAction = { type: 'tile_update', target: { tileX: 0, tileY: 0 }, before: { type: 'grass' }, after: { type: 'water' } };
    applyRedo(action, null, map);
    expect(map.tiles[0][0].type).toBe('water');
    applyUndo(action, null, map);
    expect(map.tiles[0][0].type).toBe('grass');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/unit/dev-mode-history.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/game/dev-mode-history.ts`**

Consolidates the `undo()`/`redo()` switch bodies + `restoreEntitySnapshot`/`restoreTileSnapshot` from `game.ts:1213-1276`.

```ts
// src/game/dev-mode-history.ts
import type { Entity, GameMap, Tile, UndoAction } from '@/core/types';
import type { World } from '@/world/world';

function restoreEntity(world: World | null, id: string, snap: Entity): void {
  world?.updateEntity(id, { kind: snap.kind, x: snap.x, y: snap.y, properties: snap.properties, tags: snap.tags });
}
function restoreTile(map: GameMap | null, tx: number, ty: number, snap: Partial<Tile>): void {
  const tile = map?.tiles[ty]?.[tx];
  if (tile) Object.assign(tile, snap);
}

export function applyUndo(action: UndoAction, world: World | null, map: GameMap | null): void {
  if (action.type === 'entity_create' && action.after) world?.removeEntity(action.target.entityId!);
  else if (action.type === 'entity_delete' && action.before) world?.addEntity(action.before as Entity);
  else if (action.type === 'entity_update' && action.before) restoreEntity(world, action.target.entityId!, action.before as Entity);
  else if (action.type === 'tile_update' && action.before) restoreTile(map, action.target.tileX, action.target.tileY, action.before as Partial<Tile>);
}

export function applyRedo(action: UndoAction, world: World | null, map: GameMap | null): void {
  if (action.type === 'entity_create' && action.after) world?.addEntity(action.after as Entity);
  else if (action.type === 'entity_delete' && action.before) world?.removeEntity(action.target.entityId!);
  else if (action.type === 'entity_update' && action.after) restoreEntity(world, action.target.entityId!, action.after as Entity);
  else if (action.type === 'tile_update' && action.after) restoreTile(map, action.target.tileX, action.target.tileY, action.after as Partial<Tile>);
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/unit/dev-mode-history.test.ts`
Expected: PASS.

### 5b — DevModeController

- [ ] **Step 5: Write the failing test**

```ts
// tests/unit/dev-mode-controller.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DevModeController } from '@/game/dev-mode-controller';
import { createState } from '@/core/state';
import { Scheduler } from '@/core/scheduler';
import { World } from '@/world/world';

describe('DevModeController.applyInspectorEdit', () => {
  let container: HTMLElement;
  afterEach(() => container?.remove());
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });

  it('persists an entity x/y edit through World.updateEntity and records undo', () => {
    const state = createState();
    const world = new World();
    world.addEntity({ id: 'e1', kind: 'rock', x: 1, y: 1, properties: {}, tags: [] } as any);
    state.world = world;
    const ctrl = new DevModeController({
      container, state, scheduler: new Scheduler(),
      getViewport: () => ({ width: 800, height: 600 }),
      getRenderDeps: () => ({ state } as any),
    });
    ctrl.devMode.selected = { type: 'entity', tileX: 1, tileY: 1, entity: { id: 'e1' } } as any;
    ctrl.applyInspectorEdit({ type: 'entity', tileX: 1, tileY: 1, entity: { id: 'e1' } } as any, 'x', 7);
    expect(world.query({}).find(e => e.id === 'e1')!.x).toBe(7);
    expect(ctrl.devMode.undoStack.length).toBe(1);
    ctrl.destroy();
  });
});
```

- [ ] **Step 6: Run test, verify it fails**

Run: `npx vitest run tests/unit/dev-mode-controller.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 7: Create `src/game/dev-mode-controller.ts`**

Owns the dev-mode state, the dev panels, dev keyboard shortcuts, and the spawn/delete/edit/paint/undo/redo logic. Move bodies from `game.ts`:
- panel construction: `mountInspectorPanel`/`mountDebugOverlayPanel`/`mountTimeDebugPanel`/`createEntitySpawner`/`mountMapEditorPanel`/`mountWorldInspector` + `devModeBtn` (lines ~369-426)
- `onToggleDevMode` (~559-579), `onRightClick` (~582-620), `attachDevKeyboardShortcuts` (~470-520)
- `spawnEntity` (~1092-1121), `applyInspectorEdit` (~1128-1173), `pushUndo` (~1176-1179), `deleteSelectedEntity` (~1182-1211), `undo`/`redo` (~1214-1257, now delegating to `applyUndo`/`applyRedo`), `refreshInspectorAfterHistory` (~1279-1283), `paintTile` (~1379-1395), `updateTimeDebugPanel` (~1397-1400)

```ts
// src/game/dev-mode-controller.ts
import type { GameState, DevModeState, HitResult, Entity, Tile, UndoAction } from '@/core/types';
import type { Scheduler } from '@/core/scheduler';
import type { Viewport } from './viewport';
import type { RenderContextDeps } from './render-context';
import { createDevMode, toggleDevMode } from '@/dev/DevMode';
import { hitTest } from '@/dev/hit-tester';
import { mountInspectorPanel, type InspectorPanelHandle } from '@/dev/InspectorPanel';
import { mountTimeDebugPanel, type TimeDebugPanelHandle } from '@/dev/TimeDebugPanel';
import { mountDebugOverlayPanel, type DebugOverlayPanelHandle } from '@/dev/DebugOverlayPanel';
import { mountWorldInspector, type WorldInspectorHandle } from '@/dev/WorldInspector';
import { createEntitySpawner, type EntitySpawnerHandle } from '@/dev/EntitySpawner';
import { mountMapEditorPanel, type MapEditorPanelHandle } from '@/dev/MapEditorPanel';
import { DEFAULT_DEBUG_OVERLAY_OPTIONS, drawDebugOverlays } from '@/render/debug-overlays';
import { buildRenderContext } from './render-context';
import { applyUndo, applyRedo } from './dev-mode-history';
import { TILE_SIZE } from '@/core/constants';

export interface DevModeControllerDeps {
  container: HTMLElement;
  state: GameState;
  scheduler: Scheduler;
  getViewport: () => Viewport;
  getRenderDeps: () => RenderContextDeps;
}

export class DevModeController {
  devMode: DevModeState = createDevMode();
  private btn: HTMLButtonElement;
  private inspector: InspectorPanelHandle;
  private debugOverlay: DebugOverlayPanelHandle;
  private timeDebug: TimeDebugPanelHandle;
  private spawner: EntitySpawnerHandle;
  private mapEditor: MapEditorPanelHandle;
  private worldInspector: WorldInspectorHandle;
  private detachKeys: (() => void) | null = null;

  constructor(private deps: DevModeControllerDeps) {
    const { container, state, scheduler } = deps;
    // --- dev-mode button (move cssText + hover handlers verbatim from game.ts ~369-386) ---
    this.btn = document.createElement('button');
    /* ...move button setup verbatim, then: */ this.btn.addEventListener('click', () => this.toggle());
    container.appendChild(this.btn);

    this.inspector = mountInspectorPanel(container, {
      onDelete: () => this.deleteSelected(),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
    });
    this.inspector.setOnChange((hit, key, value) => this.applyInspectorEdit(hit, key, value));
    this.debugOverlay = mountDebugOverlayPanel(container);
    this.timeDebug = mountTimeDebugPanel(container, { clock: state.clock, scheduler, eventLog: state.eventLog });
    this.spawner = createEntitySpawner(container);
    this.mapEditor = mountMapEditorPanel(container, { onPaintTile: (x, y, t) => this.paintTile(x, y, t) });
    this.worldInspector = mountWorldInspector(container);
    this.worldInspector.setCameraFocusCallback((x, y) => {
      const cam = state.camera; const vp = deps.getViewport();
      cam.x = x * TILE_SIZE - vp.width / 2; cam.y = y * TILE_SIZE - vp.height / 2;
    });
    this.attachKeyboard();
  }

  isEnabled(): boolean { return this.devMode.enabled; }

  // toggle(): move onToggleDevMode body (~559-579), swapping this.devModeBtn → this.btn,
  //   this.inspectorPanel → this.inspector, this.debugOverlayPanel → this.debugOverlay.
  toggle(): void { /* ...moved body... */ }

  // handleRightClick(sx, sy): move onRightClick body (~582-620). Build rc via
  //   buildRenderContext(this.deps.getRenderDeps()); on hit.type===null → this.spawner.open(...)
  //   then this.spawnEntity(...); else set this.devMode.selected + this.inspector.update(...).
  async handleRightClick(sx: number, sy: number): Promise<void> { /* ...moved body... */ }

  // attachKeyboard(): move attachDevKeyboardShortcuts body (~470-520), swapping
  //   this.worldInspector + this.onToggleDevMode()→this.toggle(); store detach in this.detachKeys.
  attachKeyboard(): void { /* ...moved body... */ }

  spawnEntity(opts: { kind: string; x: number; y: number; properties?: Record<string, unknown> }): void { /* move ~1092-1121 */ }
  applyInspectorEdit(hit: HitResult, key: string, value: unknown): void { /* move ~1128-1173, this.inspectorPanel→this.inspector */ }
  private pushUndo(a: UndoAction): void { this.devMode.undoStack.push(a); this.devMode.redoStack = []; }
  deleteSelected(): void { /* move deleteSelectedEntity ~1182-1211, this.inspectorPanel→this.inspector */ }

  undo(): void {
    if (this.devMode.undoStack.length === 0) return;
    const action = this.devMode.undoStack.pop()!;
    applyUndo(action, this.deps.state.world, this.deps.state.map);
    this.devMode.redoStack.push(action);
    this.refreshInspectorAfterHistory();
  }
  redo(): void {
    if (this.devMode.redoStack.length === 0) return;
    const action = this.devMode.redoStack.pop()!;
    applyRedo(action, this.deps.state.world, this.deps.state.map);
    this.devMode.undoStack.push(action);
    this.refreshInspectorAfterHistory();
  }
  private refreshInspectorAfterHistory(): void { if (this.devMode.selected) this.inspector.update(this.devMode.selected, this.devMode); }

  paintTile(x: number, y: number, tileType: string): void { /* move ~1379-1395 */ }

  /** Called each frame from FrameRenderer when dev mode is on. */
  drawOverlays(ctx: CanvasRenderingContext2D, deps: RenderContextDeps): void {
    if (!this.devMode.enabled) return;
    const rc = buildRenderContext(deps);
    const opts = {
      showBeliefHeatmap: !!this.devMode.showBeliefHeatmap, showNeeds: !!this.devMode.showNeeds,
      showMood: !!this.devMode.showMood, showSocialConnections: !!this.devMode.showSocialConnections,
      beliefThreshold: this.devMode.beliefThreshold ?? 0.3, selectedSpiritId: this.devMode.selectedSpiritId ?? null,
    };
    drawDebugOverlays(ctx, this.deps.state.camera, this.deps.state.world!, rc.npcs, opts);
    this.debugOverlay.update(this.devMode);
  }

  updateTimeDebug(): void { if (this.devMode.enabled) this.timeDebug.update(this.deps.state.clock, this.deps.scheduler, this.deps.state.eventLog); }

  updateWorldInspector(): void {
    const s = this.deps.state;
    this.worldInspector.update(s.world, s.map, s.spirits, s.generatedDecorations);
  }

  /** Tooltip + hit-test passthrough for InteractionController. */
  hitTest(sx: number, sy: number) { return hitTest(buildRenderContext(this.deps.getRenderDeps()), sx, sy); }

  destroy(): void {
    this.detachKeys?.();
    this.btn.remove();
    this.inspector.destroy?.();
  }
}
```
(The `/* move ... */` bodies are lifted verbatim from the cited `game.ts` line ranges with only the field-name substitutions noted in each comment. `DEFAULT_DEBUG_OVERLAY_OPTIONS` is used inside the moved `toggle()` body.)

- [ ] **Step 8: Run test, verify it passes**

Run: `npx vitest run tests/unit/dev-mode-controller.test.ts`
Expected: PASS.

- [ ] **Step 9: Rewire `game.ts`**

- Remove fields: `devMode`, `inspectorPanel`, `debugOverlayPanel`, `entitySpawner`, `timeDebugPanel`, `mapEditorPanel`, `worldInspector`, `devModeBtn`, `devModeCleanup`.
- Add field: `private dev!: DevModeController;`.
- In the constructor, **delete** the dev-button block (~369-386), the dev-panel block (~388-426 except `llmSettingsBtn`, which moves to `GameUi` in Task 8 — for now leave it in place), the `createDevMode()` + `attachDevKeyboardShortcuts()` block (~464-466). Replace with:
  ```ts
  this.dev = new DevModeController({
    container: this.container, state: this.state, scheduler: this.scheduler,
    getViewport: () => this.viewport(), getRenderDeps: () => this.renderDeps(),
  });
  ```
- Update `renderDeps()` to read `devMode: this.dev.devMode`.
- Delete methods `attachDevKeyboardShortcuts`, `onToggleDevMode`, `onRightClick`, `spawnEntity`, `applyInspectorEdit`, `pushUndo`, `deleteSelectedEntity`, `undo`, `redo`, `restoreEntitySnapshot`, `restoreTileSnapshot`, `refreshInspectorAfterHistory`, `paintTile`, `updateTimeDebugPanel` from `Game`.
- In `attachControls`'s `onRightClick: (sx, sy) => this.onRightClick(sx, sy)` → `(sx, sy) => void this.dev.handleRightClick(sx, sy)`.
- In `render()`: replace the `if (this.devMode.enabled) { ...drawDebugOverlays... }` block (~862-875) with `this.dev.drawOverlays(this.renderDeps());` and replace `this.updateTimeDebugPanel()` in the loop with `this.dev.updateTimeDebug()`.
- In `generateWorld()`, replace the `if (this.worldInspector) { this.worldInspector.update(...) }` block with `this.dev.updateWorldInspector();`.
- In `destroy()`, replace `this.inspectorPanel.destroy()` + `this.devModeBtn.remove()` + `this.devModeCleanup?.()` with `this.dev.destroy();`.
- Remove now-unused imports (`createDevMode`, `toggleDevMode`, `hitTest`, the dev panel mounts, `drawDebugOverlays`, `DEFAULT_DEBUG_OVERLAY_OPTIONS`, `formatDevTooltip` stays — used by tooltip) where `tsc` flags them. **Keep** `formatDevTooltip` + `hitTest` if `updateTooltip` still lives in `Game` (it does until Task 7); to avoid a double move, have `updateTooltip`'s dev branch call `this.dev.hitTest(...)` instead of importing `hitTest` directly.

- [ ] **Step 10: Typecheck + full suite + smoke**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: exit 0; suite + new tests pass.
Smoke: toggle dev mode (🔧 button / Ctrl+Shift+D), right-click to spawn/select, edit a property in the Inspector (persists), Ctrl+Z/Ctrl+Y undo/redo, paint a tile, toggle debug overlays.

- [ ] **Step 11: Commit**

```bash
git add src/game/dev-mode-history.ts src/game/dev-mode-controller.ts src/game.ts tests/unit/dev-mode-history.test.ts tests/unit/dev-mode-controller.test.ts
git commit -m "refactor(game): extract DevModeController + pure undo/redo reducer"
```

---

## Task 6: Extract `FrameRenderer`

**Files:**
- Create: `src/game/frame-renderer.ts`
- Modify: `src/game.ts`
- Test: `tests/dom/frame-renderer.test.ts`

`FrameRenderer` takes **individual handle deps** (not a `GameUi`), so Task 8 won't ripple back.

- [ ] **Step 1: Write the failing test (smoke — renders without throwing)**

```ts
// tests/dom/frame-renderer.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { FrameRenderer } from '@/game/frame-renderer';

describe('FrameRenderer', () => {
  it('render() no-ops when state.map is null', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const fr = new FrameRenderer({
      ctx,
      state: { map: null } as any,
      getRenderDeps: () => ({} as any),
      getViewport: () => ({ width: 100, height: 100 }),
      renderMap: () => null,
      divine: { lastCastTime: -Infinity } as any,
      dev: { drawOverlays() {}, isEnabled: () => false } as any,
      llmBackfill: { trigger: async () => {} } as any,
      interaction: { overlayHitAreas: [], poiOverlay: null, hoverTile: null, hoverScreen: null } as any,
      ui: {} as any,
    });
    expect(() => fr.render(16)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/dom/frame-renderer.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/game/frame-renderer.ts`**

Move the `render()` body (`game.ts:804-995`), `updateTooltip` (`~1010-1064`), and the `regenPerSec` HUD computation. Define a `FrameRendererUi` deps bag for the handles `render()` touches. Substitutions: `this.X` → `deps.X`; build `rc` via `buildRenderContext(deps.getRenderDeps())`; `this.lastWhisperTime` → `deps.divine.lastCastTime`; dev-overlay block → `deps.dev.drawOverlays(deps.getRenderDeps())`; info-panel cast callbacks → `deps.divine.*` / `deps.llmBackfill.trigger`; `this.overlayHitAreas` → `deps.interaction.overlayHitAreas`; `this.poiOverlay` → `deps.interaction.poiOverlay`; `this.hoverTile/hoverScreen` → `deps.interaction.*`.

```ts
// src/game/frame-renderer.ts
import type { GameState, NpcProperties } from '@/core/types';
import type { Viewport } from './viewport';
import type { RenderContextDeps } from './render-context';
import type { RenderFn } from '@/render/select-renderer';
import type { InteractionState } from './interaction-state';
import type { DivineActionsController } from './divine-actions-controller';
import type { DevModeController } from './dev-mode-controller';
import type { LlmBackfillService } from './llm-backfill';
import type { MinimapHandle } from '@/ui/minimap-panel';
import type { SpiritHudHandle } from '@/ui/spirit-hud';
import type { DivineEffects } from '@/render/divine-effects';
import { buildRenderContext } from './render-context';
import { getNpc, toRenderNpc, simStateFromEntity, npcProps } from '@/world/npc-helpers';
import { drawNpcOverlay, drawPoiOverlay } from '@/render/sim-overlay';
import { renderNpcInfoPanel } from '@/ui/npc-info-panel';
import { formatNpcTooltip } from '@/ui/npc-tooltip';
import { formatDevTooltip } from '@/dev/tooltip';
import { drawPowerHud } from '@/render/hud';
import { formatDebugHud } from '@/ui/debug-hud';
import { POWER_REGEN_RATE } from '@/sim/spirit-system';
import { TILE_SIZE } from '@/core/constants';

export interface FrameRendererUi {
  minimap: MinimapHandle;
  spiritHud: SpiritHudHandle;
  divineEffects: DivineEffects;
  npcInfoPanel: HTMLDivElement;
  tooltip: HTMLDivElement;
  debugHud: HTMLDivElement;
}

export interface FrameRendererDeps {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  ui: FrameRendererUi;
  divine: DivineActionsController;
  dev: DevModeController;
  llmBackfill: LlmBackfillService;
  interaction: InteractionState;
  getRenderDeps: () => RenderContextDeps;
  getViewport: () => Viewport;
  renderMap: () => RenderFn | null;
}

export class FrameRenderer {
  // throttle state for the info panel (moved from Game)
  private renderedNpcId: string | null = null;
  private renderedPinned = false;
  private lastInfoRefresh = 0;
  private fpsEma = 60;

  constructor(private deps: FrameRendererDeps) {}

  /** External hook so LlmBackfillService.onWriteback can force a panel refresh. */
  forceInfoRefresh(): void { this.lastInfoRefresh = 0; }

  render(deltaMs: number): void {
    // ...moved body of Game.render() with the substitutions listed in the plan...
    // ...includes the moved updateTooltip() logic at the end...
  }
}
```
(The full body is a verbatim move of `game.ts:804-995` + `1010-1064` with the substitutions above. `fpsEma` and the info-panel throttle fields move here; the loop passes `deltaMs`.)

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/dom/frame-renderer.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `game.ts`**

- Remove fields now owned by `FrameRenderer`: `renderedNpcId`, `renderedPinned`, `lastInfoRefresh`, `fpsEma`, `overlayHitAreas`, `poiOverlay`, `hoverTile`, `hoverScreen` → the last four move into a `this.interaction = createInteractionState()` field.
- Add fields: `private renderer!: FrameRenderer;`, `private interaction = createInteractionState();`.
- Construct `this.renderer` after the UI handles + `dev` + `divine` + `llmBackfill` exist:
  ```ts
  this.renderer = new FrameRenderer({
    ctx: this.ctx, state: this.state,
    ui: { minimap: this.minimap, spiritHud: this.spiritHud, divineEffects: this.divineEffects,
          npcInfoPanel: this.npcInfoPanel, tooltip: this.tooltip, debugHud: this.debugHud },
    divine: this.divine, dev: this.dev, llmBackfill: this.llmBackfill,
    interaction: this.interaction,
    getRenderDeps: () => this.renderDeps(), getViewport: () => this.viewport(),
    renderMap: () => this.renderMap,
  });
  ```
- Point `LlmBackfillService`'s `onWriteback` at `() => this.renderer.forceInfoRefresh()` (replaces the `this.lastInfoRefresh = 0` callback from Task 3).
- Delete `Game.render()` and `Game.updateTooltip()`. In `startLoop()`'s loop, replace `this.render(deltaMs)` with `this.renderer.render(deltaMs)`. The FPS EMA computation moves into `FrameRenderer.render`; delete it from the loop.
- Update `onCanvasClick` to read `this.interaction.overlayHitAreas`; `onTileClick`/`onTileRightClick`/`onRightClick`+hover callbacks to write `this.interaction.*` (these handlers still live in `Game` until Task 7).

- [ ] **Step 6: Typecheck + full suite + smoke**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: exit 0; suite + new test pass.
Smoke: full render still works — map, NPCs, selection overlay, POI overlay, power HUD, minimap, spirit HUD, tooltips (normal + dev), debug HUD, whisper gold flash.

- [ ] **Step 7: Commit**

```bash
git add src/game/frame-renderer.ts src/game.ts tests/dom/frame-renderer.test.ts
git commit -m "refactor(game): extract FrameRenderer (render + tooltip + hud passes)"
```

---

## Task 7: Extract `InteractionController`

**Files:**
- Create: `src/game/interaction-controller.ts`
- Modify: `src/game.ts`
- Test: `tests/unit/interaction-controller.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/interaction-controller.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { InteractionController } from '@/game/interaction-controller';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { createInteractionState } from '@/game/interaction-state';
import { OverlayDispatcher } from '@/ui/overlay-dispatcher';

function ctrlWith(state: any) {
  return new InteractionController({
    state,
    dispatcher: new OverlayDispatcher(),
    interaction: createInteractionState(),
    dev: { isEnabled: () => false, handleRightClick: async () => {} } as any,
    placementModal: { open: async () => null } as any,
    decorationImages: { load: async () => {}, get: () => null } as any,
  });
}

describe('InteractionController.onTileClick', () => {
  it('selects then deselects an NPC on repeat click', () => {
    const state = createState();
    const world = new World();
    world.addEntity({ id: 'n1', kind: 'npc', x: 2, y: 2, properties: initNpcProps('Ana', 'farmer', 1) as any, tags: [] });
    state.world = world; state.map = { width: 4, height: 4, tiles: [] } as any;
    const ctrl = ctrlWith(state);
    ctrl.onTileClick(2, 2);
    expect(state.selectedNpcId).toBe('n1');
    ctrl.onTileClick(2, 2);
    expect(state.selectedNpcId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/unit/interaction-controller.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/game/interaction-controller.ts`**

Move `onTileClick` (`~1072-1087`), `onCanvasClick` (`~1066-1070`), `onTileRightClick` (`~705-737`). Dev right-clicks delegate to `dev.handleRightClick`.

```ts
// src/game/interaction-controller.ts
import type { GameState } from '@/core/types';
import type { OverlayDispatcher } from '@/ui/overlay-dispatcher';
import type { InteractionState } from './interaction-state';
import type { DevModeController } from './dev-mode-controller';
import type { DecorationPlacementModalHandle } from '@/ui/decoration-placement-modal';
import type { DecorationImageCache } from '@/render/decoration-image-cache';
import { saveDecorations } from '@/services/decoration-store';

export interface InteractionControllerDeps {
  state: GameState;
  dispatcher: OverlayDispatcher;
  interaction: InteractionState;
  dev: DevModeController;
  placementModal: DecorationPlacementModalHandle;
  decorationImages: DecorationImageCache;
}

export class InteractionController {
  constructor(private deps: InteractionControllerDeps) {}

  onCanvasClick(sx: number, sy: number): boolean {
    this.deps.interaction.poiOverlay = null;
    return this.deps.dispatcher.tryDispatch(sx, sy, this.deps.interaction.overlayHitAreas);
  }

  onTileClick(x: number, y: number): void {
    const { state, interaction } = this.deps;
    if (!state.map || !state.world) return;
    interaction.poiOverlay = null;
    const clicked = state.world.query({ kind: 'npc' }).find(e => Math.floor(e.x) === x && Math.floor(e.y) === y);
    if (clicked) {
      state.selectedNpcId = state.selectedNpcId === clicked.id ? null : clicked.id;
      if (state.pinnedNpcId && state.pinnedNpcId !== state.selectedNpcId) state.pinnedNpcId = null;
    } else if (!state.pinnedNpcId) {
      state.selectedNpcId = null;
    }
  }

  async onTileRightClick(tileX: number, tileY: number): Promise<void> {
    // ...move body verbatim from game.ts:705-737, this.poiOverlay → this.deps.interaction.poiOverlay,
    //    this.state → this.deps.state, this.placementModal → this.deps.placementModal,
    //    this.decorationImages → this.deps.decorationImages...
  }

  async onRightClick(sx: number, sy: number): Promise<void> {
    if (this.deps.dev.isEnabled()) { await this.deps.dev.handleRightClick(sx, sy); }
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/unit/interaction-controller.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `game.ts`**

- Add field `private input!: InteractionController;`, construct it after `dev`/`dispatcher`/`placementModal` exist.
- Delete `Game.onTileClick`, `onCanvasClick`, `onTileRightClick`, `onRightClick`.
- In `attachControls`: `onTileClick: (x, y) => this.input.onTileClick(x, y)`, `onCanvasClick: (sx, sy) => this.input.onCanvasClick(sx, sy)`, `onTileRightClick: (x, y) => void this.input.onTileRightClick(x, y)`, `onRightClick: (sx, sy) => void this.input.onRightClick(sx, sy)`. The `onHoverTile` callback still writes `this.interaction.hoverTile/hoverScreen`.

- [ ] **Step 6: Typecheck + full suite + smoke**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: exit 0; suite + new test pass.
Smoke: click to select/deselect NPC, pin behavior, overlay-button dispatch (whisper etc.), right-click POI overlay + decoration placement, dev-mode right-click spawn/select.

- [ ] **Step 7: Commit**

```bash
git add src/game/interaction-controller.ts src/game.ts tests/unit/interaction-controller.test.ts
git commit -m "refactor(game): extract InteractionController"
```

---

## Task 8: Extract `GameUi`

**Files:**
- Create: `src/game/game-ui.ts`
- Modify: `src/game.ts`
- Test: `tests/dom/game-ui.test.ts`

`GameUi` owns gameplay UI handles + raw DOM panels, exposes them as readonly fields, and has `destroy()`. Constructor takes `container` + a callbacks bag (the behavior wires `Game` provides).

- [ ] **Step 1: Write the failing test**

```ts
// tests/dom/game-ui.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { GameUi } from '@/game/game-ui';

describe('GameUi', () => {
  let ui: GameUi | null = null;
  let container: HTMLElement;
  afterEach(() => { ui?.destroy(); container?.remove(); });

  it('mounts panels into the container and destroy() removes them', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const before = container.childElementCount;
    ui = new GameUi(container, {
      onStart: () => {}, onSettings: () => {}, onSelectRival: () => {},
      onTargetNpc: () => {}, onClickMinimapTile: () => {}, onLLMSettings: () => {},
    });
    expect(container.childElementCount).toBeGreaterThan(before);
    expect(ui.npcInfoPanel).toBeInstanceOf(HTMLDivElement);
    ui.destroy();
    ui = null;
    expect(container.querySelector('canvas')).toBeNull(); // GameUi adds no canvas
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/dom/game-ui.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/game/game-ui.ts`**

Move constructor blocks from `game.ts`: the raw DOM panels `pausedBanner` (~242-250), `debugHud` (~252-260), `npcInfoPanel` (~262-270), `tooltip` (~279-287); `llmDisplay` (~272-277); `unifiedSettings` (~289-304); `mainMenu` (~306-315); `tutorial` (~317-327); `spiritHud` (~329-342); `rivalPanel` (~344-350); `minimap` (~352-363); `divineEffects` (~365-366) — **note** `divineEffects` is now created in the constructor before `DivineActionsController` (Task 4); decide a single owner: **`GameUi` owns `divineEffects`** and `Game` reads `this.ui.divineEffects` when constructing `DivineActionsController`; `llmSettingsBtn` (~404-414); `chrome`/`veil`/`timeChip` (~225-232); `placementModal` (~429).

```ts
// src/game/game-ui.ts
import { createLlmDisplay, type LlmDisplayHandle } from '@/ui/llm-display';
import { createSettingsPanel as createUnifiedSettings, type SettingsHandle } from '@/ui/settings-unified';
import { createMainMenu, type MainMenuHandle } from '@/ui/main-menu';
import { createTutorial, type TutorialHandle } from '@/ui/tutorial';
import { createSpiritHud, type SpiritHudHandle } from '@/ui/spirit-hud';
import { createRivalPanel, type RivalPanelHandle } from '@/ui/rival-panel';
import { createMinimapPanel, type MinimapHandle } from '@/ui/minimap-panel';
import { DivineEffects } from '@/render/divine-effects';
import { createDecorationPlacementModal, type DecorationPlacementModalHandle } from '@/ui/decoration-placement-modal';
import { mountChrome, mountPastVeil } from '@/ui/chrome';
import { mountTimeChip, type TimeChipHandle } from '@/ui/panels/time-chip';

export interface GameUiCallbacks {
  onStart: () => void;
  onSettings: () => void;
  onSelectRival: (rivalId: string) => void;
  onTargetNpc: (npcId: string) => void;
  onClickMinimapTile: (x: number, y: number) => void;
  onLLMSettings: () => void;
}

export class GameUi {
  readonly pausedBanner: HTMLDivElement;
  readonly debugHud: HTMLDivElement;
  readonly npcInfoPanel: HTMLDivElement;
  readonly tooltip: HTMLDivElement;
  readonly llmDisplay: LlmDisplayHandle;
  readonly unifiedSettings: SettingsHandle;
  readonly mainMenu: MainMenuHandle;
  readonly tutorial: TutorialHandle;
  readonly spiritHud: SpiritHudHandle;
  readonly rivalPanel: RivalPanelHandle;
  readonly minimap: MinimapHandle;
  readonly divineEffects = new DivineEffects();
  readonly llmSettingsBtn: HTMLButtonElement;
  readonly chrome: ReturnType<typeof mountChrome>;
  readonly veil: ReturnType<typeof mountPastVeil>;
  readonly timeChip!: TimeChipHandle;       // assigned by Game (needs clock/scheduler/onClick)
  readonly placementModal: DecorationPlacementModalHandle;

  constructor(private container: HTMLElement, cb: GameUiCallbacks) {
    // ...move each construction block verbatim, wiring the callback params:
    //   mainMenu.onStart → cb.onStart, onSettings → cb.onSettings
    //   spiritHud.onSelectRival → cb.onSelectRival
    //   rivalPanel.onTargetNpc → cb.onTargetNpc
    //   minimap.onClickTile → cb.onClickMinimapTile
    //   llmSettingsBtn click → cb.onLLMSettings
    //   private buildStatusPanels() helper creates pausedBanner/debugHud/npcInfoPanel/tooltip...
  }

  destroy(): void {
    this.pausedBanner.remove(); this.debugHud.remove(); this.npcInfoPanel.remove(); this.tooltip.remove();
    this.llmSettingsBtn.remove();
    this.unifiedSettings.destroy(); this.placementModal.destroy();
    this.timeChip.dispose(); this.veil.dispose(); this.chrome.dispose();
    this.llmDisplay.destroy?.();
  }
}
```
**`timeChip` caveat:** `mountTimeChip` needs `clock`, `getRate`, `isPaused`, `onClick` — all `Game`-owned. Keep `timeChip` construction in `Game` (it depends on `scheduler`/`timeline`), assign into `GameUi` via a setter, or pass those deps through `GameUiCallbacks`. Chosen approach: leave `chrome`/`veil`/`timeChip` construction in `Game` (they couple to time/scheduler), and have `GameUi` own only the gameplay panels listed above. Update the test and `destroy()` split accordingly: `Game.destroy()` disposes `chrome`/`veil`/`timeChip`; `GameUi.destroy()` disposes the rest.

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/dom/game-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `game.ts`**

- Replace the individual UI fields with `private ui!: GameUi;` (keep `chrome`/`veil`/`timeChip` as `Game` fields per the caveat).
- Construct `this.ui = new GameUi(this.container, { onStart: () => { if (!this.state.map) void this.generateWorld(); }, onSettings: () => this.ui.unifiedSettings.toggle(), onSelectRival: (id) => {/* moved spiritHud body */}, onTargetNpc: (id) => { this.state.selectedNpcId = id; }, onClickMinimapTile: (x, y) => {/* moved minimap camera body */}, onLLMSettings: () => this.ui.unifiedSettings.toggle() });` early in the constructor (before `dev`, `divine`, `renderer`, `input`).
- Everywhere `Game` referenced a moved handle, read `this.ui.<handle>` (e.g. `this.ui.mainMenu.hide()`, `this.ui.spiritHud.show()`, `this.ui.divineEffects`, `this.ui.npcInfoPanel`, etc.). The `DivineActionsController` and `FrameRenderer` constructions read `this.ui.divineEffects` / `this.ui.minimap` / `this.ui.spiritHud` / `this.ui.npcInfoPanel` / `this.ui.tooltip` / `this.ui.debugHud`.
- In `onGameSettingChange`, `this.debugHud` → `this.ui.debugHud`.
- In `destroy()`, replace the per-handle removals with `this.ui.destroy();` (keep `chrome`/`veil`/`timeChip` disposal + `canvas.remove()` in `Game`).
- Remove now-unused UI imports from `game.ts`.

- [ ] **Step 6: Typecheck + full suite + smoke**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: exit 0; suite + new test pass.
Smoke: main menu → start, settings toggle, tutorial, spirit HUD + rival panel, minimap click-to-pan, LLM settings button, paused banner, debug HUD, decoration placement modal.

- [ ] **Step 7: Commit**

```bash
git add src/game/game-ui.ts src/game.ts tests/dom/game-ui.test.ts
git commit -m "refactor(game): extract GameUi (gameplay UI handle ownership)"
```

---

## Task 9: Extract `bootstrapWorld` — Game becomes thin

**Files:**
- Create: `src/game/bootstrap-world.ts`
- Modify: `src/game.ts`

- [ ] **Step 1: Create `src/game/bootstrap-world.ts`**

Move the body of `generateWorld` (`game.ts:629-703`) minus `this.startLoop()`, plus `kickOffNpcSpritesheets` (`~739-749`). It mutates `state`, centers the camera, seeds the world, kicks off spritesheets + decorations, and calls injected UI hooks.

```ts
// src/game/bootstrap-world.ts
import type { GameState, GameMap, WorldSeed } from '@/core/types';
import type { AssetManager } from '@/render/asset-manager';
import type { DecorationImageCache } from '@/render/decoration-image-cache';
import type { Viewport } from './viewport';
import type { RenderFn } from '@/render/select-renderer';
import { WorldManager } from '@/map/world-manager';
import { generateWithNoise } from '@/map/map-generator';
import { Autotiler } from '@/map/autotiler';
import { computeBlobMap } from '@/map/blob-autotiler';
import { centerOn } from '@/render/camera';
import { readRenderMode } from '@/render/select-renderer';
import { seedWorld } from '@/world/seed-world';
import { identityOracle } from '@/world/oracle';
import { buildCharacterSpec, getOrGenerateSheet } from '@/render/lpc';
import { npcProps } from '@/world/npc-helpers';
import { loadDecorations } from '@/services/decoration-store';
import { TILE_SIZE } from '@/core/constants';

export interface BootstrapDeps {
  state: GameState;
  assets: AssetManager;
  sheets: Map<string, HTMLCanvasElement>;
  decorationImages: DecorationImageCache;
  getViewport: () => Viewport;
  /** When seed not supplied, default world is loaded. */
  worldSeed?: WorldSeed;
  /** Fired after world is ready, before the loop starts. */
  onReady?: () => void;
}

export async function bootstrapWorld(deps: BootstrapDeps): Promise<GameMap> {
  // ...move generateWorld body (629-700) verbatim, with:
  //   this.state → deps.state; this.assets → deps.assets; this.sheets → deps.sheets;
  //   this.decorationImages → deps.decorationImages;
  //   camera centring uses deps.getViewport() instead of this.canvas.width/dpr;
  //   the mainMenu.hide()/spiritHud.show()/tutorial/worldInspector calls become deps.onReady();
  //   kickOffNpcSpritesheets() body inlined as a local helper.
  // Returns the generated map. Caller awaits selectRenderer() + calls startLoop().
}
```
Note: `selectRenderer()` (which sets `renderMap`) stays in `Game.generateWorld` since it owns `renderMap`; `bootstrapWorld` does the data/world work only.

- [ ] **Step 2: Rewire `Game.generateWorld`**

```ts
async generateWorld(worldSeed?: WorldSeed, _terrainOptions?: Partial<TerrainOptions>): Promise<GameMap> {
  this.renderMap = await selectRenderer();
  const map = await bootstrapWorld({
    state: this.state, assets: this.assets, sheets: this.sheets,
    decorationImages: this.decorationImages, getViewport: () => this.viewport(),
    worldSeed,
    onReady: () => {
      this.ui.mainMenu.hide();
      this.ui.spiritHud.show();
      if (!localStorage.getItem('small-gods-tutorial-seen')) setTimeout(() => this.ui.tutorial.show('welcome'), 500);
      this.dev.updateWorldInspector();
    },
  });
  this.kickOffSheets?.(); // if spritesheet kickoff stays callable; otherwise handled inside bootstrap
  this.startLoop();
  return map;
}
```
- Delete `Game.generateWorld`'s old body, `Game.kickOffNpcSpritesheets`. Add import `bootstrapWorld`. Remove now-unused imports (`WorldManager`, `generateWithNoise`, `Autotiler`, `computeBlobMap`, `centerOn`, `seedWorld`, `buildCharacterSpec`, `getOrGenerateSheet`, `loadDecorations`) where `tsc` flags them.

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: exit 0; full suite passes.

- [ ] **Step 4: Manual smoke — full playthrough**

Run `npm run dev`: main menu → start → world generates, NPCs spawn with spritesheets, decorations load, camera centers, tutorial shows on first visit. Then exercise: time bar (T), pause (Space), rate keys, selection, all five divine actions (overlay + info-panel), LLM backfill, dev mode (spawn/edit/undo/redo/paint/overlays), minimap, settings.

- [ ] **Step 5: Verify the line-count goal**

Run: `wc -l src/game.ts`
Expected: ≤ ~300 lines.

- [ ] **Step 6: Commit**

```bash
git add src/game/bootstrap-world.ts src/game.ts
git commit -m "refactor(game): extract bootstrapWorld; Game is now a thin coordinator"
```

---

## Final verification

- [ ] `npx tsc --noEmit` → exit 0
- [ ] `npm test -- --run` → 746 baseline + new tests (interaction-state, render-context, advance-npc-frames, camera-follow, llm-backfill, divine-actions-controller, dev-mode-history, dev-mode-controller, frame-renderer, interaction-controller, game-ui) all pass
- [ ] `wc -l src/game.ts` → ≤ ~300
- [ ] `grep -c "RenderContext = {" src/game.ts` → 0 (no inline literals remain)
- [ ] Manual full playthrough clean (Task 9 Step 4)
- [ ] Update `docs/HANDOFF-2026-05-30.md` (or a new handoff) + `MEMORY.md` noting `game.ts` is decomposed and the `src/game/` module map

---

## Self-review notes (author)

- **Spec coverage:** every spec module maps to a task — render-context (T1), frame-renderer (T6), divine-actions-controller (T4), dev-mode-controller (T5), interaction-controller (T7), llm-backfill (T3), game-ui (T8), bootstrap-world (T9), camera-follow (T3); relocations (T2); cleanups (RenderContext dedup T1, divine call-site unify T4, dead `showNarrationPopup` deletion T3, LLM provider seam T3). Testing plan items all present. Out-of-scope items untouched.
- **Ordering safeguard:** `FrameRenderer`/`InteractionController` take individual handle deps so `GameUi` (T8) doesn't ripple back; `divineEffects` single-owner resolved (GameUi owns it, T4 reads `this.ui.divineEffects` — but T4 precedes T8, so during T4–T7 `divineEffects` stays a `Game` field and is migrated to `GameUi` in T8; the T4 construction reads `this.divineEffects`, updated to `this.ui.divineEffects` in T8 Step 5).
- **Type consistency:** `RenderContextDeps`, `Viewport`, `InteractionState`, `lastCastTime`, `applyUndo`/`applyRedo`, `forceInfoRefresh` names are used identically across tasks.
```
