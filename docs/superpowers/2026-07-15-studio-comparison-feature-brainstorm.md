# Studio "comparison" feature — brainstorm

**Date:** 2026-07-15
**Status:** brainstorm (research only, no code changed)
**Trigger:** user: give the studio a "comparison" capability so an agent working on a
terrain/building/object can (1) fetch a TTI reference/inspiration image, and (2) run an
img2img of what it's currently working on, rendered in "1:1 2K pixel-art style," to compare
against and improve the real work. Proposed model: "Nano Banana 2 Pro" via OpenRouter.
**Spend context:** the user just approved *small* paid spends going forward ("single and a
few, we are not ready to do all sprites yet") — paid gen is allowed in moderation, never a
full-catalogue batch, never an autonomous `--go`-style run.
**Direction update (mid-research):** the user confirmed **"we are going to move back to
OpenRouter anyway"** — OpenRouter is the *intended* long-term home for image generation,
full stop, not just for this comparison feature. The current Replicate/Qwen production img2img
path (`BUILDING_IMAGE_MODEL = 'qwen/qwen-image-edit-2511'`, adopted 2026-07-11) is therefore
**transitional infrastructure, not the destination**. This doc is written accordingly: OpenRouter
(Nano Banana Pro / Gemini 3 Pro Image) is framed as the primary path for *both* sub-capabilities
below, and the Replicate-migration question is answered explicitly rather than waved off as
out of scope (see "Should production img2img migrate too?").

---

## The landscape: three existing patterns, not one

Before proposing anything new it's worth being precise about what already exists, because the
codebase already has **three different paid-image mechanisms** and the user's ask is closest
to a *fourth*, distinct from all of them:

| # | Mechanism | Init image? | Purpose | Where it lands |
|---|---|---|---|---|
| 1 | **TTI reference** (`scripts/tti-probe.ts`, `reference-panel.ts` Regen/+New) | none — text only | "what would a generic model imagine for this description" — inspiration/eval | `reference-library/tti/<slug>/model-tti.png` |
| 2 | **Production img2img** (`generateBuildingImageAuto`, `studioDebug.renderPaid`) | our grey massing silhouette | repaint the geometry into the SHIPPED sprite, gated (IoU/border) | IDB parametric-sprite-cache / vendored bundle |
| 3 | **A/B compare** (`ab-section.ts`) | our grey massing silhouette | run #2 through two candidate models side by side, report gate metrics | ephemeral (view-only, not persisted) |
| 4 | **← what the user is asking for** | **our current RENDERED view** (not the silhouette) | "render what I'm looking at in target style, so I can eyeball fidelity gaps and improve the real work" | needs a home (see storage design) |

\#4 is closest in *intent* to #1 (`tti-probe.ts`'s own header literally says the point is "to
compare 'what our words describe' vs 'what our geometry builds'") but closest in *mechanism*
to #2/#3 (it needs an init image — ours, not a text description). It is a **diagnostic/eval
tool, not a production-art tool**: its output must never silently become the shipped sprite,
and it never needs to pass the IoU/border quality gates #2 does — a comparison render is
allowed to look worse or drift, that's the point of looking at it.

---

## Sub-capability 1 — reference fetch (extend, don't invent)

**Finding: this is already generalized beyond "buildings."** `studioDebug.kinds()`
(`src/studio/studio.ts:1439`) spans "buildings + hand plants + flora-DB species + bridges" —
`setKind` accepts anything in `BUILDING_BLUEPRINTS`, `isBridgePreset` (`src/blueprint/presets/bridges.ts:142`),
or `isPlantPreset` (`src/blueprint/presets/index.ts:617`), and `ttiReferencePrompt(rb)`
(`src/assetgen/building-image-prompt.ts:326`) is written generically off a `ResolvedBlueprint`,
not a building-specific type. So an agent authoring a plant or a bridge in the Object studio
*already* gets a working reference-fetch path today via:

- `studio_regen_reference` (MCP tool, `tools/mcp-server.ts:190`) → `studioDebug.regenReference()`
  (`src/studio/studio.ts:1488`) → `POST /__reflib/<slug>` (`vite-plugins/reflib-sink.ts:36-48`)
  → `generateTti()` (`scripts/tti-generate.ts:27`, a text-only OpenRouter chat/completions call)
  → writes `reference-library/tti/<slug>/{model-tti.png,prompt.txt}` + a `manifest.tsv` cost row.
- The Reference dock tab (`src/studio/reference-panel.ts`) is the human-facing version: a
  thumbnail strip + inspector with editable prompt, model dropdown, Regen/+New/Delete, gated to
  `?bridge=rw`, **one click, no confirm dialog** ("a TTI call is cheap" — line 8 comment).

**What's actually missing:** terrain/site scenes. `src/studio/site-studio.ts` (`?studio=site`)
and `src/studio/world-studio.ts` (`?studio=world`) are a *different* studio surface — each has
its own `grab()` (`site-studio.ts:368-376`, `world-studio.ts:1407-1415`, both composite the
WebGPU scene canvas + a 2D overlay canvas into one PNG) but **neither is wired to the MCP
bridge at all**. `src/main.ts:19-21` only attaches `makeStudioBus` (the thing that exposes
`studio_*` tools) when the Object studio (`src/studio/studio.ts`) is the active surface;
`__siteStudio`/`__worldStudio` are console-only debug globals. So "fetch a reference for a
terrain patch / a whole site" has no MCP path today — see Open Questions.

**Recommendation:** no new mechanism for buildings/props/plants/bridges — just use
`studio_regen_reference` as-is (it already works). For terrain/site scenes, either extend
`main.ts`'s bridge wiring to `?studio=site`/`?studio=world` (their `grab()` already exists,
they'd just need a `regenReference`-equivalent added to their debug object + a `StudioController`
adapter), or scope v1 to Object-studio subjects and treat terrain as a fast-follow.

