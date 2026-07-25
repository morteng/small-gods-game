# UI v3 — "a proper, real game"

**Status:** SPEC (authoritative for the epic). **Date:** 2026-07-25. **Branch:** `feat/ui-v3`.
**Supersedes/absorbs:** `2026-06-17-legacy-chrome-retirement-design.md` (its L0–L6 slicing becomes
this epic's P6), and the `save-file.ts:105-115` event-journal design note (becomes P3).

The build today boots straight into the world behind a DOM loading overlay. There is no title
screen, no save management, no settings worth the name, no controls configuration, and two UI
systems still ship side by side. This epic closes all of that.

---

## 1. Locked decisions (user; not up for relitigation)

1. **Instant title, generation on demand.** The title screen is on screen within ~1–2 s of page
   load, over an animated WebGPU backdrop (sky / cloud / godray — a cheap procedural shader, NOT a
   live world). Worldgen or save-loading begins only when the player picks something. The DOM
   loading screen (`src/ui/loading-screen.ts`) is deleted; boot progress + the rotating chronicle
   become a WebGPU screen.
2. **The art-settle rule is preserved exactly.** The loading screen holds until the world is fully
   displayed. `waitForArtSettled`'s `maxWaitMs` stays `Infinity` by default. Never grey boxes, no
   wall-clock caps.
3. **Legacy chrome retirement finishes** — L1 tooltip, L2 npc+building info, L3 rival panel,
   L4 narration card + placement modal, L5 minimap (**deleted, not ported** — D4 of the retirement
   doc ruled "no WebGPU minimap; FIT + world labels replace it"), then L6 deletes `Game.barebones`,
   `FrameRenderer.legacyChrome`, `GameUi.suppressLegacyChrome()` and `?legacyui` in ONE commit.
4. **Full save workstream** — manual save, 3 named slots + autosave, slot metadata, save/load
   screens, honest stale-version messaging, and the unbounded-`events` fix (append-only IDB journal).
5. **All extras in scope** — rebindable keys, gamepad, photo mode, "copy world code" seed share,
   first-run tutorial toasts through the tidings system.

## 2. Binding principles (inherited)

- **Everything agent-driven.** New screens are declarative spec data rendered by the ONE WebGPU
  ui-runtime. No bespoke panels. No new DOM except sanctioned islands for *text input only*.
- **Every action is a Command** on the capability registry, routed through `GameBus` — so MCP, the
  dev bus and tests can drive the entire menu flow.
- **Parity before deletion**; a DOM surface dies only once its GPU replacement has a CPU-rasteriser
  pixel test.
- WebGPU-only renderer; ASCII-only dynamic text; 1:1 pixel-perfect at integer scales; `src/sim/`
  stays `Math.random`-free and cycle-free; every IDB op races `withIdbTimeout`; `npm run lint` stays
  at zero; version-constant bumps update `tests/unit/content-version.test.ts` in the SAME commit.

---

## 3. Architecture: meta-mode + the screen stack

### 3.1 Two mount modes, one runtime, one loop

`Game` currently does everything in its constructor *except* bring up the GPU device and generate a
world (that is all `generateWorld()`). UI v3 splits `generateWorld()` in half:

```
new Game(container, options)         // synchronous: canvas, state, bus, presentation, hooks
await game.bootShell()               // GPU device + scene + UI runtime + frame loop + TITLE screen
  ↓ (player picks, or autostart)
await game.startWorld({ … })         // engine wasm → art library → flora → worldgen → art-settle
```

`bootShell()` is the new fast path: `selectRenderer(canvas)` (which builds the `GpuScene` and all
its pipelines — measured, must stay well under the 1–2 s budget), `ui.attach(canvas)`, then
`frameLoop.start()`. It does **not** load the art library, prewarm flora, or touch worldgen.

**One frame loop, one branch.** `Game.onRender` branches on `state.map`:

- `state.map == null` → **meta mode**: `renderMeta({ uiGroups, backdrop })` — the sky backdrop pass
  plus the UI pass. No terrain, entities, water, shadows or 2D overlays.
- `state.map != null` → **world mode**: today's `renderMap(ctx, rc)` path, unchanged.

`onFrame` in meta mode advances nothing (no sim, no presentation update beyond the audio pump) and
returns `true` so the backdrop animates.

`selectRenderer` changes shape from `Promise<RenderFn>` to
`Promise<{ render: RenderFn; renderMeta: MetaRenderFn }>`; `buildGpuRenderFrame` returns both. The
`RenderFn` type is unchanged, so `FrameRenderer` and the studio are untouched.

### 3.2 The sky backdrop

New `src/render/gpu/wgsl/sky-backdrop-wgsl.ts` + `createSkyBackdropPipeline` in `gpu-pipelines.ts`,
modelled directly on the existing `ocean-backdrop` pair (full-screen triangle, one globals buffer,
samples the already-baked tiling-noise atlas). Content: a vertical parchment→dusk gradient, two
scrolling FBM cloud bands at different rates, and a soft godray cone whose angle drifts on a long
period. **No backticks in WGSL comments** (they break the build). Budget: one full-screen pass,
no dependent texture reads beyond the shared noise atlas.

### 3.3 The screen stack

New `src/render/ui/shell/` — the game shell. `ui-runtime.ts` is already 2 100 lines; the shell does
NOT go inside it.

```ts
export type ScreenId =
  | 'title' | 'newgame' | 'load' | 'save' | 'settings'
  | 'loading' | 'pause' | 'gameover' | 'photo' | 'controls';

export interface ShellState { stack: ScreenId[] }          // [] = in-game HUD
```

- `shell-state.ts` — pure stack reducer: `push/pop/replace/reset`, plus `topOf(stack)`. No I/O.
- One module per screen, each a **pure** function
  `(c: UiContext, layout: ScreenLayout, view: <ScreenView>, act: (a: ScreenAction) => void) => Rect | null`
  (the optional `Rect` is a DOM-island reservation, exactly like `drawMenu` returns today).
  Node-testable with zero WebGPU, so every screen gets a pixel test.
- `shell-renderer.ts` — dispatches `topOf(stack)` to the right screen module and threads the view
  data in.

`UiRuntime.frame()` gains ONE new branch, ahead of menu/card/story/HUD:

```
if (shell.stack.length) → shell.draw(...)   else → existing menu/card/story/HUD chain
```

`consumesPointer` returns true whenever the stack is non-empty (screens are modal).

**Esc stack in game** (unchanged semantics, now explicit): card → pause → (pause's own sub-screens
pop back to pause). Esc with an empty stack and no card opens `pause`. The pause screen replaces
the current `drawMenu`, which is deleted once `pause` reaches parity.

`ShellView` is assembled per frame by a new `src/game/shell-view.ts` (the same idiom as
`game-query.ts`): slot metadata, settings values, keymap, boot progress, god-fade state. The screen
modules never touch `Game`.

### 3.4 Quit to title: in-process, guarded by a keys-parity test

`Game.newWorld()` today is `clearSave()` + `location.reload()`. A reload is unacceptable for
"quit to title" (it would tear the title screen down to rebuild it). **Decision: in-process reset.**

The risk in an in-process reset is a missed field on `GameState` leaving a stale world half-alive.
The mitigation makes it verifiable rather than hopeful:

```ts
// src/core/state.ts — beside createState()
export function resetState(state: GameState): void { /* reassign EVERY field in place */ }
```

Guard test (`tests/unit/state-reset-parity.test.ts`): dirty a state (world, map, spirits, event log,
cohorts, weather, causal sites, chronicle, fate arcs, camera, selections), call `resetState`, and
assert it is **deep-equal to a fresh `createState()`** — and separately that
`Object.keys(createState())` is exactly the key set `resetState` touches. A field added to
`createState` without a `resetState` line fails the build.

`Game.returnToTitle()` then: stop persistence → flush-or-discard → `frameLoop` keeps running →
`resetState(state)` → `scheduler.reset()` → `timeline.reset()` → `chronicle/fate/attention/
speechBubbles/garnish` reset → clear the sprite/sheet maps → `shell.reset(['title'])`. Sim systems
are re-registered by `startWorld()` (they are registered per-world already via
`registerSimSystems`). `location.reload()` survives only as the documented fallback if
`returnToTitle` throws — logged, never silent.

### 3.5 Autostart: dev + embed flows keep working

`GameOptions` gains:

```ts
autostart?: false | { kind: 'fresh'; genSeed?: number; genome?: string; worldSeed?: WorldSeed }
         | { kind: 'resume'; slot?: SaveSlot } | { kind: 'auto' };   // 'auto' = today's behaviour
ephemeral?: boolean;      // was a readonly field bound to ?genome
shell?: boolean;          // false ⇒ never show shell screens (studio/embed harnesses)
```

`main.ts` resolves URL flags to an autostart descriptor: `?genseed` / `?genome` / `?bridge` /
`?studio` / an explicit `?autostart` all skip the title and boot straight in **exactly as today**.
With no dev flags, `autostart` is absent and the title screen is shown.

`ephemeral` stops being derived-from-`?genome` and becomes a parameter (still defaulted from
`?genome`). **Demo World** = the pinned default world (`PINNED_GEN_SEED`) started with
`ephemeral: true`, so it never writes the player's autosave slot.

### 3.6 Meta capability verbs

Every shell action is a registry verb at `tier: 'meta'`, `targetKind: 'none'`, no `apply` (exactly
like `set_time_rate`), intercepted in `Game.handleMetaCommand` and never enqueued:

| verb | params |
|---|---|
| `new_game` | `genSeed?`, `genome?`, `demo?` |
| `load_slot` | `slot` |
| `save_slot` | `slot`, `name?` |
| `delete_slot` | `slot` |
| `rename_slot` | `slot`, `name` |
| `quit_to_title` | — |
| `open_screen` / `close_screen` | `screen` |
| `set_setting` | `key`, `value` |
| `rebind_key` | `action`, `code` |
| `capture_photo` | — |
| `copy_world_code` | — |

Meta verbs carry `targetKind: 'none'`, so hover-affordance ranking (which keys on target kind) is
untouched — but the affordance-ranking pins are re-run before P2 lands, per the standing gotcha.

### 3.6a A world is ENTERED RUNNING (decided, not incidental)

Time is 1:1 with real time and the sim *is* the game, so a world that opens frozen reads as broken.
That was the behaviour before the shell existed — but only *incidentally*: nothing had touched the
rate yet on a cold boot.

Once a session can pass through a title screen, a demo world and a quit-to-title **without
reloading**, plenty of things legitimately zero the rate along the way: the pause menu stashes and
zeroes it, a modal card zeroes it, a hard pause zeroes it. A live GPU pass caught the consequence — a
freshly generated world opened showing "▶ RESUME" (2026-07-25).

**Decision:** world entry states the rate outright (`Game.enterWorldRunning()`, called from
`onWorldReady`): clear any hard pause, reset the three stashed-rate fields, set
`WORLD_ENTRY_RATE = 1`. It also **logs when it had to correct a non-default rate**, so an upstream
leak stays visible rather than being silently papered over. Correspondingly, `returnToTitle()`
deliberately leaves the rate at 0 — there is no world to advance while the title is up, and entry
owns the rate.

### 3.7 External agent control — this is a PRODUCT surface, not internal plumbing

**Scope note (user direction, 2026-07-25):** the bus/MCP seam is graduating from dev-only tooling to
a shipped feature. A player will connect *their own* agent (e.g. Claude over MCP, billed to their own
subscription rather than an API key) to a running game and drive everything through it — resuming an
existing save or starting a brand-new world. **The meta verbs defined above are the first slice of
that product surface.** They must therefore be designed as a stable, documented, external-facing API
rather than as glue behind some buttons.

What that obliges, all of it already inside this epic's scope:

1. **Stable + fully parameterized.** `new_game` takes `genSeed`, `genome` and `demo`/`ephemeral`, so
   an agent can start *any* world from scratch without a URL flag. Verb names and parameter names are
   treated as API: renaming one later is a breaking change, so they get named right now.
2. **Discoverable.** The existing `capabilities` query must enumerate the meta tier alongside the
   divine/authoring/editor tiers, with a usable `describe()` for each — that is what an agent reads
   to learn the menu exists. Every meta verb's `describe()` must degrade on absent params rather than
   throw (guarded in `tests/unit/command-registry.test.ts`).
3. **Drivable with no world loaded.** The meta-mode runtime (§3.1) must service **bus** commands, not
   only local clicks: an agent connected to a tab sitting on the title screen can emit `new_game` or
   `load_slot` and have it work. This is the one genuinely new constraint on §3.1 — the meta frame
   loop keeps the bus attached and `handleMetaCommand` reachable while `state.map` is null.
4. **Screen state is queryable.** A headless agent must be able to navigate menus *without
   screenshots*, so the shell exposes its state through the same read-only query seam as everything
   else: which screen is up, and what choices it offers (`id`, `label`, `enabled`, and the note/reason
   — including *why* CONTINUE is refused). `Shell.describe()` is that surface; `game-query` re-exports
   it so MCP and the dev CLI read it like any other query.
5. **Write gating unchanged.** Everything mutating stays behind `?bridge=rw`; a read-only bridge can
   observe the shell and enumerate choices but not start, load, delete or save a world.

**Explicitly OUT of scope here** (a later epic, do not build): promoting the Fate staging tools to
registry verbs, the narration/prose seam for agent-authored text, and any shipped transport /
connection UX for player-supplied agents. This epic only makes the meta verbs bus-drivable and
documented.

---

## 4. UI kit + design tokens

**Aesthetic direction: illuminated manuscript / devotional.** Parchment grounds, ink linework, ONE
gold accent reserved for interactive-and-divine, restrained motion (short fades in the existing
150 ms `LABEL_FADE_MS` language). Integer pixel scales throughout; nothing fractional.

- `src/render/ui/ui-tokens.ts` — the single source: colour ramp (oklch, built on `ui-palette.ts`,
  which stays and is re-exported), spacing scale, stroke weights, type scale (`FS_*` move here),
  motion durations. No module hardcodes a colour after this lands.
- `src/render/ui/kit/` — composite widgets, all pure over `UiContext`: `toggle`, `slider`, `tabbar`,
  `modal` (frame + dim + backdrop-click), `list` (focusable rows), `slot-tile` (save-slot card with
  thumbnail + metadata), `key-chip` (a key-prompt glyph chip), `island-frame` (generalises the
  reserved-rect pattern the settings/whisper islands use).
- **Focus/navigation model** on `UiContext`: widgets call `focusable(id)`; the context keeps an
  ordered focus ring per *screen key* and a `focusId`. `UiRuntime` maps arrow keys / Tab / Enter /
  Esc onto `focusNext/focusPrev/activate/cancel`. Gamepad maps onto the identical calls, so gamepad
  navigation is not a second implementation. Pointer hover sets `focusId` too, so the two never
  disagree.

### 4.1 Pixel font

Add real 5×7 glyphs for everything currently rendering blank: `⚡ ✉ ◎ 🔒 ⏸ ▶ ✦` and the four curly
quotes `‘ ’ “ ”`. `RENDERABLE_GLYPHS` in `ui-runtime.ts` grows to match, and
`tests/unit/ui-pixel-font.test.ts` gains an assertion that **every literal glyph used by the shell
and HUD is in the table** (a scan of the label constants, so a future blank glyph fails the build).

Title wordmark: a `bold` option on `BuiltinPixelFont.layout` (each lit pixel drawn twice, +1 px x)
combined with a large integer scale — no second font, no atlas. ASCII-only law still governs all
*dynamic* text.

---

## 5. Save workstream (P3)

### 5.1 Slots and metadata

`SaveSlot = 'autosave' | 'slot1' | 'slot2' | 'slot3'`. `save-store.ts` is already fully
slot-parameterised, so no schema change is needed for the slots themselves.

The problem with listing slots is that a `SaveFile` is a ~171 k-tile blob — reading four of them to
draw a menu is unacceptable. So metadata lives in its own store in the SAME database:

```ts
// store 'save-meta', keyPath 'slot'
interface SaveMeta {
  slot: SaveSlot; version: number; contentVersion: number;
  savedAt: number; name: string;
  tick: number; dateLabel: string;          // in-world date, prebuilt (never a raw tick in the UI)
  godTier: string; beliefMass: number;
  playtimeMs: number;                        // real playtime
  thumbnail: string | null;                  // 320×180 JPEG data URL
  eventCursor: number;                       // journal high-water mark (§5.3)
}
```

`writeSave` writes the blob **and** its meta row in ONE IndexedDB transaction across both stores
(atomic: a save is never listed without its blob, or vice versa). `probeSlots()` reads only
`save-meta` — four small rows.

`playtimeMs` accrues in `Game.onFrame` (real ms, only while live) and rides `SaveFile` top-level,
not the snapshot: it is meta state, outside the deterministic stream.
Thumbnails come from the existing `captureFrame()` seam, downscaled.

### 5.2 Honest staleness

`probeSlots()` returns a verdict per slot, computed from the meta row alone:

```
'ok' | 'stale-save' (version !== SAVE_VERSION) | 'stale-world' (contentVersion !== WORLD_CONTENT_VERSION)
```

The load screen **shows** it — "Saved under an older world (content 117; this build is 118). It
cannot be opened." — with Delete offered. A stale save is never silently regenerated over, and the
autosave slot's staleness is surfaced on the title screen's CONTINUE row (disabled + reason)
instead of Continue quietly producing a brand-new world.

### 5.3 The event journal (fixes the unbounded `events` array)

Today `SaveFile.events` is the entire log from tick 0 — O(total history) per autosave, on a world
where a real day is a real day. Per the design note at `save-file.ts:105-115`:

- New store `'event-journal'`, keyPath `['slot','from']`: rows `{ slot, from, to, events }`.
- `SaveFile.events` is **removed**; `SaveFile.eventCursor: number` replaces it.
- `PersistenceController` appends only `eventLog.since(cursor)` per save, in the same transaction as
  the blob + meta, then advances the cursor.
- Load: `readJournal(slot, upTo)` concatenates rows in `from` order → `eventLog.hydrate(...)`.
- **Compaction:** when a slot's row count exceeds `JOURNAL_COMPACT_ROWS` (64), the next write
  rewrites the slot's rows into a single row. `clearSave(slot)` deletes the slot's journal rows and
  meta row.
- Every op races `withIdbTimeout`; a journal read failure degrades to "no history" (the world still
  loads, the annals strip is short) rather than failing the load.

**`SAVE_VERSION` 3 → 4** (`events` removed, `eventCursor`/`playtimeMs` added). Same commit updates
`tests/unit/content-version.test.ts`, and fixes the **stale `SAVE_VERSION 2` line in CLAUDE.md**.

### 5.4 Screens

- **Save screen** — 4 slot tiles; picking one emits `save_slot`. Naming uses a DOM text-input island
  (sanctioned).
- **Load screen** — same tiles, `load_slot`; stale slots disabled with their reason; Delete per row.
- Manual save is also a pause-screen row and a keybound action.

---

## 6. Settings v2 + unified persistence (P4)

One WebGPU tabbed screen (`tabbar` from the kit):

| tab | contents |
|---|---|
| Audio | music on/off + volume, SFX on/off + volume (own bus), voice toggle |
| Video | half-res water, UI scale, lighting |
| Gameplay | LLM provider/model/key (the existing `SettingsIsland`), live art toggles |
| Controls | the keymap view + rebinding (§7) |

**One persistence module**, `src/services/settings-store.ts`, consolidating the seven scattered
localStorage keys (`small-gods-llm-provider`, the PixelLab key, LLM spend, tutorial-seen, dock
layout, `small-gods-music`, `small-gods-voice`) behind a single typed `settings` object under one
key, **migrating the old keys on first read** (read-old → write-new → delete-old, once).

### 6.1 Audio completion

- `src/presentation/audio-buses.ts`: master → { music, sfx } gain. `tinysynth-backend` grows
  `setMusicVolume` / `setSfxVolume`. **The builder must verify empirically** whether the tinysynth
  instance exposes an output `AudioNode` that can be split into two GainNodes; if it does not, the
  SFX bus is implemented as per-channel MIDI CC7 on the reserved SFX channels 6–8 and that choice is
  documented in the module header with the reason. Either way the two are independently mutable.
- Volumes persist through `settings-store`.
- Subtle synth UI tick/confirm cues through the existing backend, respecting the autoplay
  gesture-gate — **the title screen's first click IS the gesture** (`armGesture()` moves to
  `bootShell`).
