# LLM Authoring — Small Gods parametric modeling

The contract an AI agent (dev harness, MCP-connected player agent, in-game Fate author, or a
human) follows to author *believable, working* game geometry through the deterministic
blueprint pipeline — instead of hand-editing imperative manifold-3d geometry code.

- **The catalogue you author against:** `docs/PRIMITIVES.md` (generated; never edit by hand —
  it is regenerated from the registry by `scripts/generate-primitives-doc.ts`).
- **Worked, verified examples:** `docs/primitives-examples/*.json` — every file there is a real
  `AuthorInput` that passes the gate AND composes non-empty geometry (pinned by
  `tests/unit/primitives-doc.test.ts`), so the catalogue can never advertise a broken spec.
- **The engine:** `manifold-3d` (WASM CSG), reached **only** through the blueprint →
  `toGeometry` → `composeStructure` path. You write **Blueprints** (data); the code does the solids.

## The one-line rule

**Write a Blueprint (or name a preset + optional patches/descriptors). Never hand-write the
compose-level `Part[]` list.** `Part[]` (box/cylinder/arch/…, the compile target in
`src/assetgen/compose.ts`) is produced by `toGeometry` from your Blueprint; authoring it
directly bypasses every gate and is out of scope.

## The authoring loop (Phase B0)

Feed a spec JSON (a preset name, a hand-authored Blueprint, or patches/descriptors) through
the SAME gate the game uses, get a sprite + diagnostics back, revise.

```bash
npx tsx scripts/author-preview.ts spec.json                           # gate + render + text stats
npx tsx scripts/author-preview.ts spec.json --map normal              # dump normal map instead of grey
npx tsx scripts/author-preview.ts spec.json --montage                 # also write the multi-yaw montage
npx tsx scripts/author-preview.ts spec.json --json                    # machine-parseable JSON only
npx tsx scripts/author-preview.ts --catalogue                         # print the authorable catalogue
```

`spec.json` is an `AuthorInput`: `{ "preset": "cottage" }`, or a hand-authored
`{ "blueprint": { version, class, footprint, parts, materials, … } }`, or patches/descriptors
over a preset. See `docs/primitives-examples/*.json` for real shapes.

## Gate semantics — the ONE flag to branch on

`authorPreview` runs `authorBlueprint` (resolve → validate → lint) **then** the structure-stage
audit (Phase B1: bbox vs sprite budget, z<0 ground penetration, openings-with-no-wall,
mount-anchor projection, massing facts), and merges both into one severity-ordered report.
The process exit code is how an agent loop decides:

| exit | meaning | action for an agent loop |
|---|---|---|
| `0` | authored + composed cleanly | **commit** the spec (it will render) |
| `1` | gate rejected (blueprint lint ERROR **or** structure audit ERROR) | read the report (`.lints` + `.audits` / `merged`), **fix and retry** |
| `2` | usage error / unreadable or malformed spec JSON | fix the invocation / file |