---

## Sub-capability 2 — img2img "render mine in target style" compare

This is the actually-new piece. Shape it as a sibling of #2/#3, not a variant of #1 (it needs
an init image, so it cannot reuse `generateTti`).

**Capture the input** — already solved, three ways depending on subject:
- Object studio: `studioDebug.grab()` (`src/studio/studio.ts:1451`, `canvas.toDataURL('image/png')`)
  — same call the Reference/AB panels already use for thumbnails, and the same one
  `studio_render`/`studio_select` return over MCP.
- Site studio: `__siteStudio.grab()` — composited scene+overlay (see above).
- World studio: `__worldStudio.grab()` — same pattern, whole-island composite.
- Live game (not a studio at all): `window.__debug.grab()` / `grabFile()`
  (`src/dev/debug-api.ts:82-89`) already writes straight to `.dev-grabs/<name>.png` via the dev
  server — the existing capture-lesson memory (`feedback-offline-sprite-render-dev-loop`) says
  prefer this over Playwright screenshotting.

**Dispatch the img2img call** — reuse the existing provider split, don't reinvent it:
`generateBuildingImageAuto` (`src/llm/building-image.ts:43-57`) already routes any model id
starting `qwen/` to Replicate and *everything else* to OpenRouter's `generateBuildingImage`
(`src/llm/openrouter-image-client.ts:118-160`, a `chat/completions` POST with a text part + an
`image_url` init part + `modalities`). **A `google/gemini-3-pro-image` model id needs zero
dispatcher changes** — it already falls through to the OpenRouter path. Bonus: prompt-family
routing in `imageModelFamily()` (`src/assetgen/building-image-prompt.ts:342`) already checks
`m.includes('gemini')` *before* `qwen`/`flux` — the codebase has apparently anticipated a
Gemini image model landing here at some point, even though nothing currently uses that branch
for img2img (only for prompt-shaping the text side).

**What must NOT happen:** this render must never enter `generateBuildingImageAuto`'s
production call sites (`src/render/generated-building-art-source.ts`, the seeder script) or the
IDB `parametric-sprite-cache` — that cache is keyed on the deterministic compose *input*
(`parametricSpriteKey`, `src/render/parametric-sprite-cache.ts:116`), and a comparison render
is neither deterministic nor meant to be drawn in-game. Keep it a fully separate call site.

---

## Model finding: "Nano Banana 2 Pro" — VERIFIED, with a naming correction

There is no single model literally named "Nano Banana 2 Pro." Google/OpenRouter ship two
adjacent things and the user's name blends them:

| Marketing name | OpenRouter model id | Notes |
|---|---|---|
| **Nano Banana Pro** | `google/gemini-3-pro-image` (stable) / `google/gemini-3-pro-image-preview` | Built on Gemini 3 Pro. "Google's most advanced image-generation and editing model." Localized edits, lighting/camera control, **2K/4K output**, multi-image blending (up to 5 subjects), search grounding. **This is the one that matches the user's "1:1 2K pixel-art style" ask.** |
| **Nano Banana 2** | `google/gemini-3.1-flash-image-preview` | Faster/cheaper Flash-tier sibling — "Pro-level visual quality at Flash speed." A cheaper fallback if Pro proves overkill or too pricey for iteration. |

