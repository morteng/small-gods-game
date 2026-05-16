---
name: world-seed
description: Create or validate a world seed JSON file for map generation
disable-model-invocation: true
---

Create or validate world seed: $ARGUMENTS

## Schema Reference

Read `src/core/schema.ts` for validation rules and `public/data/worlds/default.json` for the canonical example.

Key constraints:
- **Size**: width/height 16-512
- **Biomes**: temperate, desert, arctic, tropical, volcanic, swamp, highland
- **POI types**: village, city, castle, forest, lake, mountain, farm, port, ruins, temple, mine, tavern, tower, bridge, crossroads, swamp, desert, volcano, glacier, oasis, plains
- **Connection types**: road, river, wall (styles: dirt, stone, bridge; width: 1-3)
- **Constraints**: roads_connect_all_settlements, ports_require_coast, villages_near_water, etc.

## Creating a New Seed

1. Read the default seed for structure reference
2. Build a seed matching the requested characteristics
3. Validate using the rules from `schema.ts` (all POIs need id+type+position/region, connections reference valid POI ids)
4. Save to `public/data/worlds/<name>.json`
5. Run `npm test` to verify nothing breaks

## Validating an Existing Seed

1. Read the seed file
2. Check against all validation rules from `schema.ts`
3. Report any errors with specific field paths
