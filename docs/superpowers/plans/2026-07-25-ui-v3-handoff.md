# UI v3 — handoff (remaining slices)

**Branch:** `feat/ui-v3`. **Spec:** [`docs/superpowers/specs/2026-07-25-ui-v3-complete-game-design.md`](../specs/2026-07-25-ui-v3-complete-game-design.md) — read §3 and §3.7 before touching anything.
**Written:** 2026-07-25, at a green phase boundary. Every slice below is briefed to be
picked up cold.

## What has landed

| commit | phase |
|---|---|
| `3dc3a9c6` | the spec |
| `aad4c604` | **P1** foundations — meta-mode render path + sky backdrop, screen stack, WebGPU loading screen, UI kit + tokens + focus model, 87-glyph pixel font, 12 meta capability verbs, `resetState` + parity guard |
| `8850e1a3` | **P2** boot restructure — `bootShell()`/`startWorld()`, instant title, generation on demand, autostart resolution, in-process `returnToTitle()`, agent-drivable meta commands |
| `889a707d` | **P3a** save services — slots, `save-meta` store, append-only event journal, `SAVE_VERSION` 4, journal wired into the resume path |
| `717d9535` | docs — CLAUDE.md shell/boot section, ROADMAP entry, stale `SAVE_VERSION 2` line retired |
| `4aade89e` | **P4a** audio + persistence services — independent SFX bus (CC7; see the finding in `audio-buses.ts`), UI tick/confirm cues, a hand-authored title cue, and `settings-store.ts` consolidating seven localStorage keys with migration |

**Not yet done:** P3b (save/load screens), P4b (settings screen), P5 (controls/gamepad/game-over/
photo), P6 (legacy retirement L1–L6), P7 (final CI + push of later work). Two loose ends worth
knowing:

- **`TITLE_CUE` is authored but not played.** It is deliberately NOT in `BASE_CUES`/`CueLibrary`
  (that would break the "calm baseline = silence" contract). Wiring it means having the shell ask
  the presentation director for cue id `bed_title` while the `title` screen is up.
- **`Game.captureThumbnail()` and `saveMetaInput()` exist and are wired into the autosave**, so
  slots already carry real metadata; P3b only has to render it.

**The load-bearing facts a successor needs:**

1. **`Shell` is the screen stack** (`src/render/ui/shell/`). `shell-state.ts` is a pure reducer;
   each screen is a pure `(c: UiContext, w, h, s, view) => action` module; `shell.ts` is the only
   stateful glue. `UiRuntime.frame()` has ONE new branch (the first arm of the existing
   menu/card/story/HUD chain) so a screen inherits all hit/scroll/island bookkeeping.
2. **Adding a screen = one `case` in `Shell.draw` + one pure module + one entry in
   `Shell.describe()`.** Never a branch inside another screen.
3. **`Shell.describe()` is the external-agent surface** (spec §3.7). Its `choices` MUST be derived
   from the same function the renderer walks (see how `titleRows` is shared) — a test pins that
   described ids equal drawn hit-region ids, so an agent can never be told about a button that is
   not there.
4. **Every shell action is a meta Command through the bus**, never a direct method call. That is
   what makes a player's click and an agent's `emit_command` the same code path.
5. **The art-settle rule is inviolable**: `waitForArtSettled`'s `maxWaitMs` stays `Infinity`. Never
   add a wall-clock cap to the loading screen.
6. **`resetState` has a keys-parity guard.** Adding a `GameState` field fails
   `tests/unit/state-reset-parity.test.ts` with instructions; obey them.

---

## P3b — SHIPPED (`d85ad391`)