- One authored title cue in `cues/base-cues.ts` style. **No LLM/API spend.**

---

## 7. Controls (P5)

- `src/game/input/keymap.ts` — `Action` union, `DEFAULT_KEYMAP: Record<Action, string[]>` keyed by
  `KeyboardEvent.code`, `resolveAction(code, map)`, `promptFor(action, map)`. It drives **both**
  dispatch and the key-prompt chips, so a rebound key relabels itself everywhere for free.
- `controls.ts` + `attachTimeKeys` stop hardcoding letters and route through `resolveAction`.
  The two-layer pointer routing (UI capture-first, stopPropagation **and** preventDefault) is
  untouched — that contract is load-bearing (D3).
- Rebinding UI: Controls tab rows; "press a key" capture state; conflict detection; reset-to-default.
- **Gamepad** (`src/game/input/gamepad.ts`): polled once per frame from the frame loop (no listener
  soup). Buttons → the same `Action` set; left stick → camera pan; triggers/shoulders → zoom;
  A = `activate`, B = `cancel`, dpad → `focusNext/Prev`. Menu navigation therefore reuses §4's focus
  ring verbatim. Deadzone + repeat-rate constants sized in REAL ms.
- **Game-over / fade screen:** when the player god crosses into `fading` (`src/sim/god-tier.ts`), the
  shell pushes `gameover`. It is a canon moment, not a failure box: the sim keeps running behind it
  (the world outlives its god), and the choices are *keep watching* (pop the screen, whisper-only) or
  *begin again* (`new_game`).
