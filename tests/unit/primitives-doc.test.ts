// tests/unit/primitives-doc.test.ts
// Phase B2: (a) the checked-in docs/PRIMITIVES.md is byte-in-sync with what the registry
// actually describes (regenerate → diff empty — the catalogue an authoring agent reads can
// never drift from the code that enforces it); (b) EVERY worked example under
// docs/primitives-examples/ passes the authorBlueprint gate AND composes non-empty geometry —
// the catalogue can never advertise a broken spec.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderPrimitivesDoc } from '../../scripts/generate-primitives-doc';
import { authorBlueprint, type AuthorInput } from '@/blueprint/authoring';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { composeStructure } from '@/assetgen/compose';

const DOC_PATH = 'docs/PRIMITIVES.md';
const EXAMPLES_DIR = 'docs/primitives-examples';

function exampleSpecs(): { name: string; input: AuthorInput }[] {
  const dir = resolve(EXAMPLES_DIR);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ name: f, input: JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as AuthorInput }));
}

describe('docs/PRIMITIVES.md is in sync with the registry', () => {
  it('the checked-in doc equals freshly generated output (regenerate → diff empty)', () => {
    const fresh = renderPrimitivesDoc();
    const onDisk = readFileSync(DOC_PATH, 'utf8');
    expect(fresh).toBe(onDisk);
  });

  it('the doc is deterministic (two render calls are byte-identical)', () => {
    expect(renderPrimitivesDoc()).toBe(renderPrimitivesDoc());
  });
});

describe('worked examples under docs/primitives-examples/', () => {
  const specs = exampleSpecs();
  it('discovers at least 5 worked examples', () => {
    expect(specs.length).toBeGreaterThanOrEqual(5);
  });

  it.each(specs.map((s) => [s.name, s.input] as const))('%s passes the authorBlueprint gate', async (_name, input) => {
    const r = authorBlueprint(input);
    expect(r.ok, `gate rejected: ${r.summary}`).toBe(true);
  });

  it.each(specs.map((s) => [s.name, s.input] as const))('%s composes NON-EMPTY geometry', async (_name, input) => {
    const r = authorBlueprint(input);
    expect(r.ok, `gate rejected before compose: ${r.summary}`).toBe(true);
    const rb = r.rb!;
    const spec = toGeometry(rb);
    const s = await composeStructure(spec, undefined, {});
    expect(s.bbox.w, 'opaque width must be > 0').toBeGreaterThan(0);
    expect(s.bbox.h, 'opaque height must be > 0').toBeGreaterThan(0);
  });
});