Save + load screens (`src/render/ui/shell/{save,load}-screen.ts`), wired through the shell and the
`save_slot`/`load_slot`/`delete_slot` meta verbs. `load_slot { slot }` resumes the slot it is asked
for (threaded to `bootstrapWorld`'s injectable `readSave`/`readJournal` via `BootSequenceDeps.slot`);
the journal cursor follows the loaded slot. The interim `SlotSummary`/`describeSave()` are gone — one
`probeSlots()` read of meta rows feeds the title CONTINUE row and both screens.

**Still open from this slice:**
- **Slot NAMING** — deliberately not built. No DOM text-input island is wired and no rect is
  reserved. An unnamed manual save keeps the slot's existing name across a re-save, else takes a
  slot-derived default ("Slot 1"). Wiring it: reserve a rect, return it as `ShellDrawResult.island`
  (the contract `drawMenu`/`renderUiSpec` already use), and generalise `kit/island-frame` rather than
  adding a second island class.
- **Slot THUMBNAILS are captured and stored but not drawn.** `kit/slot-tile` reserves the rect and
  takes a `drawThumb(rect)` callback; nothing passes one yet, because decoding a JPEG data URL into
  something the WebGPU UI can sample needs a texture path the kit does not have. `Game.captureThumbnail()`
  already produces them, so this is a render-side slice, not a data one.

## P3b (original brief, kept for reference)

**Files:** `src/render/ui/shell/save-screen.ts` (new), `load-screen.ts` (new), `Shell.draw`/`describe`,
`Game.handleMetaCommand` (`save_slot`/`delete_slot`/`rename_slot`/`load_slot`).

- Build on `kit/slot-tile.ts` (already exists: name, date line, tier line, playtime line, a
  reserved thumbnail rect + `drawThumb` callback, returns `'activate' | 'delete' | null`).
- Feed them from P3a's `probeSlots()` + `slotCompat()`. **Replace `Game`'s interim `SlotSummary` +
  `describeSave()`** (both in `game.ts`, written only because the meta store did not exist yet)
  with the real per-slot metadata. That is a deletion, not an addition.
- A stale slot renders DISABLED with its reason and offers Delete. Never load-then-regenerate.
- Slot naming uses a DOM text-input island — generalise `kit/island-frame` rather than adding a
  second island class.
- `load_slot` in `handleMetaCommand` currently ignores its `slot` param and takes the ordinary
  resume path; wire it to the real multi-slot reader.
- Tests: a pixel/geometry test per screen; `describe()` enumerating slots with verdicts; a click on
  a stale slot firing nothing.

## Triaged and CLOSED: grey massing on the resume path (2026-07-25)

**Symptom (live pass):** resuming a save rendered a slab-roofed building and a wall run as flat grey
massing, where the same world painted fully on a fresh-gen entry earlier the same day.

**Verdict: known, load-dependent degradation — NOT a resume regression.** Do not re-investigate
without new evidence. What was checked:

1. **Both entry paths run the same hold and the same warms.** `bootstrapWorld` calls `onReady` in the
   resume branch *and* the fresh branch, and `holdLoadingUntilArtSettled` warms the identical four
   things (`parametricBuildingSource`, `generatedBuildingArtSource`, `buildingArtResolver` per
   building; `parametricBarrierSource` per barrier). Flora prewarm happens before either branch.
2. **A wedged sprite cache does NOT cause grey.** `ParametricBuildingSource.warm` explicitly degrades
   `readParametricSprite` failure → compose (`.catch(() => composePath())`), so the persisted cache is
   a pure optimisation. The `generated-art-cache` wedge messages in the console were a red herring for
   *this* symptom.
3. **Save/restore does NOT change art identity** — ruled out empirically by
   `tests/unit/resume-art-identity.test.ts`: across a full `toSaveFile` → `applySaveFile` round-trip,
   every structure keeps its blueprint and hashes to the same sprite key under **both** flavours (the
   order-sensitive in-memory `JSON.stringify(rb)` and the order-insensitive persisted `canonicalJson`).
   Had this failed, every cache/bundle lookup would miss after a resume — that would have been the
   real regression.

**The actual mechanism:** any compose failure — or a worker returning a null payload — does
`cache.set(key, null)`, which is **session-permanent** for that blueprint, so it draws grey until
reload. That is the documented "any failure / unsupported plan caches null → caller draws the flat
fallback" contract. It is load-dependent (worker pool + main-thread churn), which is exactly why the
same world painted on one entry and not another.

**Degraded sources count as SETTLED by design.** `waitForArtSettled` keys on pending counts reaching
zero, and a source that gives up decrements its pending count. That is deliberate — the alternative is
a loading screen that hangs forever on a wedged store, which the no-wall-clock-cap rule would make
unrecoverable.

**Improvement made while triaging:** the two SILENT null paths now warn once per key
(`[parametric-building] compose returned no sprite …` / `… blueprint produced no geometry …`). Only a
*thrown* compose error warned before, so grey massing could appear with zero console evidence. Next
time this is seen live, the console will attribute it.

## P4b — settings SCREEN (P4a services assumed landed)

**Files:** `src/render/ui/shell/settings-screen.ts` (new), `Shell`, `Game.handleMetaCommand`
(`set_setting`).

- Tabs via `kit/tabbar`: Audio (music/SFX on+volume, voice), Video (half-res water, UI scale,
  lighting), Gameplay (the existing `SettingsIsland` for provider/model/key), Controls (P5).
- Every row reads and writes P4a's `settings-store`; every change goes through the `set_setting`
  meta verb so an agent can change settings too.
- **Then retire the DOM twin**: `src/ui/settings-unified.ts` (412 lines), `llm-settings-new.ts`,
  `model-picker.ts`. Parity + pixel test first (retirement doc principle 1).
- Also repoint `ui-runtime.ts`'s local `FS_TITLE`/`FS_BODY` at `ui-tokens.FS` and delete them —
  P1-A deliberately left that duplication, with a comment saying so.

## STATUS as of 40ece8a9 — read this first

**Shipped and LIVE-VERIFIED on real GPU** (five coordinator passes): title, WebGPU loading screen,
save/load screens, settings (all four tabs), the responsive type scale, keymap + rebinding + gamepad.
The rebind capture flow was walked end to end (PRESS A KEY → CANCEL → rebound → RESET TO DEFAULTS).
No open defects.

### Typography rules that are now ENFORCED — obey them in every new screen
- `ui-tokens.shellTypeScaleFor(wDev, s)` gives the four tiers. **Never** reach for `FS.body` in a
  shell screen (that is the in-game HUD's tier); interactive rows use `menu`, metadata uses
  `caption`, and `caption` is a hard floor.
- **Dense content SCROLLS, never shrinks.** A degradation ladder may drop gaps and secondary lines;
  it may not step the font down.
- **Size every computed button box with `c.buttonWidth(label, scale)`** — not a spacing token. The
  widget clips against its own scale-derived padding, and using a different constant outside is what
  produced "REBI…". Same rule for any container that must hold text: derive it from a measure at the
  tier it will be drawn at.
- Guards you must keep passing: `ui-type-scale`, `ui-scale-setting`, `ui-no-truncation` (asserts the
  button-width INVARIANT across four viewports and every tab — assert invariants, not symptoms; a
  fixture that sits on exact equality is false confidence).

### Two hard-won debugging lessons
1. **`| tail` on `ci-on-server.sh` swallows its exit code** — the pipeline reports `tail`'s status.
   Redirect to a file and check `$?`, or a FAILED run looks green.
2. **A guard you have never seen fail is not yet a guard.** Both the shell-stack fix and the
   button-width fix were verified by restoring the broken code and watching the new test fail.

## P5b — NEXT SLICE (not started)

Game-over screen, photo mode, seed share, tutorial toasts. Detail in the P5 section below; the parts
P5a did NOT cover:

- **Game-over / fade screen** — when the player god crosses into `fading` (`src/sim/god-tier.ts`),
  push the `gameover` screen. A canon moment, not a failure box: the sim keeps running behind it (the
  world outlives its god) and the choices are *keep watching* (pop, whisper-only) or *begin again*
  (`new_game`). Wants a live pass.
- **Photo mode** — `capture_photo` verb + the `photo_mode` keymap action already exist; the screen
  does not. Chrome-free capture via the existing `captureFrame()` seam (note: that returns a
  full-resolution PNG data URL — fine for a deliberate photo, unlike a slot thumbnail).
- **Seed share** — `copy_world_code` verb exists and is stubbed. Short base36 of
  `{ genSeed, worldSeed.name, contentVersion }`, copyable from pause, pasteable into New Game via a
  text island.
- **Tutorial toasts** — first-run guidance as `tiding`-kind inbox items gated on
  `settings.firstRunSeen` (the flag already exists in `settings-store`). Retires `src/ui/tutorial.ts`
  (382 lines) as part of P6.

## P5 — controls, gamepad, game-over, photo mode, tutorial toasts

**Files:** `src/game/input/keymap.ts` (new), `gamepad.ts` (new), `src/ui/controls.ts`,
`src/render/ui/shell/{controls-screen,gameover-screen,photo-screen}.ts` (new), `Game`.

- `Action` union + `DEFAULT_KEYMAP` keyed by `KeyboardEvent.code`; `resolveAction`, `promptFor`.
  It drives BOTH dispatch and the `kit/key-chip` prompts, so a rebind relabels itself everywhere.
- `controls.ts` + `attachTimeKeys` stop hardcoding letters. **Do not touch the two-layer pointer
  routing** (UI capture-first, `stopPropagation` AND `preventDefault` together) — that contract is
  load-bearing (the D3 fix; without both, browser-synthesised compat mouse events fall through).
- Gamepad polled once per frame from the frame loop; maps onto the SAME `UiContext` focus ring
  (`focusNext/focusPrev/activate/setFocus`) so menu nav is not implemented twice.
- **KNOWN ISSUE to fix here:** every `hotspot()` currently joins the focus ring, so Tab would cycle
  world labels, speech bubbles and `card.body`. Add a `focusable: false` opt-out to
  `hotspot()`/`ButtonOpts` and use it for non-control hotspots.
- Game-over: when the player god crosses into `fading` (`src/sim/god-tier.ts`), push `gameover`.
  A canon moment, not a failure box — the sim keeps running behind it; choices are keep-watching or
  begin-again. Retire `src/ui/tutorial.ts` (382 lines) in favour of first-run `tiding` inbox items
  gated on `settings.firstRunSeen`.
- Photo mode: chrome-free capture via the existing `captureFrame()` seam. World code = short base36
  of `{genSeed, worldSeed.name, contentVersion}`; `copy_world_code` + a paste island on New Game.

## P6 — legacy chrome retirement L1→L6

Order and rules from the retirement doc (now absorbed into the spec): **parity before deletion, a
CPU-rasteriser pixel test per surface before its DOM twin dies, and all three suppression seams die
in ONE final commit.**

- **L1 tooltip** — cursor-anchored GPU tooltip; delete `src/ui/npc-tooltip.ts` + the `legacyChrome`
  tooltip block in `frame-renderer.ts`.
- **L2 focus panels** — NPC + building info as GPU panels (the inspector v2 is already the NPC
  heir; check what is genuinely missing before porting). Delete `npc-attention-panel.ts` (325),
  `building-info-panel.ts` (85) + their render-site gates.
- **L3 rival panel** — superseded by the pantheon panel; verify parity, then delete
  `rival-panel.ts` (588).
- **L4 narration card + placement modal** — the two richest. Narration should reuse the UiSpec card
  rather than a bespoke renderer. Delete `llm-display.ts` (198),
  `decoration-placement-modal.ts` (306).
- **L5 minimap — DELETE, DO NOT PORT.** D4 ruled "no WebGPU minimap; FIT + world labels replace
  it." Remove `minimap-panel.ts` (294), its M-key, and the `FrameRenderer` minimap update block.
- **L6 one commit** — delete `Game.barebones`, `FrameRenderer.legacyChrome`,
  `GameUi.suppressLegacyChrome()`, `?legacyui`, `drawPowerHud`, `spirit-hud.ts`,
  `welcome-modal.ts` and the orphaned DOM panel classes. `debugHud` may stay DOM under `?dev` —
  call it out, do not silently keep it.
  (`src/ui/loading-screen.ts` is **already gone** — deleted in the P1 follow-up, along with the
  redundant `GameOptions.shell`; the Shell is now unconditionally the one progress surface, pinned
  by `tests/unit/no-dom-loading-screen.test.ts`.)

**Note:** `src/ui/boot-progress.ts` is deliberately KEPT (a deviation from the spec's deletion
list). It is pure, already unit-tested, and the asymptotic message→fraction mapping is identical
regardless of renderer.

## P7 — docs, full suite, CI, push

- CLAUDE.md: rewrite the UI/boot sections for the shell + meta mode; **fix the stale
  "`SAVE_VERSION` 2" line** (P3a takes it to 4); document that the meta verbs are an
  external-facing agent API.
- ROADMAP.md: a UI-v3 entry; mark legacy-chrome retirement done when L6 lands.
- `npm test` in full, then `./scripts/ci-on-server.sh` — **grep for `✓ Server CI passed`**, commit
  BEFORE running it (it archives `git archive HEAD`), and never chain `; git push`.

---

## Standing hazards (bit us or nearly did, this epic)

- **`npx tsc --noEmit` is the only truth** — TS7 inline/editor diagnostics are false.
- **`oxlint --fix` mangles formatting.** Never run it. Fix by hand or turn the rule off with a
  written reason.
- **WGSL comment backticks break the build.** `tests/unit/sky-backdrop-wgsl.test.ts` guards it.
- **The pixel font renders unknown glyphs BLANK.** The coverage guard in
  `tests/unit/ui-pixel-font.test.ts` now scans all of `src/render/ui` for string literals — if you
  add a label with a new symbol, add the glyph.
- **Version-constant bumps update `tests/unit/content-version.test.ts` in the SAME commit.**
- **Parallel vitest workers time out on a busy machine.** Use `--no-file-parallelism`; a "failed to
  start worker" error is contention, not a test failure.
- **`Object.assign(state, createState())` is WRONG** for resetting state — it dangles every
  collaborator holding `state.clock`/`eventLog`/`spirits`. Use `resetState`.
