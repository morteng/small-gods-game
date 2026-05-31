# Animation & Fate-Driven Asset Generation — Research Notes

**Status**: 🔬 Research / future direction — **not scheduled**. Captured 2026-06-01.
**Decision so far**: keep coding the underlying systems with **placeholders**; revisit
this when the belief loops, rivals, and Fate (ROADMAP Tracks 1–4) are real.

> This is a research capture, not a spec. When this direction is picked up it gets
> its own **brainstorm → spec → plan** cycle per the ROADMAP convention. Related
> existing docs: [AI_VISUALS_AND_AUDIO.md](AI_VISUALS_AND_AUDIO.md),
> [AI_RENDERING_SETUP.md](AI_RENDERING_SETUP.md). The author-time-vs-runtime
> framing here continues the pixel-art generation research in session memory.

---

## 0. The question that started this

How do we animate the eventual zoo of NPCs, animals, and monsters — *especially*
when "strange new gods require new and interesting forms of prayer/worship," i.e.
the animation vocabulary must keep growing? And can **Fate** drive that: draw from
a library of pre-generated motions/assets, reuse what fits, and **prompt for new
ones on demand**, adding them back to the library for next time?

The investigation walked through three regimes (2D sprite → 2D skeletal → 3D/voxel)
and landed on a **3D/voxel pivot** as the direction worth designing for, because it
unlocks generate-on-demand motion and reusable assets in a way 2D cannot.

---

## 1. Why the regime matters (and how we got here)

| Regime | Verdict | Why |
|---|---|---|
| **2D sprite-sheet frames** | Fine for placeholder/now | Lightweight, deterministic, CSP-safe. But frame-count explosion (idle × walk × pray × N), and no runtime composition. |
| **2D skeletal/cutout** (Rive/Spine/DragonBones) | Considered, then set aside | Avoids *frame* explosion, not *rigging* explosion. **Iso needs 4–8 directions per rig.** Licensing: **Spine** runtime is gated behind a paid editor license (out, given FOSS-only); **Rive** runtime is MIT but the editor is proprietary SaaS (free tier); **DragonBones** drifted to "LoongBones" with an uncertain future. Canvas-2D fit: **Rive** can draw into our existing 2D context + y-sort; **Spine** is WebGL-first and would break the y-sort interleave we just fixed. |
| **3D / voxel** | ✅ Direction to design for | Z-buffer makes our y-sort occlusion free. Voxel style is cheap to generate, cheap to render en masse, and forgiving of rough generated assets. **Crucially: 3D revives the AnyTop family** — generate-on-demand skeletal motion (BVH) becomes real. |

**Key reframe:** the earlier "AnyTop is the wrong dimension" objection only held for
2D. In 3D, BVH skeletal motion is exactly what these models produce, so the whole
text-to-motion ecosystem is back on the table.

### FOSS-only constraint (standing)
We use open-source only, no paid software licenses — *or* build our own. A hosted,
metered generation **API** is neither FOSS nor a "license"; whether to allow one is
an explicit fork (see §4).

---

## 2. The 2026 generator landscape

### Motion (text → 3D skeletal motion → BVH/glTF)

| Tool | Open? | Topology | Notes |
|---|---|---|---|
| **AnyTop** (SIGGRAPH 2025, TAU) | ✅ MIT code + weights | **Arbitrary** (animals, monsters, dinosaurs) | Diffusion + topology-aware transformer. Generalizes from ~3 examples/topology; zero-shot on unseen skeletons. **Its cross-topology thesis is also our motion-retargeting bridge.** Trained on TrueBones Zoo (~70 species, ~1000 BVH clips); processed dataset *not* redistributed (licensing) — fetch raw from Gumroad + preprocess. CUDA GPU, offline. Outputs `.bvh`/`.npy`/`.mp4`/`.blend` (no FBX). |
| **HY-Motion 1.0** (Tencent Hunyuan) | ✅ Open, self-host | Humanoid | Diffusion-Transformer + flow matching. Consumer GPU. BVH/FBX. |
| **Kimodo** (NVIDIA nv-tlabs) | ✅ Open, self-host | Human + robot skeletons (SMPL-X/SOMA) | Text + constraints. Ships a WebGL preview/timeline demo. → BVH/GLB. |
| **SayMotion** (DeepMotion) | ❌ Hosted/metered | Humanoid | Turnkey API. FBX/GLB/BVH/MP4. Fallback if self-hosting is too much. |

Mapping to our needs: **AnyTop = animals & monsters**, **HY-Motion / Kimodo =
humanoid worshippers**.

### 3D models (text/image → mesh, rigged, voxel-styled, glTF)

| Tool | Open? | Notes |
|---|---|---|
| **Meshy** | ❌ Hosted/metered | Auto-rigging + 500+ animation presets. **Voxel art style.** GLB/FBX/etc. ~1 min/gen. |
| **Tripo** | ❌ Hosted/metered | LEGO/voxel/cartoon styles, auto-animation. ~$0.01/credit, 2000 free credits. |
| **Rodin** | ❌ Hosted/metered | Highest quality (10B params, 4K textures), no auto-rig. |
| **Hunyuan3D / TRELLIS** | ✅ Open, self-host | Open equivalents if we want zero external dependency. |

### Adjacent / related work (for the captions + retrieval angle)
- **How to Move Your Dragon** (ICML 2025) — adds **text captions** to TrueBones and
  does text-to-motion for large-vocabulary objects. Releasing code + captions.
  Directly relevant to §3's caption→embed→retrieve loop.
- **MoCapAnything** (Dec 2025) — monocular video → motion for arbitrary skeletons
  (capture reference instead of prompt).
