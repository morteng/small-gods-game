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
