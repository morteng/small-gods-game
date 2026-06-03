# Game Persistence — "Resume Where You Left Off" Design

**Date:** 2026-06-04
**Status:** Approved (brainstorm) — ready for implementation plan
**Track:** Standalone sub-project (flagged by the user during the NPC Attention Surface epic)

## Problem

Nothing of the live game persists across page loads. Only localStorage *preferences* survive
(LLM provider config, dev-panel layout, render mode). The live world, sim state, spirits,
belief, clock, event history, and timeline are rebuilt from the seed template on every boot
(`bootstrapWorld` → `WorldManager.loadDefault` → `seedWorld`). The user asked: *"are we storing
everything we do so next time game loads we start where we left off? perhaps game management
(load, at least?)."* The answer is no — this spec fixes that.

## Goal

A single, automatic save slot that silently resumes the exact world (including camera and
selection) on the next page load, plus a way to abandon it and start a fresh world.

## The architectural fork (resolved)

Two ways to persist a deterministic sim:

1. **Deterministic replay** — store the seed + a command log, replay from scratch on load.
2. **Full-state snapshot** — serialize the actual current world and restore it verbatim.

**We use full-state snapshot.** Replay is impossible here: whispers and LLM writebacks mutate
belief *directly into entities* (`applyWhisperBonus`, mind/answer-prayer effects), and those
mutations are **not** reproducible from a seed. `captureSnapshot` records the *result* state
regardless of how it arose, so it captures LLM-driven belief correctly. The snapshot machinery
already exists and is exercised by time-scrubbing (`captureSnapshot`/`restoreSnapshot` in
`src/core/snapshot.ts`) — persistence reuses it rather than inventing a parallel serializer.

## Save model (v1)

- **Single autosave slot.** No named slots, no save menu. (YAGNI for v1; the storage layer is
  keyed so multi-slot is a later addition, not a rewrite.)
- **Throttled-on-change autosave.** Save shortly after meaningful state changes, coalesced to at
  most one write every few seconds, plus a final flush on tab close. Near-zero loss without
  wasting writes during idle.
