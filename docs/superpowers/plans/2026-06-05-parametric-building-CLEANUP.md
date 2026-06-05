# Parametric Building — deferred cleanup

The descriptor system (2026-06-05) replaced BuildingTemplate but kept the old
machinery as a compat layer. Delete it once **every building entity carries a
descriptor and no symbol imports `BuildingTemplate`**.

Find remaining work: `grep -rn "building-descriptor-cleanup\|BuildingTemplate\|BuildingInstance" src`

- [ ] Delete `src/map/building-templates.ts` (types + `BUILDING_TEMPLATES` + helpers).
- [ ] Remove the template/sprite fallback branch in `src/render/renderer.ts` `drawEntity`.
- [ ] Remove `BuildingInstance` from `src/core/types.ts` and `GameMap.buildings` once nothing reads it
      (check `src/map/map-generator.ts` legacy mirror + `tests/**/place-settlement*`).
- [ ] Remove `properties.templateId` writes/reads (descriptor is authoritative).
- **Done-when:** `grep -rn "BuildingTemplate" src` returns nothing.

## Deferred integration gaps (from final review 2026-06-05)

- [ ] **Iso renderer not migrated.** `src/render/iso/iso-renderer.ts` iterates the legacy
      `GameMap.buildings` (`BuildingInstance[]`) mirror, populated only at worldgen. Runtime
      `place_building` buildings and any non-legacy preset (yurt/longhouse/shrine/guard_post,
      no `BuildingTemplate` → 1×1 footprint default) render wrong or not at all in iso mode.
      Migrate iso to read building entities + `properties.descriptor` like the topdown path
      (`renderer.ts` drawEntity), or drive it from `building-massing` in iso space.
- [ ] `computeGroundMaterialField` (`src/render/ground-material.ts`) does a full `world.query({})`
      scan every frame — cache/invalidate-on-building-change if building counts grow.
- [ ] `place_building` registry `targetKind: 'settlement'` is documentation-only for the
      authoring tier (executor short-circuits to precondition); the verb also accepts `at`/`none`.
