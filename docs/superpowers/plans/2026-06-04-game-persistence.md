# Game Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single auto-saved slot (IndexedDB) that silently resumes the exact live world — sim, spirits, belief, clock, event history, camera, selection — on the next page load, plus a "New World" reset.

**Architecture:** Full-state snapshot (reusing `captureSnapshot`/`restoreSnapshot`), not deterministic replay (LLM belief mutations aren't replayable). A `SaveFile` bundles the snapshot + map + biomeMap + worldSeed + serialized event log + view state. A `PersistenceController` does throttled-on-change autosave gated on `!timeline.isScrubbed`, flushed on tab close. `bootstrapWorld` reads any save first and rehydrates instead of seeding.

**Tech Stack:** TypeScript ESM, Vitest + `fake-indexeddb`, IndexedDB (mirrors `src/services/pixellab.ts`).

Spec: `docs/superpowers/specs/2026-06-04-game-persistence-design.md`

---

### Task 1: `EventLog.hydrate`

**Files:**
- Modify: `src/core/events.ts` (EventLog class)
- Test: `tests/unit/events.test.ts` (extend; create if absent)

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { EventLog, type AppendedEvent } from '@/core/events';
import { SimClock } from '@/core/clock';

describe('EventLog.hydrate', () => {
  it('restores events and keeps nextId ahead of the highest id', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const events: AppendedEvent[] = [
      { id: 1, t: 0, event: { type: 'spirit_birth', spiritId: 'player', name: 'Fooob', isPlayer: true } },
      { id: 2, t: 5, event: { type: 'whisper', spiritId: 'player', npcId: 'n1' } },
    ];
    log.hydrate(events);
    expect(log.size()).toBe(2);
    expect(log.since(0).map(e => e.id)).toEqual([1, 2]);
    clock.setNow(9);
    const appended = log.append({ type: 'dream', spiritId: 'player', npcId: 'n1' });
    expect(appended.id).toBe(3); // ahead of the highest hydrated id
  });

  it('hydrate of an empty array resets to empty with nextId 1', () => {
    const log = new EventLog(new SimClock());
    log.hydrate([]);
    expect(log.size()).toBe(0);
    expect(log.append({ type: 'power_depleted', spiritId: 'player' }).id).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/unit/events.test.ts` → "hydrate is not a function".

- [ ] **Step 3: Implement** — add to `EventLog` (after `truncateAfter`):

```ts
  /**
   * Bulk-load a serialized event array (from a save file). Replaces the log
   * contents and advances `nextId` past every restored id so future appends
   * never reuse one. Silent: subscribers are not re-notified.
   */
  hydrate(events: AppendedEvent[]): void {
    this.events = events.slice();
    this.nextId = events.reduce((m, e) => (e.id > m ? e.id : m), 0) + 1;
  }
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `git add src/core/events.ts tests/unit/events.test.ts && git commit`.

---

### Task 2: `save-store.ts` (IndexedDB CRUD)

**Files:**
- Create: `src/services/save-store.ts`
- Test: `tests/unit/save-store.test.ts`

Mirrors the `openDb`/promisified-request pattern in `src/services/pixellab.ts:91-170`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { writeSave, readSave, clearSave, _resetSaveDbForTesting } from '@/services/save-store';
import type { SaveFile } from '@/core/save-file';

function fakeSave(tick: number): SaveFile {
  return {
    version: 1, savedAt: 1000, worldSeed: { name: 'w' } as any, map: { width: 1, height: 1 } as any,
    biomeMap: null,
    snapshot: { tick, eventId: 0, rng: [1, 2, 3, 4] as any, entities: [], activeEvents: [], spirits: [] },
    events: [], view: {} as any,
  };
}

describe('save-store', () => {
  beforeEach(() => { _resetSaveDbForTesting(); (globalThis as any).indexedDB = new IDBFactory(); });

  it('round-trips a save under the default slot', async () => {
    await writeSave(fakeSave(42));
    const got = await readSave();
    expect(got?.snapshot.tick).toBe(42);
  });

  it('returns null for an absent slot', async () => {
    expect(await readSave()).toBeNull();
  });

  it('clearSave removes the saved slot', async () => {
    await writeSave(fakeSave(7));
    await clearSave();
    expect(await readSave()).toBeNull();
  });

  it('overwrites the same slot on re-write', async () => {
    await writeSave(fakeSave(1));
    await writeSave(fakeSave(2));
    expect((await readSave())?.snapshot.tick).toBe(2);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement** `src/services/save-store.ts`:

```ts
import type { SaveFile } from '@/core/save-file';

const DB_NAME = 'small-gods-saves';
const DB_VERSION = 1;
const DB_STORE = 'saves';
const DEFAULT_SLOT = 'autosave';

interface StoredSave { key: string; save: SaveFile; }

let _db: IDBDatabase | null = null;

/** Test-only: drop the cached connection so a fresh IDBFactory is picked up. */
export function _resetSaveDbForTesting(): void {
  if (_db) { _db.close(); _db = null; }
}

function hasIdb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

export async function writeSave(save: SaveFile, slot: string = DEFAULT_SLOT): Promise<void> {
  if (!hasIdb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({ key: slot, save } satisfies StoredSave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[save-store] writeSave failed:', err);
  }
}

export async function readSave(slot: string = DEFAULT_SLOT): Promise<SaveFile | null> {
  if (!hasIdb()) return null;
  try {
    const db = await openDb();
    return await new Promise<SaveFile | null>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(slot);
      req.onsuccess = () => resolve((req.result as StoredSave | undefined)?.save ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[save-store] readSave failed:', err);
    return null;
  }
}

export async function clearSave(slot: string = DEFAULT_SLOT): Promise<void> {
  if (!hasIdb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(slot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[save-store] clearSave failed:', err);
  }
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

---

### Task 3: `save-file.ts` (serialize / deserialize)

**Files:**
- Create: `src/core/save-file.ts`
- Test: `tests/unit/save-file.test.ts`

- [ ] **Step 1: Failing test** — round-trips through a real seeded world. Use the existing snapshot test's world-building helper style (build a minimal state via `createState`, a tiny map, a couple of entities).

```ts
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { SAVE_VERSION, toSaveFile, applySaveFile } from '@/core/save-file';
import type { GameMap, BiomeMap } from '@/core/types';

function miniMap(): GameMap {
  return { width: 2, height: 2, tiles: [['grass','grass'],['grass','grass']], pois: [], buildings: [] } as unknown as GameMap;
}

function seededState() {
  const s = createState();
  s.map = miniMap();
  s.biomeMap = { width: 2, height: 2, cells: [] } as unknown as BiomeMap;
  s.world = new World(s.map);
  s.world.addEntity({ id: 'n1', kind: 'npc', x: 0, y: 0, properties: { name: 'Maeve', beliefs: { player: { faith: 0.4, understanding: 0.2, devotion: 0.1 } } } } as any);
  s.clock.setNow(123);
  s.eventLog.append({ type: 'whisper', spiritId: 'player', npcId: 'n1' });
  s.camera.x = 50; s.camera.y = 60; s.camera.zoom = 2;
  s.selectedNpcId = 'n1';
  return s;
}

describe('save-file', () => {
  it('toSaveFile captures snapshot, map, events, and view', () => {
    const save = toSaveFile(seededState(), 9999);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.savedAt).toBe(9999);
    expect(save.snapshot.tick).toBe(123);
    expect(save.snapshot.entities).toHaveLength(1);
    expect(save.events.length).toBeGreaterThanOrEqual(1);
    expect(save.view.camera.zoom).toBe(2);
    expect(save.view.selectedNpcId).toBe('n1');
  });

  it('round-trip restores tick, entities, eventLog, and camera into a fresh state', () => {
    const save = toSaveFile(seededState(), 1);
    const fresh = createState();
    fresh.map = miniMap();
    fresh.world = new World(fresh.map);
    const ok = applySaveFile(fresh, save);
    expect(ok).toBe(true);
    expect(fresh.clock.now()).toBe(123);
    expect(fresh.world!.query({ kind: 'npc' })).toHaveLength(1);
    expect(fresh.eventLog.size()).toBe(save.events.length);
    expect(fresh.camera.zoom).toBe(2);
    expect(fresh.selectedNpcId).toBe('n1');
  });

  it('applySaveFile returns false on version mismatch and leaves state untouched', () => {
    const save = toSaveFile(seededState(), 1);
    save.version = 999;
    const fresh = createState();
    fresh.map = miniMap();
    fresh.world = new World(fresh.map);
    const before = fresh.clock.now();
    expect(applySaveFile(fresh, save)).toBe(false);
    expect(fresh.clock.now()).toBe(before);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/core/save-file.ts`:

```ts
import type { GameState } from '@/core/state';
import type { GameMap, BiomeMap, Camera, EntityId, WorldSeed } from '@/core/types';
import type { AppendedEvent } from '@/core/events';
import { captureSnapshot, restoreSnapshot, type Snapshot } from '@/core/snapshot';
import { Autotiler } from '@/map/autotiler';
import { computeBlobMap } from '@/map/blob-autotiler';

export const SAVE_VERSION = 1;

export interface SaveView {
  camera: Camera;
  selectedNpcId: string | null;
  pinnedNpcId: string | null;
  followNpc: boolean;
  cameraLock: { mode: 'follower' | 'free'; targetId?: EntityId };
  debug: boolean;
  showLabels: boolean;
  showPoiMarkers: boolean;
}

export interface SaveFile {
  version: number;
  savedAt: number;
  worldSeed: WorldSeed | null;
  map: GameMap;
  biomeMap: BiomeMap | null;
  snapshot: Snapshot;
  events: AppendedEvent[];
  view: SaveView;
}

export function toSaveFile(state: GameState, savedAt: number): SaveFile {
  if (!state.world || !state.map) {
    throw new Error('toSaveFile: world/map not initialized');
  }
  return {
    version: SAVE_VERSION,
    savedAt,
    worldSeed: state.worldSeed,
    map: structuredClone(state.map),
    biomeMap: state.biomeMap ? structuredClone(state.biomeMap) : null,
    snapshot: captureSnapshot(state),
    events: structuredClone(state.eventLog.since(0)),
    view: {
      camera: { ...state.camera },
      selectedNpcId: state.selectedNpcId,
      pinnedNpcId: state.pinnedNpcId,
      followNpc: state.followNpc,
      cameraLock: { ...state.cameraLock },
      debug: state.debug,
      showLabels: state.showLabels,
      showPoiMarkers: state.showPoiMarkers,
    },
  };
}

/** Returns false (and mutates nothing) on a version mismatch. */
export function applySaveFile(state: GameState, save: SaveFile): boolean {
  if (save.version !== SAVE_VERSION) return false;

  // Map must be set BEFORE restoreSnapshot — it does `new World(state.map)`.
  state.map = structuredClone(save.map);
  state.worldSeed = save.worldSeed;
  state.biomeMap = save.biomeMap ? structuredClone(save.biomeMap) : null;
  state.visualMap = Autotiler.computeVisualMap(state.map);
  state.blobMap = computeBlobMap(state.map.tiles, state.map.width, state.map.height);

  restoreSnapshot(state, save.snapshot);
  state.eventLog.hydrate(structuredClone(save.events));

  const v = save.view;
  Object.assign(state.camera, v.camera);
  state.selectedNpcId = v.selectedNpcId;
  state.pinnedNpcId = v.pinnedNpcId;
  state.followNpc = v.followNpc;
  state.cameraLock = { ...v.cameraLock };
  state.debug = v.debug;
  state.showLabels = v.showLabels;
  state.showPoiMarkers = v.showPoiMarkers;
  return true;
}
```

- [ ] **Step 4: Run, expect PASS.** If `computeBlobMap`/`computeVisualMap` choke on the 2×2 stub map, give the test map real tile-id strings the autotiler accepts (grass), or expand `miniMap()` to a shape those helpers accept — confirm by running.
- [ ] **Step 5: Commit.**

---

### Task 4: `PersistenceController`

**Files:**
- Create: `src/game/persistence-controller.ts`
- Test: `tests/unit/persistence-controller.test.ts`

Injectable writer + clock so tests don't touch IDB or real time.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { PersistenceController } from '@/game/persistence-controller';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import type { GameMap } from '@/core/types';
import type { SaveFile } from '@/core/save-file';

function state() {
  const s = createState();
  s.map = { width: 1, height: 1, tiles: [['grass']], pois: [], buildings: [] } as unknown as GameMap;
  s.world = new World(s.map);
  return s;
}

function mkController(over: Partial<ConstructorParameters<typeof PersistenceController>[0]> = {}) {
  const writes: SaveFile[] = [];
  let t = 0;
  const ctrl = new PersistenceController({
    state: state(),
    timeline: { isScrubbed: false } as any,
    now: () => t,
    throttleMs: 1000,
    write: async (s) => { writes.push(s); },
    ...over,
  });
  return { ctrl, writes, setNow: (n: number) => { t = n; }, getT: () => t };
}

describe('PersistenceController', () => {
  it('coalesces multiple dirty marks into one throttled write', async () => {
    vi.useFakeTimers();
    const { ctrl, writes } = mkController();
    ctrl.start();
    ctrl.markDirty(); ctrl.markDirty(); ctrl.markDirty();
    await vi.advanceTimersByTimeAsync(1100);
    expect(writes.length).toBe(1);
    ctrl.destroy();
    vi.useRealTimers();
  });

  it('does not write while the timeline is scrubbed', async () => {
    vi.useFakeTimers();
    const { ctrl, writes } = mkController({ timeline: { isScrubbed: true } as any });
    ctrl.start();
    ctrl.markDirty();
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes.length).toBe(0);
    ctrl.destroy();
    vi.useRealTimers();
  });

  it('flush() writes immediately when dirty', async () => {
    const { ctrl, writes } = mkController();
    ctrl.start();
    ctrl.markDirty();
    await ctrl.flush();
    expect(writes.length).toBe(1);
    ctrl.destroy();
  });

  it('flush() is a no-op when not dirty', async () => {
    const { ctrl, writes } = mkController();
    ctrl.start();
    await ctrl.flush();
    expect(writes.length).toBe(0);
    ctrl.destroy();
  });

  it('destroy() cancels a pending throttled write', async () => {
    vi.useFakeTimers();
    const { ctrl, writes } = mkController();
    ctrl.start();
    ctrl.markDirty();
    ctrl.destroy();
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes.length).toBe(0);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/game/persistence-controller.ts`:

```ts
import type { GameState } from '@/core/state';
import type { TimelineController } from '@/core/timeline';
import { toSaveFile, type SaveFile } from '@/core/save-file';
import { writeSave } from '@/services/save-store';

export interface PersistenceDeps {
  state: GameState;
  timeline: Pick<TimelineController, 'isScrubbed'>;
  now: () => number;
  throttleMs?: number;
  /** Injectable for tests; defaults to the IndexedDB save-store writer. */
  write?: (save: SaveFile) => Promise<void>;
}

export class PersistenceController {
  private readonly state: GameState;
  private readonly timeline: Pick<TimelineController, 'isScrubbed'>;
  private readonly now: () => number;
  private readonly throttleMs: number;
  private readonly write: (save: SaveFile) => Promise<void>;

  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private onVisibility = (): void => { if (document.visibilityState === 'hidden') void this.flush(); };
  private onUnload = (): void => { void this.flush(); };

  constructor(deps: PersistenceDeps) {
    this.state = deps.state;
    this.timeline = deps.timeline;
    this.now = deps.now;
    this.throttleMs = deps.throttleMs ?? 3000;
    this.write = deps.write ?? writeSave;
  }

  start(): void {
    this.unsubscribe = this.state.eventLog.subscribe(() => this.markDirty());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('beforeunload', this.onUnload);
    }
  }

  markDirty(): void {
    this.dirty = true;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => { this.timer = null; void this.save(); }, this.throttleMs);
  }

  /** Force an immediate save if dirty and not scrubbed. */
  async flush(): Promise<void> {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    await this.save();
  }

  private async save(): Promise<void> {
    if (!this.dirty) return;
    if (this.timeline.isScrubbed) return;        // never persist a scrubbed past as "current"
    if (!this.state.world || !this.state.map) return;
    this.dirty = false;
    await this.write(toSaveFile(this.state, this.now()));
  }

  destroy(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    this.unsubscribe?.(); this.unsubscribe = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
      window.removeEventListener('beforeunload', this.onUnload);
    }
  }
}
```

Note: the scrubbed-gate test leaves `dirty` true (so a later live save still fires) — `save()` returns before clearing `dirty` when scrubbed. Verify the test passes with this ordering.

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

---

### Task 5: Resume branch in `bootstrapWorld`

**Files:**
- Modify: `src/game/bootstrap-world.ts`
- Test: `tests/unit/bootstrap-resume.test.ts`

Add an optional injected `readSave` to `BootstrapDeps` (defaults to the real one) and an `applySave` seam, so the resume branch is unit-testable without IDB. When a valid save loads, skip `generateWithNoise`/`seedWorld`/`instantiateRivals`.

- [ ] **Step 1: Failing test** (resume path uses the injected save; fresh path does not call applySave):

```ts
import { describe, it, expect, vi } from 'vitest';
import { bootstrapWorld } from '@/game/bootstrap-world';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import type { GameMap } from '@/core/types';
import type { SaveFile } from '@/core/save-file';

function miniMap(): GameMap {
  return { width: 1, height: 1, tiles: [['grass']], pois: [], buildings: [] } as unknown as GameMap;
}

function fakeSave(): SaveFile {
  return {
    version: 1, savedAt: 1, worldSeed: { name: 'resumed' } as any, map: miniMap(), biomeMap: null,
    snapshot: { tick: 77, eventId: 0, rng: [1,2,3,4] as any, entities: [], activeEvents: [], spirits: [] },
    events: [], view: { camera: { x:0,y:0,zoom:1,dragging:false,lastX:0,lastY:0 }, selectedNpcId: null, pinnedNpcId: null, followNpc: false, cameraLock: { mode: 'free' }, debug: false, showLabels: true, showPoiMarkers: true },
  };
}

const stubAssets = { loadAll: async () => {} } as any;

describe('bootstrapWorld resume', () => {
  it('applies a valid save and skips world generation', async () => {
    const state = createState();
    const applied: SaveFile[] = [];
    const map = await bootstrapWorld({
      state, assets: stubAssets, sheets: new Map(), decorationImages: { preload: async () => {}, destroy: () => {} } as any,
      getViewport: () => ({ width: 100, height: 100 }),
      readSave: async () => fakeSave(),
      applySave: (s, save) => { applied.push(save); s.map = save.map; s.world = new World(save.map); s.clock.setNow(save.snapshot.tick); return true; },
    });
    expect(applied).toHaveLength(1);
    expect(state.clock.now()).toBe(77);
    expect(map.width).toBe(1);
  });

  it('falls through to fresh generation when no save exists', async () => {
    const state = createState();
    const applied: SaveFile[] = [];
    await bootstrapWorld({
      state, assets: stubAssets, sheets: new Map(), decorationImages: { preload: async () => {}, destroy: () => {} } as any,
      getViewport: () => ({ width: 100, height: 100 }),
      readSave: async () => null,
      applySave: (_s, save) => { applied.push(save); return true; },
    });
    expect(applied).toHaveLength(0);
    expect(state.world).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — in `src/game/bootstrap-world.ts`:
  - Add imports: `import { readSave as readSaveDefault } from '@/services/save-store';` and `import { applySaveFile, type SaveFile } from '@/core/save-file';`.
  - Extend `BootstrapDeps` with:
    ```ts
      readSave?: () => Promise<SaveFile | null>;
      applySave?: (state: GameState, save: SaveFile) => boolean;
    ```
  - At the top of `bootstrapWorld`, before generating, add the resume branch:
    ```ts
      const readSaveFn = deps.readSave ?? readSaveDefault;
      const applySaveFn = deps.applySave ?? applySaveFile;
      const saved = await readSaveFn();
      if (saved && applySaveFn(state, saved)) {
        await assets.loadAll();
        const vp = getViewport();
        // camera came from the save; just recompute decorations + sheets.
        state.generatedDecorations = loadDecorations(state.worldSeed?.name ?? '');
        void decorationImages.preload(state.generatedDecorations.map(d => d.assetId));
        kickOffSheets(state, sheets);
        deps.onReady?.();
        return state.map!;
      }
    ```
    (Place after destructuring `const { state, assets, sheets, decorationImages, getViewport } = deps;`.)
  - Leave the existing fresh-seed path untouched below the branch.

- [ ] **Step 4: Run, expect PASS** for the new test AND the existing suite (`npx vitest run tests/unit/bootstrap-resume.test.ts`). If `assets.loadAll`/decoration preload need more of a stub, match the test stubs above.
- [ ] **Step 5: Commit.**

---

### Task 6: Wire `PersistenceController` + "New World" into `Game`

**Files:**
- Modify: `src/game.ts`
- Modify: `src/game/game-ui.ts` (New-World button) — follow the existing settings/dev button pattern there.

No new unit test (DOM-mount integration is covered indirectly; the controller + save-file logic are unit-tested). Verify via `npm run build` + full suite.

- [ ] **Step 1:** In `src/game.ts`, import:
  ```ts
  import { PersistenceController } from '@/game/persistence-controller';
  import { clearSave } from '@/services/save-store';
  ```
  Add a field: `private persistence!: PersistenceController;`

- [ ] **Step 2:** Construct it right after the `TimelineController` is created (after line ~138), so `this.timeline` exists:
  ```ts
  this.persistence = new PersistenceController({
    state: this.state,
    timeline: this.timeline,
    now: () => Date.now(),
  });
  ```

- [ ] **Step 3:** Start it after the world is ready. In `generateWorld`, inside the `onReady` callback (after `this.dev.updateInspector();`), add:
  ```ts
  this.persistence.start();
  ```

- [ ] **Step 4:** Add a `newWorld()` method on `Game`:
  ```ts
  /** Abandon the current world: clear the autosave and re-bootstrap fresh. */
  async newWorld(): Promise<void> {
    this.persistence?.destroy();
    await clearSave();
    this.stopLoop();
    location.reload();
  }
  ```
  (Reload is the simplest correct reset — it re-runs boot, which now finds no save and seeds fresh.)

- [ ] **Step 5:** In `destroy()`, add `this.persistence?.destroy();` near the other disposers.

- [ ] **Step 6:** In `src/game/game-ui.ts`, add a "New World" button to the settings surface that calls back into `Game.newWorld()`. Thread an `onNewWorld` callback through the `GameUi` options the same way existing callbacks (e.g. `onToggleSettings`) are threaded, and in `game.ts` pass `onNewWorld: () => void this.newWorld()`. Add a `window.confirm('Start a new world? This abandons your current game.')` guard before calling it.

- [ ] **Step 7:** Run full suite + build:
  ```bash
  npx vitest run && npm run build
  ```
  Expected: all tests pass, build clean.

- [ ] **Step 8: Commit.**

---

## Self-Review

- **Spec coverage:** snapshot-not-replay ✓(T3); IndexedDB single slot ✓(T2); SaveFile schema incl. map/biomeMap/events/view ✓(T3); EventLog.hydrate ✓(T1); throttled-on-change + scrub gate + flush ✓(T4); resume branch skipping seed ✓(T5); New-World reset ✓(T6); derived visual/blob maps + decoration reload on resume ✓(T3/T5); NpcAttentionStore not persisted ✓(implicit — never referenced by save-file). Version mismatch → false/discard ✓(T3); New-World clears save ✓(T6).
- **Type consistency:** `SaveFile`/`SaveView` fields identical across T2/T3/T4/T5; `toSaveFile(state, savedAt)`, `applySaveFile(state, save): boolean`, `writeSave(save, slot?)`, `readSave(slot?)`, `clearSave(slot?)`, `EventLog.hydrate(events)`, `PersistenceController({state,timeline,now,throttleMs?,write?})` with `start/markDirty/flush/destroy` — consistent throughout.
- **Discard-on-mismatch wiring:** boot reads, applies; on `false` the fresh path runs, but the stale save remains. Acceptable for v1 (next successful save overwrites it). If desired, T5's branch can `await clearSave()` on mismatch — left out to keep the seam injectable and IDB-free in tests.
