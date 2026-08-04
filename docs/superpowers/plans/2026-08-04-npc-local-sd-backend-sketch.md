# Phase L — a local Stable Diffusion backend (SKETCH)

**Status: sketch, no code.** This is the deliverable the epic plan asked for —
*"SLICE SKETCH ONLY — planned in detail when someone wants it; nothing in M/C/G
depends on it."* It is written down now so the shape is on record while the
`SpriteBackend` seam is fresh, and so that whoever wants it later starts from a
decision list rather than a blank file.

**Why no code.** A backend is a claim about what a remote endpoint does. Every
other backend in `src/assetgen/compilers/` was written against an API someone
had actually called: PixelLab's pixflux endpoint, the qwen edit model on
Replicate, the OpenRouter image route. Nobody here has run ComfyUI or A1111
against this repo, so a `local-sd-backend.ts` today would declare
`SpriteBackendCapabilities` — the very table the pipeline trusts to decide
whether art is reproducible — from documentation rather than from behaviour.
That is the one thing this seam exists to prevent (see `backend.ts`'s header:
*"the backends do not have the same powers, and pretending otherwise would be
the bug"*). The sketch is the honest artifact until someone has a local
instance to point at.

## What it would be worth

The zero-provider endgame. Everything in Phase G routes through a hosted model,
which means the seeded library is the only thing a player ever sees for free
(`liveNpcArtEnabled` is off, and it stays off precisely because live generation
costs money per NPC). A local backend changes the economics rather than the
architecture: the same `SpriteJob` goes to a GPU the user already owns, so
live-on-miss generation becomes affordable to *offer*, and an author can iterate
on prompts without a bill per attempt.

It is also the only backend that could make the seed real. Per G0's header, every
img2img editor we ship declares `seed: false`, so `npcSheetSeed` currently
travels the whole pipeline and reaches nothing. A local sampler takes a seed.

## Decisions to make before writing a line

1. **`AssetProvider` needs a `'local'` member** (`src/core/types.ts:913`). That
   union is PERSISTED provenance — it is written into IndexedDB records and into
   the vendored manifest, and it outlives everyone who could correct it. Adding
   a member is cheap; getting it wrong is not. Name it for what it is (`'local'`
   is honest; `'comfyui'` or `'sd'` bets on a stack).
2. **Which local API.** They are not interchangeable:
   - **A1111 / Forge `/sdapi/v1/img2img`** — one POST, base64 in and out, takes
     `seed`, `denoising_strength`, `negative_prompt`, `width`/`height`. It maps
     onto `SpriteJob` almost field for field, which makes it the cheapest first
     target by a wide margin.
   - **ComfyUI `/prompt`** — submits a graph, polls `/history`, fetches images.
     More capable, and the graph is a JSON document the repo would then own and
     version. Better second step; a bad first one.
   The recommendation is A1111-shaped first, with the client behind the same
   `generateFn`-style injection `img2img-backend.ts` already uses so a ComfyUI
   variant slots in without touching the pipeline.
3. **How the endpoint is configured.** Through the existing settings surface —
   the agent-driven UI system, Commands + affordances + UiSpec, **no bespoke
   panel** (standing user directive). One field: a base URL. Absent ⇒
   `SpriteBackendUnavailableError` by name, exactly like a missing PixelLab key.
4. **What the capability table actually says**, measured not assumed. The
   expectation is `{ init: 'optional', seed: true, size: true, denoise: true,
   negative: true, abort: true }` — the first backend for which `unsupportedJobFields`
   would return nothing. Verify each one against a running instance before
   writing it down; a `seed: true` that turns out to be false is worse than no
   backend, because the pipeline would record unreproducible art as reproducible.

## The determinism note, recorded now so it is not discovered later

Local SD with a fixed seed, sampler, scheduler and step count is reproducible
**on one machine**, not across GPUs — different CUDA/Metal kernels and different
attention implementations move the last bits. This is acceptable here and the
reason is structural, not a shrug: **the library is the deterministic interface,
not the generator** (spec contract 1). A seeded sheet that lands in
`public/asset-library/npc-sprites/` is thereafter a file, byte-identical for
every player forever. Reproducibility is only needed at the moment of
authoring — to re-roll a variant, to bisect a prompt change — and that happens
on one author's machine.

The corollary is a rule for whoever builds this: a local backend is an
**authoring** backend first. Wiring it to live-on-miss generation for players is
a separate decision with its own consequences (a player's sheet would differ from
the shipped one, which is a support burden and a licensing question), and it
should not ride in on the same commit.

## What we bundle

Nothing. No weights, no Python, no model downloads, no bundled runtime. The user
runs their own instance; we send it a job. That keeps the repo's size, its
licence surface and its install story exactly where they are.

## Scope of the eventual slice

- `src/core/types.ts` — one union member.
- `src/assetgen/compilers/local-sd-backend.ts` — the backend, injectable client.
- `src/assetgen/compilers/backend-registry.ts` — one case, refusing by name when
  no endpoint is configured.
- `availableProviders` — one line, so a settings surface never offers a backend
  it cannot run.
- Settings: one URL field, through the agent-driven UI system.
- `tests/unit/` — capability declaration, refusal without an endpoint, a mocked
  round trip. **No test may reach a network**, local or otherwise.

Everything above `SpriteBackend` — the pipeline, the gates, the seeder, the
runtime source — is untouched. That is the point of having built the seam first.
