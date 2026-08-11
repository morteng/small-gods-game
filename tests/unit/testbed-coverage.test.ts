// tests/unit/testbed-coverage.test.ts
//
// WP-T3 — REGISTRY COVERAGE GATE for the testbed's specimen ground (WP-T2's
// `src/world/testbed/specimens.ts`). Generates the testbed world headlessly ONCE
// (`beforeAll`) and asserts that every renderable catalogue entry — building preset,
// preset-less buildingType, flora species, engine BarrierKind, bridge recipe, stair
// preset — has AT LEAST ONE specimen entity standing for it in the generated world.
//
// ── THIS TEST IS WRITTEN TO THE REAL CONTRACT, NOT TODAY'S NUMBERS ────────────────
// Measured today (WP-T1 baseline, `src/world/testbed/testbed-world.ts`'s own header):
// `placeSpecimens` reports `placed=82 failed=37` of 119 specimen slots (118 unique
// registry ids — see the `palisade` note below) because the apron cannot yet fit the
// full catalogue. WP-T2 is CONCURRENTLY densifying `specimens.ts`'s flow layout to
// close that gap. Until it lands, several `it()`s below are RED — that is EXPECTED
// and CORRECT: a coverage test pinned to "82 of 119" would silently stop catching
// regressions the day coverage actually improves. Full coverage (`failed.length === 0`)
// is the target; do not lower these assertions to match today's shortfall.
//
// ── WHY THIS IS A REAL ACCEPTANCE CHECK, NOT A PROXY ───────────────────────────────
// Every assertion below reads `SpecimenReport.placed` — the actual entities
// `placeSpecimens` registered on the live `World` after a real `generateWithNoise`
// call, through the SAME registration path organic placement uses (blueprint →
// `blueprintEntity` → `world.addEntity`; barrier preset/kind → `placeBarrier` →
// `map.barrierRuns`). No id is hand-listed here either: every expected-id list below
// is read from the same live registries `specimens.ts` reads from
// (`BUILDING_BLUEPRINTS`, the catalogue, `FLORA_FACTS`, `BARRIER_DEFAULTS`,
// `bridgePresetNames()`), so a new catalogue entry needs zero edits here to be
// covered by the gate — and a missing one is named, not just counted (a bare "37
// failed" told nobody which 37).
import { describe, it, expect, beforeAll } from 'vitest';
import { planWorldLayout } from '@/world/poi-layout';
import { generateWithNoise } from '@/map/map-generator';
import { testbedSeed, TESTBED_GEN_SEED } from '@/world/testbed/testbed-world';
import { placeSpecimens, type SpecimenReport } from '@/world/testbed/specimens';
import { BUILDING_BLUEPRINTS, isBridgePreset, bridgePresetNames } from '@/blueprint/presets';
import { FLORA_FACTS } from '@/flora/flora-facts-data';
import { loadDefaultPacks } from '@/catalogue/default-packs';
import { catalogue } from '@/catalogue/pack';
import { BARRIER_DEFAULTS, type BarrierKind } from '@/world/barrier';
import type { GameMap } from '@/core/types';

let report: SpecimenReport;
let map: GameMap;

beforeAll(async () => {
  loadDefaultPacks();
  const seed = testbedSeed();
  const layout = planWorldLayout(seed);
  const laid = { ...seed, size: layout.size, pois: layout.pois, connections: layout.connections };
  const gen = await generateWithNoise(
    layout.size.width, layout.size.height, TESTBED_GEN_SEED, laid, { onProgress() {} },
  );
  map = gen.map;
  // The bootstrap call site (`bootstrap-world.ts`) runs this immediately after
  // `generateWithNoise`, dev-gated + dynamic-imported — calling it directly here is
  // the same pass on the same inputs, just without the dev-flag/import indirection a
  // headless test has no use for.
  report = placeSpecimens(map, gen.world, { quiet: true });
  // 300s, not the ~15-25s `testbed-world.ts` measures in isolation: this box runs
  // several concurrent worktree agents sharing CPU (measured 207s once under
  // contention from a sibling agent's own dev server + tsx script) — a tight budget
  // here is a flake, not a regression signal.
}, 300_000);

/** Assert every id in `ids` has at least one placed specimen entity, naming every
 *  miss — a bare count tells the next person nothing (the brief's own words). */
function expectCoverage(ids: string[], label: string): void {
  const missing = ids.filter((id) => !(report.placed.get(id)?.length));
  expect(missing, `${label}: ${missing.length}/${ids.length} missing — ${missing.join(', ') || '(none)'}`)
    .toEqual([]);
}

// PROOF THE TEST CAN FAIL (per the WP-T3 brief): `expectCoverage(['__nonexistent_specimen_id__'], 'probe')`
// was run locally and failed with:
//   "probe: 1/1 missing — __nonexistent_specimen_id__"
// i.e. the assertion message names the exact missing id, not just a count. That temporary
// line was removed before this commit — it is not part of the committed suite.

