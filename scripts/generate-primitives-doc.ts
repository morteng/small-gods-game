// scripts/generate-primitives-doc.ts
// Phase B2: generate docs/PRIMITIVES.md from the LIVE blueprint registry
// (describeRegistry/formatCatalogue) plus a hand-authored preamble. The checked-in
// doc must match generator output exactly — pinned by tests/unit/primitives-doc.test.ts
// (regenerate → diff empty), so the catalogue an authoring agent reads can never drift
// from the code that enforces it.
//
// Run:
//   npx tsx scripts/generate-primitives-doc.ts        # (re)write docs/PRIMITIVES.md
//
// Deterministic: stable registry ordering, no timestamps, no absolute paths.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { formatCatalogue } from '../src/blueprint/describe-registry';
import { ensureBuildingTypesRegistered } from '../src/blueprint/register-buildings';

/** Hand-authored preamble. Editing this changes the generated doc; keep tests/diff in sync. */
const PREAMBLE = `# Small Gods — Authoring PRIMITIVES (LLM authoring reference)

> This file is **generated**: the preamble below is hand-authored; everything after the
> "Capability catalogue" header is derived live from the blueprint registry by
> \`scripts/generate-primitives-doc.ts\` and pinned in-sync by
> \`tests/unit/primitives-doc.test.ts\`. An agent given ONLY this file should be able to
> author a spec that passes the preview gate.

## How to author — the one-line rule

**Write a Blueprint (or name a preset + optional patches/descriptors). Never hand-write the
compose-level \`Part[]\` list.** The registry turns your Blueprint into an \`AuthorInput\`,
which \`authorBlueprint()\` resolves → validates → lints, and which \`scripts/author-preview.ts\`
then composes to a real sprite + diagnostics. The \`Part[]\` solids (box/cylinder/arch/…)
are the **compile target** that \`to-geometry.ts\` produces; authoring them directly bypasses
the gate and is out of scope. See the primer below for the blueprint vocabulary.

## Units contract

- **1 tile = 2 metres** (the metric scale contract; \`mToTiles\` in \`render/scale-contract.ts\`).
- Feetprints (\`footprint.w/h\`, part \`size.w/h\`) are in **tiles**.
- Vertical \`z\` is in **cube-units** (= metres here), so a wall storey is \`levels × storeyM\`.
- Part \`at\`/features \`face\` are in the **structure-local** tile frame; the composer
  projects them through the terrain iso fit — your job is the local shape, not screen space.
- Themes are deterministic: same spec ⇒ byte-identical sprite and audit.

## Layering: what vocab do I have?

A Blueprint is: \`class\` + \`footprint\` + ordered \`parts\` (each a registry part type with
\`at/size/params/features\`), a \`materials\` map, optional \`palette\`, \`descriptors\`,
\`stage\`, \`category\`, \`notes\`. Every part/feature \`type\` and its \`params\` are enumerated
in the generated catalogue below — that is your legal knob set.

- **Descriptors** (qualitative direction, folded in by \`descriptors.ts\`):
  - \`wealth\`: destitute → poor → modest → comfortable → rich → opulent (shifts materials + glazing).
  - \`quality\`: crude → plain → fine → ornate.
  - \`condition\`: pristine → lived_in → worn → dilapidated.
  - \`style\`: era/programme flavour when the preset knows one.
- **Materials** by role — walls: \`mud wattle timber log brick stone marble hide\`;
  roof: \`thatch wood tile slate hide none\`; ground: \`flagstone dirt packed_dirt wood tile gravel\`.
- **Masonry \`work\`** (on \`body\`/walls): \`coursed_rubble\`, \`ashlar\`, \`dry_stone\`, \`running\`
  brick, plaster finish — picked automatically from material, thickness and crenellation.
- **Lifecycle \`stage\`**: buildings run \`complete → fire_damaged → ruin → burnt → old_ruin\`;
  \`stage\` rides the resolve identity (its painter/validity check) — geometry compose still
  reflects the base massing. **Descriptors \`condition\`/a lowered \`quality\` are what believably
  "ruined-read" a build through this deterministic pipeline.**

## Worked examples

Every file under \`docs/primitives-examples/\` is a real \`AuthorInput\` that passes the gate AND
composes non-empty geometry — pinned by the sync test. Point a preview at any of them:

\`\`\`
npx tsx scripts/author-preview.ts docs/primitives-examples/cottage.json
npx tsx scripts/author-preview.ts docs/primitives-examples/townhouse.json --json
\`\`\`

## Capability catalogue

\`\`\`
`;

/** Render the FULL markdown (preamble + generated catalogue) — pure + deterministic. */
export function renderPrimitivesDoc(): string {
  ensureBuildingTypesRegistered();
  return PREAMBLE + formatCatalogue() + '\n```\n';
}

const here = dirname(fileURLToPath(import.meta.url));
export const PRIMITIVES_DOC_PATH = join(here, '..', 'docs', 'PRIMITIVES.md');

/** CLI entry: write docs/PRIMITIVES.md in place. */
export function runGeneratePrimitivesDoc(outPath = PRIMITIVES_DOC_PATH): string {
  const doc = renderPrimitivesDoc();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, doc, 'utf8');
  return doc;
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  const doc = runGeneratePrimitivesDoc();
  console.log(`wrote ${PRIMITIVES_DOC_PATH} (${doc.length} bytes)`);
}
