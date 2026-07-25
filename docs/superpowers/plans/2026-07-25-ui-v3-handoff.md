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

## P3b — save/load SCREENS (P3a services assumed landed)

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
