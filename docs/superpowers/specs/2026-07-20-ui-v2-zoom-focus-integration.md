# UI v2 — full integration, zoom- and focus-aware

**Status:** implementing 2026-07-20 · USER DIRECTIVE: "fully integrate all functionality in a
more advanced ui/ux than we have now. zoom- and focus aware."
**User calls (2026-07-20):** 3 zoom bands **World / Settlement / Soul**; gameplay first —
meta-chrome (LLM settings depth, save mgmt, spend chip → needs WebGPU text input) is a LATER
epic. Settings/whisper DOM islands stay as-is.
**Standing law:** ALL UI through the agent-driven substrate (Command / affordance / UiSpec) —
no bespoke panel→method forks. No new DOM. Legacy `?legacyui` stays frozen, not migrated.
**Prior art:** semantic-zoom v1 (spec 2026-07-01) shipped P0–P5; alert pins PARKED (user: "no
floating icons over the world") — that constraint HOLDS; the World band uses map typography
instead.

## Reality check (scouted 2026-07-20)

- 2 bands (`'in'`/`'out'`, hysteresis 0.45/0.40); out-band shows NO per-target surface (pins
  parked, hover+inspector hard-null). Camera ladder: unit-fraction rungs 1/20…1/2, 1, 2.
- No scroll anywhere — all panels budget-clamp ("reserve-then-clip"). No drag. Esc is the only
  key the runtime owns. Pixel font is UPPERCASE A–Z, 0–9, few symbols (`- + / . : · … ✕ ⏭ ⏳`).
- One modal card at a time; `UiSpec` and the older `StorySession` card are parallel systems.
- `UiSpace.World` plumbing (batcher/pass/projection) is live-tested but has ZERO consumers.
- Input caveat: runtime `stopPropagation()`s pointer events, but world `controls.ts` listens to
  compat MOUSE events, which only `preventDefault()` suppresses — likely click-through bug.
- Unsurfaced in barebones: timeline scrub/commit/re-roll (T-key DOM), Mind Mode (legacy-only),
  spirit/rival roster (`GameQuery.spirits()` has no consumer), building info, chronicle browsing
  (only latest-as-tiding), births/deaths/growth/road events (NO tidings — dead ends), peace/oath
  status readout, LLM backfill trigger (none in barebones), minimap (M-key DOM), tutorial (?-key).

## Design

**One attention model.** `focus = (band, target)`. The camera's zoom band says WHAT KIND of
thing you attend to; the focused target says WHICH one. Every surface derives from those two:
inspector content, hover vocabulary, fly-to altitude, LLM warmth, label emphasis. Zooming is
not a viewport change — it is moving between World-mind, Settlement-mind, and Soul-mind.

### D1 — three bands
`ZoomBand = 'world' | 'settlement' | 'soul'` (`affordance/zoom-band.ts`, keep pure + hysteresis
per boundary):
- soul ↔ settlement: in ≥ **0.45**, out ≤ **0.40** (the proven v1 pair; last soul rung = 1/2).
- settlement ↔ world: in ≥ **0.15**, out ≤ **0.125** (dead zone straddles the 1/8 and 1/6
  rungs). Empirical retune allowed; keep both pairs as named constants.
- Existing consumers migrate: v1 `'in'` ⇒ `'soul'`, `'out'` ⇒ `'settlement' | 'world'`.
- Fly-to altitude per focused-target kind: npc → `SOUL_FLY_ZOOM = 0.5` (rename of
  ALERT_FLY_ZOOM), settlement → `SETTLEMENT_FLY_ZOOM = 0.25`.
- Per-band target resolution (hover + click): world → settlements only; settlement →
  building/settlement/npc; soul → npc/entity/tile (current behavior). Verb vocabulary follows
  automatically (affordances key on target kind — no registry change).

### D2 — row-granular scroll (the enabling tech; no scissor, no GPU change)
`UiContext.scrollList(id, {x,y,w,h}, rowH, rowCount, drawRow)` — wheel over the region steps
whole rows (3 rows/notch), offset clamped, stored per-id in the runtime (transient, never
serialized); draws only rows that fully fit (row-granular ⇒ no clipping needed); when
overflowing, draws `▲/▼`-style more-indicators (pixel-font `+`/`-` or `:` glyphs — NO new
glyphs) and a 2px position track on the right edge. Wheel routing: runtime adds a
capture-phase `wheel` listener; if the pointer is over a registered scroll region (last
frame's regions, same idiom as `hits`), consume with `preventDefault()`+`stopPropagation()`;
otherwise the world zoom keeps it. Inspector, inbox, powers, and new panels adopt it —
budget-clamp `break`s become scroll lists. UiSpec CARD budgets stay (cards are moments, not
browsers).

### D3 — input routing fix (W0)
`pointerdown/up` that the UI consumes must ALSO `preventDefault()` so the browser never
synthesizes the compat mouse events `controls.ts` listens to. Verify with a unit/E2E test that
a click on an open panel does not select/pan the world underneath.

### D4 — World band: map typography (NOT icons — the parked-pins ruling holds)
New `src/render/ui/world-labels.ts` + `getWorldLabels` hook in game glue: settlement NAME
labels (uppercase pixel font, fixed screen size) pinned to POI positions via the alert-pin
projection idiom (`worldToScreen`, pixel-snapped, culled, `UiSpace.World`). Beside the name, a
small count `·N` when inbox items anchor to that settlement — text, not glyph icons. Focused
settlement renders accent-colored; rival-contested settlements (any `otherRival`-dominant or
dispute-tiding present) render with a dimmed second line naming the leading spirit. Click a
label = focus that settlement + fly to `SETTLEMENT_FLY_ZOOM`. Labels show in `world` band
only. Cap 16, cull off-screen. The world band IS the map — with this, the DOM minimap stays
keybind-only (no WebGPU minimap; FIT + labels replace it).

### D5 — Settlement band: settlement inspector v2
`GameQuery.inspect` for settlement targets grows (all read-only, serializable):
wards (name+type rows), population + housing capacity (settlement-growth store), congregation
size + existing domain-conviction bars, peace/oath status when present (lord sworn/lapsed +
expiry in fiction days), and a RECENT strip (event-log window, last day: births/deaths/growth/
road upgrades in this settlement, coalesced counts). Inspector renders it with `scrollList`
(ACTS row block stays bottom-reserved exactly as today). Clicking a building in settlement
band focuses its settlement inspector and highlights a building row (name/type) — no separate
building panel.

### D6 — Soul band: deepened NPC inspector + warm focus
- Add the `npcStatusHint` prose line (exists in `believers.ts`) + prayer subject + epithet
  (already partially shown) + a RELATIONSHIPS scroll section (top ties by trust, name +
  trust bar) to the npc inspect payload.
- **Focus warms the soul:** in barebones, selecting an NPC (soul band) triggers the LLM
  backfill path (`Game`'s existing backfill service) with a per-NPC cooldown — the v1 spec's
  "zoom = attention = narration trigger", finally wired. Offline/no-LLM ⇒ silently skipped.
- Whisper/conversation card unchanged (already the keystone).

### D7 — Pantheon panel (rivals finally visible)
Third bottom-left pill: `SPIRITS (n)` → panel (scrollList) from `GameQuery.spirits()`:
sigil + name + power bar + follower count + one-word stance label (derived from
`strategyForPersonality`), player first. Click a rival row → fly to its strongest settlement
(from believer counts) + focus that settlement. Pure read + focus verbs — no new commands.

### D8 — lifecycle tidings (close the dead ends)
`divineInbox` gains coalesced, windowed, auto-expiring tidings (same idiom as `rival_dispute`):
births+deaths per settlement per last-day ("N souls born, M passed in X"), road adoption/class
("the path to X has become a road"), settlement growth ("X raises new roofs"). Low salience;
anchors where resolvable. Event types already exist in the log — this is generators only.

### D9 — chronicle browser
The chronicler's daily annals (M1, `chronicle-store`) become browsable: the inbox panel gains
a `TIDINGS / ANNALS` toggle row; ANNALS = scrollList of past entries (day + first line,
click expands to a UiSpec card showing the full entry — one card, existing budgets). Read-only.

### D10 — quiet chrome + band transitions (polish wave)
Non-focused chrome recedes: time cluster collapses to the clock chip until hovered; camera
cluster collapses to `+/-`; band changes fade world labels in/out over ~150ms (alpha ramp —
no layout animation). Optional this epic; ship last.

### Out of scope (explicit)
Meta-chrome (settings depth/save/spend + WebGPU text input) — own epic. Timeline scrub UI
migration — own round (it's replay machinery with its own semantics; T-key DOM stays).
Mind Mode migration — after conversation UI round. Story-card→UiSpec unification — stretch.
Area targets, Fate-authored UiSpec — unchanged v1 stretch items. Minimap/tutorial DOM — stay
keybind-reachable, untouched.

## Work packages (each shippable, server-CI gated)

- **W0 — enabling tech** (`zoom-band` 3-band + consumers, `scrollList` + wheel routing, D3
  input fix, minimap DOM default stays hidden; fix bottom-left overlap by moving nothing —
  minimap opens above the strip when toggled). Tests: band hysteresis pairs, scroll clamp +
  row windowing, wheel consumption, no-click-through.
- **W1 — World band labels** (D4). Tests: projection/cull/cap, badge counts, focus accent,
  click-to-fly; band gating.
- **W2 — settlement inspector v2** (D5) + per-band target resolution (D1 tail). Tests: inspect
  payload golden-ish (deterministic), scroll sections, building-row highlight, band-keyed
  hover/click resolution.
- **W3 — soul deepening** (D6): status hint + relationships + warm-focus backfill w/ cooldown.
- **W4 — pantheon + tidings + annals** (D7, D8, D9).
- **W5 — polish** (D10) + empirical band-threshold tune on live grabs.

Ordering: W0 first (everything depends on it). W1 ∥ W2 in worktrees (both touch `ui-runtime`
— coordinate: W1 adds `drawWorldLabels` as a NEW function + one call site; W2 rewrites
`drawInspector` internals). W3–W5 sequential after.

## Acceptance (epic-level)

Zoom from space to a face: World shows the map with named, badged settlements; click a name —
the camera descends to the settlement, its inspector shows wards/people/peace/recent life;
click a soul — descend again, the person's state/beliefs/ties/prose, whisper a word. Nothing
the sim can tell the player is a dead end; every surface is Command/affordance/UiSpec-backed;
no new DOM; all bands honest at 60fps (HUD_SIM_TTL memo intact). Server CI green per wave.