- **Resume on boot.** If a valid save exists, rehydrate it instead of seeding a fresh world.
- **"New World" button.** Clears the autosave and re-bootstraps a fresh world (the only way to
  abandon a run, since there is no "load a different save" flow). Button, not a shortcut
  (per the project's buttons-over-keys UX direction).

## Storage backend

**IndexedDB**, via a new `src/services/save-store.ts`. Rationale:

- A long-running game's `entities[]` (deep `properties`) + unbounded `events[]` can exceed
  localStorage's ~5 MB synchronous quota.
- The project already uses IndexedDB elsewhere (`services/pixellab.ts`, `services/decoration-store.ts`),
  with `fake-indexeddb` in tests — established pattern, no new dependency.
- Async writes keep large saves off the main-thread critical path.

One object store, key `'autosave'`. The store value is the `SaveFile` object (structured-clone
serializable — no functions, no class instances beyond plain data).

## Save file schema

```ts
// src/core/save-file.ts
export const SAVE_VERSION = 1;

export interface SaveFile {
  version: number;            // SAVE_VERSION at write time; mismatch → discard, fresh start
  savedAt: number;            // wall-clock ms, PASSED IN by the caller (sim stays Date.now-free)
  worldSeed: WorldSeed;       // small; needed for decoration reload + future regen
  map: GameMap;               // STORED, not regenerated — see note below
  biomeMap: BiomeMap | null;  // produced by generateWithNoise; not derivable from map alone
  snapshot: Snapshot;         // REUSED as-is: { tick, eventId, rng, entities, activeEvents, spirits }
  events: AppendedEvent[];    // full canonical event log (time-history strip depends on it)
  view: SaveView;             // resume camera + selection + display flags
}

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
```

**Why store the map instead of regenerating from seed:** `bootstrapWorld` currently generates the
map with `seed = Date.now()` and throws the seed away. Even if we captured it, regeneration
couples save compatibility to generator *code* stability — a future change to `generateWithNoise`
would produce a different map for an old save while the saved entities keep their old coordinates,
desyncing NPCs from terrain. Storing the map is larger but robust. (The map is the same
`GameMap` object already held in memory; IndexedDB handles its size fine.)

**Derived on load, NOT stored:**

- `visualMap` ← `Autotiler.computeVisualMap(map)`
- `blobMap` ← `computeBlobMap(map.tiles, map.width, map.height)`
- `generatedDecorations` ← `loadDecorations(worldSeed.name)` (already done in bootstrap)

**Deliberately NOT persisted — `NpcAttentionStore`** (soft LLM mind-pages + whisper transcripts).
It is already never-snapshotted and wiped on scrub; it regenerates on NPC focus. After a reload an
NPC's *mind page* re-reads fresh, but their *belief* (the durable sim part) is fully restored. This
is consistent with the existing "deterministic floor + soft narration" policy.

## Serialize / deserialize

```ts
// src/core/save-file.ts
export function toSaveFile(state: GameState, savedAt: number): SaveFile;
export function applySaveFile(state: GameState, save: SaveFile): boolean; // false if version mismatch
```

- `toSaveFile` calls `captureSnapshot(state)` for the world half, then attaches `map`, `biomeMap`,
  `worldSeed`, the serialized `events`, and the `view`. It throws if `state.world`/`state.map` is
  null (same precondition as `captureSnapshot`).
- `applySaveFile` checks `save.version === SAVE_VERSION` (else returns `false` — caller discards and
  boots fresh). On match it sets `state.map`/`worldSeed`/`biomeMap`, derives `visualMap`/`blobMap`,
  calls `restoreSnapshot(state, save.snapshot)`, `state.eventLog.hydrate(save.events)`, and applies
  the `view`. Returns `true`.

### New method on EventLog

```ts
// src/core/events.ts — EventLog
hydrate(events: AppendedEvent[]): void {
  this.events = events.slice();
  this.nextId = events.reduce((m, e) => (e.id > m ? e.id : m), 0) + 1;
}
```

Restores the event array and keeps `nextId` ahead of every restored id so future appends never
collide. (Subscribers are not replayed — hydrate is a silent bulk load, matching how
`restoreSnapshot` mutates state without re-emitting.)

## save-store (IndexedDB)

```ts
// src/services/save-store.ts
export async function writeSave(save: SaveFile, slot?: string): Promise<void>;
export async function readSave(slot?: string): Promise<SaveFile | null>; // null if absent
export async function clearSave(slot?: string): Promise<void>;
```

`slot` defaults to `'autosave'`. Mirrors `decoration-store.ts`: open DB (name
`small-gods-saves`, store `saves`), promisified request wrappers, graceful `null`/no-op on
`indexedDB` being unavailable (SSR/headless guard). No migration logic — version mismatch is
handled one level up by `applySaveFile` returning `false`.

## PersistenceController

```ts
// src/game/persistence-controller.ts
export interface PersistenceDeps {
  state: GameState;
  timeline: TimelineController;     // to gate on isScrubbed
  now: () => number;                // wall clock (injected; tests pass a stub)
  throttleMs?: number;              // default 3000
}
export class PersistenceController {
  start(): void;   // subscribe to eventLog + attach visibilitychange/beforeunload
  flush(): Promise<void>;  // force an immediate save (used on unload)
  destroy(): void; // unsubscribe + detach listeners + clear pending timer
}
```

Behavior:

- On `eventLog` append (and on a coarse timer fallback), mark **dirty** and schedule a throttled
  save. Coalesce: at most one `writeSave` per `throttleMs`.
- **Gate every save on `!timeline.isScrubbed`.** While scrubbed the live world has been replaced by
  a past snapshot; persisting it would overwrite "current" with the past. When the user returns to
  live or commits, the next change re-arms the save. (The eventLog still mutates during
  commit/scrub, so the gate is the guard, not the subscription.)
- `flush()` on `visibilitychange` (→ `hidden`) and `beforeunload`: if dirty and not scrubbed, write
  synchronously-as-possible (fire the async write; browsers honor in-flight IDB on hidden far more
  reliably than on unload, hence visibilitychange is the primary trigger).
- `destroy()` removes listeners and cancels the pending timer.

## Boot integration

In `bootstrapWorld` (`src/game/bootstrap-world.ts`):

1. `const save = await readSave();` runs **first**, before any map generation (so a resume never
   pays for a discarded `generateWithNoise`). Then branch:
   - **save present & valid:** set `state.map/world/biomeMap` etc. from the save via `applySaveFile`,
     derive `visualMap`/`blobMap`, load decorations, center camera from `save.view.camera`, skip
     `seedWorld` + `instantiateRivals` (the saved world already has them). Still run
     `kickOffSheets` (LPC sprite sheets are render-only, not persisted) and decoration preload.
   - **no/invalid save:** the existing fresh-seed path unchanged.
2. The `Game` constructs the `PersistenceController` after the timeline exists and calls `start()`.
3. A **"New World"** button (in the settings/dev surface, alongside existing controls): confirm →
   `clearSave()` → re-run bootstrap fresh (or reload). Wired through `game-ui.ts`.

Because `applySaveFile` needs `state.map` for `restoreSnapshot`'s `new World(state.map)` and for
deriving visual/blob maps, the boot path sets `state.map = save.map` **before** calling
`restoreSnapshot`.

## Error handling

- **Corrupt/unreadable save:** `readSave` resolves `null` on any IDB error (logged); boot falls
  through to fresh seed. Never throw into the boot path.
- **Version mismatch:** `applySaveFile` returns `false`; caller `clearSave()`s the stale save and
  boots fresh. (Acceptable for an in-development game — saves are not yet a stable contract.)
- **IndexedDB unavailable:** all save-store functions degrade to no-op/`null`; the game runs
  exactly as today (no persistence), no crash.

## Interaction with existing systems

- **Time-skip (`commitSkip`):** rebaselines snapshots and advances the clock; it is just another
  meaningful change → the next throttled autosave captures the post-skip world. No special-casing.
- **Timeline commit/reroll:** truncates the event log + snapshots; gated saves resume after the
  user is back on the live timeline.
- **AuthorCommandLog:** not separately persisted — its *effects* are already baked into entities,
  which the snapshot captures. (Replay parity of the author log is a scrub concern, not a
  cross-session one.)

## Testing

- `save-store.test.ts` (fake-indexeddb): write→read round-trip, `clearSave`, absent slot → `null`,
  IDB-unavailable → no-op/`null`.
- `save-file.test.ts`: `toSaveFile` shape (includes snapshot/map/events/view); `applySaveFile`
  restores tick/entities/spirits/eventLog and returns `true`; version mismatch returns `false`
  and leaves state untouched; round-trip `apply(toSaveFile(state))` yields an equal world (tick,
  entity count, spirit belief, event count, camera).
- `events.test.ts` (extend): `hydrate` restores events and `nextId` so the next `append` gets a
  fresh id; `since(0)` returns the hydrated events.
- `persistence-controller.test.ts`: dirty→throttled single write within window; **no write while
  `timeline.isScrubbed`**; `flush()` writes immediately when dirty; `destroy()` stops further
  writes. Uses a stub save-store (inject the writer) + stub `now`.
- Boot integration (light): a unit around the resume branch — given a stubbed `readSave`
  returning a valid save, bootstrap applies it and does not call `seedWorld`. (May assert via a
  seam/flag rather than a full DOM mount.)

## Files

| File | Responsibility |
|------|----------------|
| `src/core/save-file.ts` (new) | `SaveFile`/`SaveView` types, `SAVE_VERSION`, `toSaveFile`, `applySaveFile` |
| `src/services/save-store.ts` (new) | IndexedDB `writeSave`/`readSave`/`clearSave` |
| `src/game/persistence-controller.ts` (new) | throttled autosave + unload flush + scrub gating |
| `src/core/events.ts` (modify) | add `EventLog.hydrate(events)` |
| `src/game/bootstrap-world.ts` (modify) | resume-from-save branch in boot |
| `src/game.ts` (modify) | construct + `start()` the PersistenceController; expose New-World |
| `src/game/game-ui.ts` (modify) | "New World" button wiring |

## Out of scope (future)

- Named/multiple save slots + a save-management menu.
- Persisting `NpcAttentionStore` soft content (mind pages survive a reload).
- Save migration across `SAVE_VERSION` bumps (currently: discard + fresh start).
- Regenerating the map from a stored seed to shrink save size.
- Export/import a save to a file.