- **Photo mode:** `capture_photo` / a keybound action pushes `photo` — chrome-free (the shell draws
  nothing but a thin hint that fades), then writes a PNG. Paired with **copy world code**: a short
  base36 encoding of `{ genSeed, worldSeed.name, contentVersion }`, copyable from the pause screen
  and pasteable into New Game via a text island.
- **Tutorial toasts:** first-run guidance is seeded as `tiding`-kind inbox items through the
  existing tidings system, gated on a `firstRunSeen` setting. `src/ui/tutorial.ts` (382 lines) dies
  with the L-cleanup.

---

## 8. Phasing (each phase ends in a green commit: `tsc --noEmit` + `lint` 0 + targeted tests; full `npm test` at phase boundaries)

| phase | content |
|---|---|
| **P1** | Foundations: tokens, kit, focus model, font glyphs, meta-mode render path + sky backdrop, screen stack, **WebGPU loading screen replacing the DOM loader** (delete `loading-screen.ts` + its DOM tests; equivalent unit tests on the new screen) |
| **P2** | Title + boot restructure: `bootShell`/`startWorld`, instant title, gen-on-demand, autostart descriptors, demo world, `returnToTitle` + `resetState` parity guard |
| **P3** | Save: slots, meta store, probe, manual save, save/load screens, event journal, `SAVE_VERSION` 4 |
| **P4** | Settings v2 + `settings-store` migration + audio (SFX bus, volumes, UI ticks, title cue) |
| **P5** | Controls: keymap, rebinding, gamepad, Esc stack, game-over screen, photo mode + world code, tutorial toasts |
| **P6** | Legacy retirement L1→L5 (parity + a pixel test per surface), then L6 flag teardown in ONE commit |
| **P7** | Docs (CLAUDE.md UI/boot sections, ROADMAP entry, kill the stale "SAVE_VERSION 2" line), full `npm test`, server CI, push `feat/ui-v3` |

