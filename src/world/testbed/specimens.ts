// src/world/testbed/specimens.ts
//
// ⚠ STUB — WP-T1 owns the CALL SITE (`src/game/bootstrap-world.ts`), WP-T2 owns the
// CONTENTS. This file exists so the dev-gated post-generation hook can be wired and
// typed now while the specimen ground is built in parallel; WP-T2 replaces the whole
// body at integration. Do not grow it here.
//
// The real pass places one specimen of every renderable catalogue entry (blueprint
// presets, preset-less building types, flora species, barrier kinds with gates, bridge
// recipes, stairs) on the testbed's `specimen_apron` region — a flat reserved region POI
// authored by WP-T1, whose rect must be resolved from the world's LAID-OUT POIs at
// runtime, never hardcoded.
//
// Its purpose is render / grade / scale coverage, NOT siting coverage: specimens are
// exempt from siting believability judgements, and a green testbed is never evidence
// that a siting fix works.
//
// Contract WP-T2 must keep (all three are house rules, not preferences):
//   • entities enter through the SAME registration path organic placement uses;
//   • entity x/y/kind/tags are mutated ONLY via `World.updateEntity()` (dual index);
//   • any in-place `tile.type` write calls `bumpTilesRev(map)` (`src/core/tile-rev.ts`);
//   • no `Math.random` — a grid layout needs none;
//   • idempotent: running it twice must leave identical specimen positions.

import type { GameMap } from '@/core/types';
import type { World } from '@/world/world';

/**
 * Place one specimen of every renderable catalogue entry on the testbed's specimen
 * apron. STUB: no-op until WP-T2 lands.
 */
export function placeSpecimens(_map: GameMap, _world: World): void {
  /* WP-T2 */
}