**Both are confirmed live on OpenRouter today** (fetched `openrouter.ai/google/gemini-3-pro-image`
and `.../gemini-3-pro-image-preview` directly). Both support image input+output over the same
chat-completions shape `openrouter-image-client.ts` already speaks (`content: [{type:'text'},
{type:'image_url'}]`, `modalities`) — this is a text+image chat-completions model, not a
special image-only endpoint, so no new HTTP shape is needed.

**Pricing:** $2/M input tokens, $12/M output tokens. A 2K output image bills ~1,120 output
tokens (~$0.134); the input init image adds ~560 tokens (~$0.001). **≈ $0.13–0.15/image** —
meaningfully pricier than the current production img2img (Qwen-Image-Edit-2511 on Replicate,
~$0.03/img; FLUX.2 Klein, ~$0.014/img) but well inside "single and a few" territory for a
comparison tool that fires on demand, not per-catalogue-entry.

**Gotcha, not a blocker:** `openrouter-catalog.ts:48` lists `google/gemini-2.5-flash-image` in
`DEAD_MODEL_IDS` as "image-only; not a chat model" — but that catalog
(`VERIFIED_CHAT_MODELS`/`fetchOpenRouterModels`) is the **text/tool-calling** model picker for
backfill/Fate (`parseCatalog` filters to `supported_parameters.includes('tools')`, which
image-out models don't advertise). It is unrelated to the hardcoded image-model ids
`building-image.ts`/`tti-generate.ts` dispatch directly — don't route the new model id through
that catalog, and don't read the `DEAD_MODEL_IDS` entry as "Gemini image models don't work
here," it's a different concern entirely.

**Recommendation:** `google/gemini-3-pro-image` (stable id, not `-preview`) as the default
comparison-render model; expose `google/gemini-3.1-flash-image-preview` as a cheaper alternate
in the model dropdown (mirrors how `reference-panel.ts` already offers a model select, not a
hardcoded single model).

**No capability gap found.** The user's brief said to treat a missing OpenRouter img2img
capability as a planning gap rather than default to Replicate — but there is no gap: OpenRouter
product pages for both `google/gemini-3-pro-image` and `google/gemini-3-pro-image-preview`
explicitly state "supports image input/output and editing via API," and the request shape is
the exact one `src/llm/openrouter-image-client.ts` already sends (a `type:'image_url'` content
part alongside the text prompt). **OpenRouter is fully capable of serving both sub-capabilities
in this doc today** — TTI reference-fetch (#1, no init image) and img2img compare-render (#2,
with init image) can both go through OpenRouter, on the SAME model family, with zero new HTTP
plumbing. This is good news for the "move back to OpenRouter" direction: nothing here needs to
wait on a provider capability that doesn't exist yet.

### Should production img2img (Replicate/Qwen) migrate too?

Given the confirmed direction ("we are going to move back to OpenRouter anyway"), the honest
answer is: **probably eventually, but not as a side effect of this feature, and not without its
own pilot.** Two things pull in opposite directions:

- **Pulling toward migrating:** `generateBuildingImageAuto`'s provider split
  (`src/llm/building-image.ts:43-57`) was *designed* for this — routing is a one-line `model`
  string check, not an architectural fork. If `google/gemini-3-pro-image` proves out well in
  the low-stakes comparison role, promoting it to `BUILDING_IMAGE_MODEL` is a small, mechanical
  change. There's no code reason to keep Replicate once a comparable-or-better OpenRouter model
  is proven.
- **Pulling toward NOT migrating yet:** the current Qwen default was itself the winner of a
  measured pilot (`docs/superpowers/2026-07-11-img2img-structure-adherence-research.md`:
  silhouette IoU 0.974–0.994 vs FLUX.2 Klein's 0.80 baseline) that fed the current
  `MIN_SILHOUETTE_IOU = 0.9` quality gate
  (`src/render/generated-building-art-source.ts:33-36`). Nano Banana Pro is untested against
  that exact bar — an instruction-editor's silhouette adherence and a general-purpose
  image-editing model's silhouette adherence are not the same thing, and the production gate
  exists precisely because that distinction burned the FLUX.2 Klein baseline. Swapping the
  production default without re-running that pilot risks silently reintroducing geometry drift.
  Also: at ~$0.13–0.15/img, Gemini 3 Pro Image is 4–10× the per-image cost of the current
  production model — fine for an on-demand comparison tool, a real factor at production-batch
  scale (a "reseed" touches hundreds of sprites).

**Recommendation:** treat this comparison feature as the **cheapest possible pilot** for that
future migration — every comparison render against `google/gemini-3-pro-image` is a free data
point (IoU/border can be computed against it even though the comparison path itself doesn't
gate on them) toward "is this model good enough to become `BUILDING_IMAGE_MODEL`." Don't fold
the production-default swap into this feature's scope; let this feature's own usage build the
evidence, then run a dedicated pilot (mirroring the 2026-07-11 one) before touching
`BUILDING_IMAGE_MODEL`. Frame this explicitly in the plan doc as "Step 1 of the OpenRouter
migration," not "a permanently separate dev toy."

---

## Per-object storage design

The natural home is a **sibling of the existing reference library**, not the IDB sprite cache
(wrong tool — that cache is for deterministic, in-game-drawn sprites; see above) and not a new
database. `reference-library/tti/<slug>/` (`vite-plugins/reflib-sink.ts:73`) is already:
gitignored (`.gitignore:62`), served dev-only, keyed by subject slug, holding
`{model-tti.png, prompt.txt}` + an append-only `manifest.tsv` cost ledger.

**Proposal:** add a parallel `reference-library/compare/<slug>/` directory:
```
reference-library/compare/<slug>/
  input.png       # the captured grab() — what we actually looked like
  compare.png     # the img2img result at target style
  prompt.txt      # model + the exact prompt sent
  manifest.tsv     # append-only: slug, model, cost — same shape as tti/manifest.tsv
```
Extend `reflib-sink.ts`'s `POST /__reflib/<slug>` handler (or add a sibling
`/__reflib-compare` mount) to accept an `initImageDataUri` field in the JSON body and call
`generateBuildingImage`/`generateBuildingImageAuto` instead of `generateTti` when one is
present — the two request shapes already differ only by that one content part.

**Keying:** reuse `reference-panel.ts`'s existing `freshSlug()` convention (kind, else
`kind-2`, `kind-3`, …, `src/studio/reference-panel.ts:198-204`) for Object-studio subjects —
no new scheme needed there. Terrain/site subjects have no natural "kind," so they need a
convention decided at design time (candidate: `site-<seed>` / `world-<seed>-<focusTile>`) — see
Open Questions.