Anything `info`/`warn` prints but does not fail. Errors fail. An agent never ships past an
`ok === false` (the game's `authorBlueprint` rejects broken assets the same way).

## Measuring fit to the ground (Phase B3)

Answer "does this structure actually sit on that terrain?" — ground clearance per footprint
cell, max slope, mount-socket heights vs the drawn ground, and a best-effort neighbour probe.

```bash
npx tsx scripts/measure-structure-fit.ts spec.json x y [--seed N] [--json]
```

Deterministic for a fixed spec + seed. Same exit-code contract (0 measured / 1 spec rejected
by the gate / 2 usage). Occlusion only reflects building entities the sampled world has
realised (a settled/snapshot world, not the light terrain-only default).

Prints an INFORMATIONAL **span report** beside clearance/slope: the clear span across the
footprint vs the class envelope (deck/arch/timber/stone — `--class` overrides the blueprint
inference) plus a cheap sag proxy — an ASCE Bridge Designer crossover, so an author sees
whether a crossing reads as an *engineered span* or a *lintel in the void*. Span is advisory
only and never changes the exit code. Spec:
`docs/superpowers/specs/2026-08-07-structure-validity-authoring-spec.md`.

## Preview ≠ in-game truth

The previews are headless `composeStructure` renders — deterministic and correct for
**geometry massing**, but they skip lighting, terrain-interplay and the draw cache. The
authoring loop verifies *shape*; in-game gallery/grabs remain the tool for *lighting*. Don't
treat a pixel-perfect headless preview as a promise about in-game lighting.

## Spine — spend policy: `$0`

Every phase of this authoring loop is **local and deterministic**. No paid generation, no
network, no images-via-API anywhere in the path. `authorBlueprint` + `composeStructure` are
pure functions of your spec + seed. If a preview step ever looks like it wants to call a paid
model (img2img painting on the runtime building-art path), that is a SEPARATE, deliberately
opt-in feature and is irrelevant to authoring correctness — geometry never depends on it.

## When you change geometry — the golden/version contract (DR-7)

The deterministic G-buffer is hash-pinned by `tests/unit/assetgen-golden.test.ts`. Any
geometry-affecting change flips those hashes. Do it in ONE commit, together:

1. Make the geometry change.
2. Run `tests/unit/assetgen-golden.test.ts` — on mismatch it prints the updated expected
   values. Paste them in (the file's header + per-`it` comments explain what moved and why).
3. **Bump `ART_RECIPE_VERSION`** in `src/core/content-version.ts` (**read the current value
   from that file; never guess**) and bump the paired content/`NPC_ART_RECIPE_VERSION`-style
   constant if the change touches NPC or shared art, and update any content-version guard test.
4. Re-run the golden test → green.

Do NOT bump the version or repin goldens for doc-only / catalog changes (B2-style `doc:`
strings), previews, or measurement tooling — those don't change geometry. Scripts themselves
are not golden-pinned. If in doubt: does the rendered `grey`/`normal`/`material`/`emissive`
byte stream change for an existing spec? If yes → golden + version bump. If no → you're done.

Also: keep `npm run lint` at zero, keep `src/blueprint/` import-cycle-free, and keep everything
`Math.random`-free/seeded so the same spec ⇒ byte-identical output.

## Where the pieces live

| concern | path |
|---|---|
| Authoring gate (resolve/validate/lint) | `src/blueprint/authoring.ts`, `src/blueprint/lint.ts` |
| Registry = the catalogue source of truth | `src/blueprint/registry.ts`, `src/blueprint/describe-registry.ts`, `src/blueprint/parts/*`, `src/blueprint/features/*` |
| Blueprint → `Part[]` | `src/blueprint/compile/to-geometry.ts` |
| Solids → sprite + mesh (shared, can't drift) | `src/assetgen/compose.ts`, `src/assetgen/structure-mesh.ts` |
| Structure-stage audit (B1) | `src/blueprint/audit-structure.ts` |
| Previews | `scripts/author-preview.ts`, `scripts/measure-structure-fit.ts` |
| Golden-hash pin | `tests/unit/assetgen-golden.test.ts` |
| Version constants | `src/core/content-version.ts` |
| Generated catalogue | `docs/PRIMITIVES.md` + `scripts/generate-primitives-doc.ts` |

---

## Suggested ROADMAP entry (for the ROADMAP editor — not applied here)

```
### Track: LLM-authorable modeling (S<N>) — DONE
An LLM (dev harness / MCP / in-game Fate) now authors game geometry as validated Blueprints
with a deterministic feedback loop instead of hand-edited manifold-3d code.
- B0 author-preview loop (spec → gate → sprite + diagnostics; exit 0/1/2) ✔
- B1 structure-stage audit (bbox, z-penetration, openings, mount sockets, massing) ✔
- B2 complete registry catalogue + generated docs/PRIMITIVES.md + 8 worked examples
  pinned to pass-the-gate-and-compose (sync test) ✔
- B3 measurement: spec↔terrain fit (clearance, slope, sockets, occlusion probe) ✔
- B4 archetype vocabulary — NO new geometry: the masonry wall/parapet/crenellation vocab
  (barrier part + body.parapet) was already authorable; documented + example only ✔
- B5 policy: this file (LLM-AUTHORING.md) — authoring loop, gate, golden/version contract,
  $0 spend policy ✔
Deferred: MCP/dev meta-verb wrapping measurement (verb names are API — pending product sign-off).
```