- **NECromancer** (Feb 2026), Semantic-Aware Motion Encoding (2026) — continuing the
  BVH-driven thread.

### FOSS runtime stack (browser side)
**three.js** (MIT) or **babylon.js** (Apache) render **glTF** (open Khronos
standard); rig/author in **Blender** (GPL). All generators above export glTF/BVH.
The whole runtime path can be fully FOSS.

---

## 3. The architecture the vision describes

What "Fate draws from a library, prompts for new when needed, caches the result" is,
precisely: **a semantic asset cache with a generate-on-miss fallback, orchestrated
by Fate.** It becomes a *third* layer alongside the existing two:

```
Sim layer       (always running, deterministic)
Narration layer (LLM, on attention)
Asset layer     (library + generator, on demand)   ← new
        ▲
       Fate orchestrates all three
```

### The rule that protects everything we've built
> **The library is the deterministic interface. Generation never touches the sim or
> replay path.**

Generation is slow (~1 min/mesh; seconds–minutes/motion), GPU-bound, and
non-deterministic. The sim and the snapshot/replay/scrub systems may **only ever
read already-realized assets** from the library. Generation is an async side-process
that *fills* it — the same shape as "narration backfills on attention," applied to
assets.

### Two-tier timing (mirrors the narration layer)
- **Author-time / between sessions:** Fate batch-pre-generates a base library. No
  latency pressure.
- **Runtime miss:** Fate must not block the game. It substitutes the closest library
  asset *now*, queues generation in the background, and swaps the better asset in the
  next time it's needed. Graceful degradation → async upgrade.

### Retrieval — the "if it finds something that works" part
1. Every asset carries a **caption + tags** (why "How to Move Your Dragon" captioned
   TrueBones).
2. **Embed** the request and the library; nearest-neighbor + a **similarity
   threshold**.
3. Above threshold → reuse. Below → generate, then **write back to the library** with
   its caption/embedding.
4. The cache **self-warms**: it fills with what Fate actually needs; generation
   frequency drops over time. Fate becomes an **asset director** — a clean extension
   of its existing pacing/escalation remit (ROADMAP Track 4).

### Replay-safety detail
Record the **chosen asset ID** into scenario/sim state. Do **not** re-run retrieval
non-deterministically on replay — bind the asset once, store the binding,
content-address generated results so replays stay stable.

### The library recurses (dependency order)
```
voxel/mesh (body) → rig (skeleton) → motion (clip) → scenario (composition)
```
Each is its own cache-or-generate library; Fate composes scenarios from the lower
ones. **Landmine: retargeting.** A motion clip is bound to a skeleton topology;
reusing across creatures needs shared skeletons or cross-topology retargeting —
exactly AnyTop's thesis. So AnyTop is both a *generator* and the *bridge* that makes
the motion library reusable instead of one-clip-per-creature.

---

## 4. The costs we won't hand-wave

1. **This is a renderer rewrite.** Canvas-2D iso → WebGL (three.js/babylon). The
   hard-won y-sort occlusion fix becomes *free* (z-buffer), but the iso projection,
   `renderer.ts`, and the sprite pipeline get rebuilt. Biggest single cost of the
   pivot — a deliberate decision, not a drift.
2. **Generation needs a service.** The browser tab can't run AnyTop/HY-Motion
   (CUDA/Python). There must be a **generation service** — our own GPU box behind a
   job queue, or hosted APIs — that Fate calls; the browser only ever downloads
   finished glTF. Real infra.
3. **The FOSS-vs-hosted fork.** Open generators (AnyTop, HY-Motion, Hunyuan3D) are
   free but need us to run a GPU. Easy ones (Meshy, Tripo, SayMotion) are
   pay-per-gen hosted APIs — not "licensed software," but not FOSS either. Decide
   deliberately.
4. **Iso-directional / rigging cost doesn't fully vanish.** 3D removes the
   *directional sprite* problem (one model, free rotation), but each creature still
   needs a body + rig, and generated rigs need cleanup/retarget validation.

---

## 5. Decision & next steps

- **Now:** keep building the underlying systems (Tracks 1–4) with **placeholders**
  (current flat iso diamonds / sprite stand-ins). Do **not** start the renderer
  rewrite or the gen-service yet.
- **This is three coupled commitments**, each its own future track:
  1. **WebGL renderer** (enabling infra, known shape),
  2. **Self-hosted generation service** (enabling infra),
  3. **Fate-driven asset library + retrieval** (the novel heart of the idea).
- **When picked up:** brainstorm → spec the **asset layer (3)** first — library
  schema, caption/embed/retrieve/threshold loop, generate-on-miss queue, the
  determinism boundary (asset-ID binding into scenario state), and Fate's
  asset-director role. Treat (1) and (2) as prerequisite tracks.

---

## Sources

- [AnyTop project page](https://anytop2025.github.io/Anytop-page/) ·
  [GitHub (MIT)](https://github.com/Anytop2025/Anytop) ·
  [arXiv 2502.17327](https://arxiv.org/abs/2502.17327)
- [How to Move Your Dragon](https://t2m4lvo.github.io/) (ICML 2025)
- [MoCapAnything](https://arxiv.org/abs/2512.10881) · [NECromancer](https://arxiv.org/html/2602.06548v1)
- [HY-Motion 1.0 (Tencent)](https://github.com/Tencent-Hunyuan/HY-Motion-1.0) ·
  Kimodo (NVIDIA nv-tlabs) · [SayMotion API (DeepMotion)](https://www.deepmotion.com/saymotion-api)
- [Meshy](https://www.meshy.ai/) · [Tripo](https://www.tripo3d.ai/) · Rodin
- Runtime/format: three.js (MIT), babylon.js (Apache), glTF (Khronos), Blender (GPL)