describe('testbed specimen coverage (WP-T3)', () => {
  it('stands up every BUILDING_BLUEPRINTS preset', () => {
    const ids = Object.keys(BUILDING_BLUEPRINTS).filter((n) => !isBridgePreset(n) && !n.startsWith('bridge-'));
    // Pinned so a registry-shape change (not just a count drift) is loud here too.
    expect(ids.length, 'BUILDING_BLUEPRINTS non-bridge preset count drifted from 56 — update this pin').toBe(56);
    expectCoverage(ids, 'BUILDING_BLUEPRINTS presets');
  });

  it('stands up every preset-less catalogue buildingType (the generative bridge)', () => {
    const ids = catalogue.all('buildingType').map((e) => e.id).filter((id) => !(id in BUILDING_BLUEPRINTS));
    expect(ids.length, 'preset-less buildingType count drifted from 5 — update this pin').toBe(5);
    expectCoverage(ids, 'preset-less buildingTypes');
  });

  it('stands up every FLORA_FACTS species', () => {
    const ids = FLORA_FACTS.map((s) => s.id);
    expect(ids.length, 'FLORA_FACTS count drifted from 43 — update this pin').toBe(43);
    expectCoverage(ids, 'FLORA_FACTS species');
  });

  it('stands up every engine BarrierKind, each with at least one gate', () => {
    const kinds = Object.keys(BARRIER_DEFAULTS) as BarrierKind[];
    expect(kinds.length, 'BarrierKind count drifted from 6 — update this pin').toBe(6);
    expectCoverage(kinds, 'BarrierKind runs');
    for (const kind of kinds) {
      const entityIds = report.placed.get(kind);
      if (!entityIds?.length) continue; // already reported as missing above
      const runs = (map.barrierRuns ?? []).filter((pb) => entityIds.includes(pb.id));
      expect(runs.length, `barrier kind '${kind}': no committed BarrierRun for its placed entity`).toBeGreaterThan(0);
      for (const pb of runs) {
        expect(pb.run.gates.length, `barrier kind '${kind}' (run ${pb.id}): no gate`).toBeGreaterThan(0);
      }
    }
  });

  it('stands up every bridge recipe', () => {
    const ids = bridgePresetNames();
    expect(ids.length, 'bridge recipe count drifted from 9 — update this pin').toBe(9);
    expectCoverage(ids, 'bridge recipes');
  });

  it('stands up every stair preset', () => {
    const ids = Object.keys(BUILDING_BLUEPRINTS)
      .filter((n) => Object.values(BUILDING_BLUEPRINTS[n].parts ?? {}).some((p) => p.type === 'stair_flight'));
    expect(ids.length, 'stair preset count drifted from 4 — update this pin').toBe(4);
    expectCoverage(ids, 'stair presets');
  });

  // `palisade` is BOTH a `class:'barrier'` preset name (row 6, `barrierPresets`) AND an
  // engine `BarrierKind` (row 7, `barrierKinds`) — two different registries that happen
  // to share a string. `specimens.ts` places one run for EACH row under the identical
  // `id:'palisade'`, so `report.placed.get('palisade')` legitimately holds TWO entity
  // ids: 118 unique registry ids across all rows → 119 placed entities when both fully
  // cover. Expect this; it is not a bug to "fix" (see the WP-T3 brief).
  it('"palisade" (barrier preset name AND BarrierKind) carries two distinct entities', () => {
    const ids = report.placed.get('palisade');
    expect(ids, '"palisade" has no placed entities at all').toBeDefined();
    if (!ids) return;
    expect(ids.length, `"palisade" should carry 2 entities (preset row + BarrierKind row), got ${ids.length}`).toBe(2);
    expect(new Set(ids).size, 'the two "palisade" entities must have distinct entity ids').toBe(2);
  });

  it('reports the measured totals (documents the current state, not a pass/fail gate)', () => {
    // Informational only — logs today's numbers so a CI reader sees the real state
    // without having to re-run the pass. Not an assertion: see the header note on why
    // this suite is pinned to the CONTRACT, not to today's shortfall.
    // eslint-disable-next-line no-console
    console.log(
      `[testbed-coverage] placed=${report.placed.size} failed=${report.failed.length} `
      + `overflowRows=${report.overflowRows} warnings=${report.warnings.length}`,
    );
    if (report.failed.length) {
      // eslint-disable-next-line no-console
      console.log(`[testbed-coverage] failing ids: ${report.failed.map((f) => `${f.id}(${f.row})`).join(', ')}`);
    }
    expect(report.rect, 'the specimen_apron POI must resolve to a rect').not.toBeNull();
  });
});