---

## Spend-gating design

Reuse the two gates already shipped, don't invent a third:

1. **`?bridge=rw` only.** Every paid path (`studio_render_paid`, `studio_regen_reference`,
   the reflib POST handler, `ab-section.ts`'s Run button) already refuses on a read-only
   bridge. The new tool inherits this for free by living in the same `StudioController`/
   `makeStudioBus` surface (`src/studio/studio-bridge.ts:75-91`).
2. **`confirm:true` in the body, one call per invocation.** `reflib-sink.ts:32` already rejects
   a POST without `confirm:true` — "regen requires confirm:true (it SPENDS money)." No batch
   loop exists anywhere in this call chain (contrast: `scripts/seed-*.ts` batch scripts are a
   *different*, explicitly `--go`-gated CLI class per CLAUDE.md — never reuse that pattern
   here). `ab-section.ts` already models "a few, not all" honestly in its own UI copy: "⬆ Run
   A/B (paid ×2)" — the button *tells the user how many calls it's about to make*. The new tool
   should do the same (e.g. "Run compare (paid ×1)").
3. **No new MCP tool should accept a "for every kind in the catalogue" argument.** Keep the
   input shape to "this one subject, this one call" — mirrors `studio_render_paid`'s
   `{kind?: string}` (single optional kind, never a list).
4. **Cost is logged, not estimated.** Every existing path appends `{slug, model, cost}` to a
   `manifest.tsv` from the real `usage.cost` OpenRouter returns (`tti-generate.ts:49`,
   `reflib-sink.ts:42`) — carry this straight over so spend stays auditable after the fact.

---

## MCP / studio surface

Add one new tool, `studio_render_compare` (or `studio_compare`), alongside
`studio_render_paid`/`studio_regen_reference` in `tools/mcp-server.ts:185-198`:

```
studio_render_compare({ kind?: string, model?: string, prompt?: string })
  → { slug, model, cost, inputDataUri, compareDataUri }
```
- `kind` optional (defaults to the current studio subject, same convention as the other two).
- `model` optional, defaults to `google/gemini-3-pro-image`.
- `prompt` optional, defaults to a new `compareRenderPrompt(rb)` — a sibling of
  `ttiReferencePrompt`/`buildingImagePrompt` in `building-image-prompt.ts` that asks for "the
  attached image, redrawn at native pixel-art fidelity, 1:1 pixel grid, 2K" rather than
  "repaint this silhouette" or "imagine this description."
- Wire it through `StudioController.renderCompare?(...)` → `makeStudioBus`'s `query` map
  (`studio-bridge.ts:81-91`, same shape as `studio_regen_reference`) → a new `studioDebug`
  method (`studio.ts`, sibling of `regenReference`/`renderPaid` at line 1475-1503) that calls
  `studioDebug.grab()` for the init image instead of `buildInit(rb)`.
- Client UI: extend `reference-panel.ts` (or a new small "Compare" sub-tab next to it) with a
  third thumbnail slot ("compare render") alongside "our sprite" / "reference," following the
  exact `thumbCell`/`selectItem` pattern already there (lines 151-171) — an agent driving this
  via MCP doesn't need the UI, but a human iterating in the studio does, and the panel already
  has the strip/inspector chrome to extend rather than duplicate.

---

## Open questions

1. **Terrain/site scope for v1.** `site-studio.ts`/`world-studio.ts` have `grab()` but no MCP
   bridge at all (`main.ts:19-21` only wires the Object studio). Ship v1 for Object-studio
   subjects (buildings/props/plants/bridges) only, and treat terrain/site as an explicit
   follow-up that requires extending the bridge wiring — or do both now? Recommend: v1 scoped
   to Object studio; the terrain ask can reuse everything here once the bridge is extended.
2. **Slug convention for non-blueprint subjects.** Buildings/plants/bridges have a natural
   `kind` slug. A terrain patch or a whole site does not — needs a decision (`site-<seed>`?
   `world-<seed>-<tx>-<ty>`?) before sub-capability 1's reference-fetch can extend there either.
3. **Does Nano Banana Pro actually render convincing pixel-art?** Image-editing models often
   default to painterly/photoreal even when told "pixel art." This needs the same kind of cheap
   empirical pilot that data-drove the Qwen adoption (`docs/superpowers/2026-07-11-img2img-structure-adherence-research.md`)
   before committing — 1–2 test calls against a couple of subjects, not a bulk run, per the
   spend directive.
4. **When does production img2img actually migrate to OpenRouter?** Direction is now settled
   ("we are going to move back to OpenRouter anyway") — this is a *when*, not an *if*. This
   feature's own usage doubles as the evidence-gathering step (see "Should production img2img
   migrate too?" above), but the production-default swap itself should stay a separate,
   dedicated pilot (mirroring 2026-07-11's IoU measurement) gated on that evidence, not bundled
   into this feature's rollout.
5. **Is a static side-by-side (input vs. compare-render) enough, or does "compare and improve"
   need a diff/overlay view?** `ab-section.ts` already ships gate-metric side-by-sides for the
   production path; this new mode has no quality gate to report (an eval tool, not a pass/fail
   one) — worth deciding whether the UI needs anything beyond the thumbnail-strip pattern
   `reference-panel.ts` already has, e.g. an opacity-blend toggle for overlay comparison.
6. **One-shot vs. iterative.** The user's phrasing ("compare against and improve the real
   work") implies a loop: render → look → tweak geometry → re-render. Should
   `studio_render_compare` diff against the *previous* compare render for the same slug (cheap,
   local) as well as the model each time (paid), so an agent can tell "did my geometry edit
   move the needle" without spending on every intermediate check?

---

## Summary of reuse vs. new

**Reuse as-is:** `studio_regen_reference` for reference-fetch on buildings/props/plants/
bridges (already generalized); `generateBuildingImageAuto`'s provider dispatch (a
`google/gemini-3-pro-image` id needs zero changes there); the `?bridge=rw` + `confirm:true`
spend gate; the `manifest.tsv` cost-ledger convention; `grab()` for input capture (already
exists on every studio surface).

**New, small:** one MCP tool (`studio_render_compare`), one `studioDebug` method, one prompt
builder (`compareRenderPrompt`), one reflib-sink extension (accept an init image on the POST),
one sibling storage directory (`reference-library/compare/<slug>/`), one model-catalog entry
(`google/gemini-3-pro-image` + the Flash alternate) in whatever dropdown the compare UI uses.

**Deliberately not doing:** wiring terrain/site studios into the bridge (v2), any batch/
catalogue-wide compare tool, any path that lets a comparison render reach the IDB sprite cache
or the shipped game art, and — for THIS feature specifically — flipping `BUILDING_IMAGE_MODEL`
off Replicate/Qwen. That swap is the right eventual direction (OpenRouter is confirmed as the
destination for image gen generally) but belongs to its own measured pilot, not this feature's
scope.
