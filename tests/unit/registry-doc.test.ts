// tests/unit/registry-doc.test.ts
// Phase B2 — the capability catalogue is complete: describeRegistry() runs, is non-empty,
// and every emitted param spec carries a non-empty `doc` line an authoring LLM can read.
// Pure harness — no geometry, no golden pins. This is the "verify each edit compiles /
// docs present" guard the B2 plan calls for.
import { describe, it, expect } from 'vitest';
import { describeRegistry, type ParamDoc } from '@/blueprint/describe-registry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';

// The registries are populated lazily; the catalogue is only non-empty once built.
ensureBuildingTypesRegistered();

describe('registry capability catalogue (B2)', () => {
  it('describes a non-empty set of parts and features', () => {
    const cat = describeRegistry();
    expect(cat.parts.length).toBeGreaterThan(0);
    expect(cat.features.length).toBeGreaterThan(0);
  });

  it('every emitted param spec carries a non-empty doc string', () => {
    const cat = describeRegistry();
    const all: ParamDoc[] = [
      ...cat.parts.flatMap((p) => p.params),
      ...cat.features.flatMap((f) => f.params),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(p.doc, `${p.name} (${p.kind}) should carry a doc`).toBeTruthy();
    }
  });

  it('has docs on both well-populated and thin part types', () => {
    const cat = describeRegistry();
    // Every part and feature type must expose at least one documented param — a type with
    // zero params (e.g. `well`) is fine, but any type that HAS params must document them.
    for (const pt of cat.parts) {
      for (const p of pt.params) expect(p.doc, `${pt.type}.${p.name}`).toBeTruthy();
    }
    for (const ft of cat.features) {
      for (const p of ft.params) expect(p.doc, `${ft.type}.${p.name}`).toBeTruthy();
    }
  });
});
