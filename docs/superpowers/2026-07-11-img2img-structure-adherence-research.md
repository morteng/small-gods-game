# img2img structure adherence — research synthesis (2026-07-11)

**Problem.** The v30 tavern reseed shipped at silhouette IoU 0.80 (gate ≥0.7): FLUX.2 Klein
repainted the roof narrower and at its own pitch, and `registerAlbedo` papered over the
disagreement (clip to geometry + flood-fill missing interior with neighbouring gen colour →
the maroon smear on the left roof slope; albedo/normal disagree along eave lines so banded
lighting shades "wall" where paint says "tiles"). We want IoU ≥0.9 with rich painted texture.

**Current call path has no structural knobs.** `generateBuildingImage`
(`src/llm/openrouter-image-client.ts`) uses OpenRouter's chat-completions image API: prompt +
init image ONLY. Verified against OpenRouter's live endpoint JSON: the only passthrough params
for `flux.2-klein-4b` are `steps` / `guidance` / `safety_tolerance` — **no strength, no seed, no
control image**. The prompt already demands "matching its silhouette, footprint and roof pitch"
(`building-image-prompt.ts`) — 0.80 is what prompting buys. This is architectural to FLUX.2's
edit paradigm, not an OpenRouter limitation: no hosted provider exposes strength or ControlNet
for FLUX.2 (the sole FLUX.2 ControlNet checkpoint, `alibaba-pai/FLUX.2-dev-Fun-Controlnet-Union`,
has zero hosted inference).

**Keys on hand:** `.env` already holds `FAL_API_KEY`, `REPLICATE_API_TOKEN`, `PIXELLAB_API_KEY`,
`OPENROUTER_API_KEY` — the routes below need no new accounts.

## The field, verified mid-2026

- **No hosted "exact-silhouette repaint" exists.** Everything is probabilistic; the only hard
  guarantee is non-ML: hard-composite the paint back through the geometry alpha (we already do)
  and never trust vendor mask blending (VAE latent compositing can't be pixel-exact —
  arXiv 2512.05198).
- **True structural conditioning = FLUX.1-generation endpoints.** BFL deprecated its own
  Depth/Canny pros (Oct 2025); the survivor is **fal `fal-ai/flux-general`** (FLUX.1 dev,
  ~$0.075/MP), whose schema (verified) combines `reference_image_url` + `reference_strength`
  (default 0.65) **and** `controlnets`/`controlnet_unions` (`control_image_url`,
  `conditioning_scale`) in one call — i.e. our grey init AND our exact G-buffer canny/depth as
  a geometric constraint. Practitioner consensus: edge/lineart carries the silhouette at
  ~0.6–0.7 weight, depth LOW (~0.3) for shading; ≥0.9 across the board goes flat/plasticky.
  Also: `fal-ai/flux-lora-depth`/`-canny` ($0.035/MP, control-only).
- **Consistency-optimized instruction editors** are the cheap first test:
  **Qwen-Image-Edit-2511 on fal, $0.03/MP (verified)** — dual-path VAE+semantic encoding,
  explicitly targets "image drift", GEdit-Bench SOTA. Others: Gemini 3.1 Flash Image
  ($0.067–0.08, fidelity claims photo-oriented), Seedream 4.5 edit ($0.04) / 5.0 Pro
  ("structural coherence", pricing unpublished — re-check late July 2026).
- **Masked repair second pass:** compute the silhouette-disagreement mask (we can, from the
  IoU diff), send to FLUX.1 Fill (`fal-ai/flux-pro/v1/fill` $0.05/MP; "FLUX.2 Fill" does not
  exist), hard-composite model pixels strictly inside the mask. Converts a 0.80 pipeline to
  ≥0.9 without changing the primary model.
- **Per-pixel strength maps (Differential Diffusion, CGF 2025):** strength ≈0 in a 3–5px band
  around silhouette + ridge/eave lines, full repaint in facet interiors. ComfyUI-available,
  no hosted API — would need a GPU box; hold unless the hosted routes disappoint.
- **Edit-LoRA on FLUX.2 Klein 9B** (BFL's own June 2026 recipe is literally our case: 50–200
  before/after pairs, geometry render → accepted sprite). fal turnkey trainer
  (`flux-2-klein-9b-base-trainer`, $0.0043/step; the 4B trainer is deprecated) → ~$15–35
  all-in incl. a full 450-sprite run at $0.015–0.02/MP. Spend $5–10 first on a Base-trainer →
  distilled-inference portability probe. Best long-term unit economics + locks house style;
  needs 30–50 accepted pairs, so it comes AFTER a working adherence path.
- **The by-construction destination (open niche, nobody shipped it):** per-face material
  texturing — generate a small library of tileable painted materials once (~$1–5 total,
  amortized over ALL buildings), composite analytically onto the known facets/UVs the manifold
  pipeline already has, tiny decoration pass for signs/trim. Silhouette AND per-facet albedo
  co-registration become construction guarantees; survives ART bumps for free. Adjacent papers
  (TEXTRIX 2512.02993, MaterialMVP ICCV'25) confirm the rationale; no hosted product does it.
  Dovetails with the parked procedural-material-textures epic
  (`docs/superpowers/specs/2026-06-24-procedural-material-textures-img2img-*.md`).
- **Post-process upgrade regardless of paint path:** Oklab-space k-means palette reduction +
  Bayer ORDERED dithering (error-diffusion smears our lighting-band edges). Port techniques
  from PixelRefiner (github.com/HappyOnigiri/PixelRefiner, active) / hitherdither; also the
  adaptive majority-colour downscale (hiivelabs 2025-01) ahead of quantize.
- **Dead ends checked:** raising FLUX.2 tiers / guidance fiddling (no structural input),
  GPT Image 2 (token billing hostile), PixelLab (≤512px, init-strength only — wrong scale for
  430px buildings), Scenario/Leonardo ControlNet APIs (real, but subscription-shaped; fal
  covers the same ground on keys we hold), Retro Diffusion (palette lock is nice, no verified
  depth/edge conditioning), Together.ai (FLUX listings gone).

## Recommended sequence (respects the low-spend directive)

1. **$0 groundwork:** hollow-flue chimney geometry (+ crown lip) batched into the pending
   geometry pass; Oklab+ordered-dither post-process; keep the hard-composite discipline.
2. **~$1 pilot (needs spend approval):** same 3–5 presets through BOTH
   (a) Qwen-Image-Edit-2511 ($0.03/MP) and (b) fal `flux-general` with grey-init reference +
   G-buffer canny (~0.65) / depth (~0.3) conditioning ($0.075/MP). Score with the existing
   IoU gate + eyeball in the studio. Seeder gains a `--provider` switch.
3. **Adopt the winner** as the seed pipeline; raise the accept gate to ≥0.9 (retries are cheap
   once adherence is real). Optional: FLUX Fill repair pass for stragglers.
4. **Later:** Klein-9B edit-LoRA once 30–50 accepted pairs exist (style lock + cheapest
   inference); per-face material texturing as the strategic epic that retires the problem.

Full-matrix cost at the new prices: Qwen ≈ $13.5 / flux-general ≈ $34 for ~450 sprites —
vs ~$6 today, but with the 20%-drift tax removed.