## 9. Verification

"Verify numeric/geometry claims empirically — a render catches what assertions don't."

- Every new screen module is pure over `UiContext` → a CPU-rasteriser pixel test in the
  `tests/unit/ui-runtime.test.ts` / `ui-context.test.ts` idiom, asserting real geometry (rect
  positions, hit regions, glyph coverage), not just "it didn't throw".
- The retirement doc's rule stands: **no DOM twin is deleted before its GPU replacement has that
  test.**
- `resetState` parity, keymap round-trip, journal append→read→compact round-trip, slot-probe
  verdicts, and glyph coverage all get dedicated guard tests.
- Boot budget is measured, not assumed: `bootShell` timing recorded via the existing
  `bootMark`/`__perf.boot()` seam.

## 10. Deletions this epic makes (tracked, reported at the end)

`src/ui/loading-screen.ts`, `boot-progress.ts` (folded into the WebGPU screen), `npc-tooltip.ts`,
`npc-attention-panel.ts`, `building-info-panel.ts`, `rival-panel.ts`, `llm-display.ts`,
`decoration-placement-modal.ts`, `minimap-panel.ts`, `tutorial.ts`, `settings-unified.ts`,
`llm-settings-new.ts`, `model-picker.ts`, `spirit-hud.ts`, `welcome-modal.ts`, `chrome.ts`
power-pill sites in `render/hud.ts`, plus `Game.barebones`, `FrameRenderer.legacyChrome`,
`GameUi.suppressLegacyChrome()` and `?legacyui`.
