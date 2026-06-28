// src/world/connectome/entrance-stoops.ts
//
// The OUTDOOR-ARCHITECTURAL stair siter (kit "stairs = one generator, three siting
// authorities" — the entrance/site authority, beside G3b's terrain-grade one). Where a
// building's main door sits proud of the ground it faces — a hall on a hillside pad, a
// temple on a natural rise — the connectome wants a PERRON / STOOP: a short flight from
// grade up to the threshold. This realizes it. For each building it reads the grade drop
// between its pad and the ground a couple tiles out its door; a real drop earns a
// `stair_flight` stoop, footed at grade and climbing to the door, in the building's own
// wall material. Flush-sited buildings (the common case) get none — steps appear only where
// the terrain actually demands them, exactly like the road stairs pop out of over-grade runs.
//
// Pure + deterministic (returns Entity[], inline blueprints seed identically, buildings
// iterated in id order); the caller adds them at world-build time beside the road stairs.

import type { Entity } from '@/core/types';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { blueprintEntity, blueprintOf } from '@/blueprint/entity';
import { resolveBlueprint } from '@/blueprint/resolve';
import { toAnchors } from '@/blueprint/compile/to-anchors';
import { stairFootprint } from '@/blueprint/parts/stair';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

/** Below this the threshold is ~flush — no steps (just a doorstep). */
const MIN_STOOP_RISE_M = 0.8;
/** Above this it's a retaining-wall/embankment problem, not a stoop — leave it. */
const MAX_STOOP_RISE_M = 4;
/** How far out from the door the outside grade is read (tiles). */
const PROBE_TILES = 2;
const STOOP_WIDTH_M = 1.6;
const STOOP_CONSTRUCTION = 0.7;   // a dressed perron at a civic/house doorway

export interface EntranceStoopOptions {
  /** Normalised [0,1] heightfield elevation at a tile (same space the road stairs read). */
  elevAt: (x: number, y: number) => number;
  /** Metres of relief per normalised elevation unit (`worldStyle.mountainRelief`). */
  reliefM: number;
  /** Render-space (curved) elevation to seat the stoop foot on its terrain (G4 liftElev). */
  liftElevAt?: (x: number, y: number) => number;
  /** A cell the stoop may NOT occupy (water, road, another building). */
  cellBlocked?: (x: number, y: number) => boolean;
}

type Card = { f: [number, number]; dir: 'north' | 'south' | 'east' | 'west' };
const NORTH: Card = { f: [0, -1], dir: 'north' };
const SOUTH: Card = { f: [0, 1], dir: 'south' };
const EAST: Card = { f: [1, 0], dir: 'east' };
const WEST: Card = { f: [-1, 0], dir: 'west' };

/** Snap an (fx,fy) facing to its dominant cardinal. */
function cardinalOf(fx: number, fy: number): Card {
  return Math.abs(fx) >= Math.abs(fy) ? (fx >= 0 ? EAST : WEST) : (fy >= 0 ? SOUTH : NORTH);
}

/**
 * Site a perron/stoop for every building whose main door stands proud of the grade it faces.
 * `buildings` is the placed building entities (each carries its resolved blueprint). Pure.
 */
export function buildEntranceStoopEntities(buildings: Entity[], opts: EntranceStoopOptions): Entity[] {
  ensureBuildingTypesRegistered();
  const out: Entity[] = [];
  const sorted = [...buildings].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of sorted) {
    const rb = blueprintOf(e)?.rb;
    if (!rb) continue;
    const ox = Math.floor(e.x), oy = Math.floor(e.y);
    const anchors = toAnchors(rb, ox, oy);
    const door = anchors.find(a => a.kind === 'door' && a.main) ?? anchors.find(a => a.kind === 'door');
    if (!door) continue;
    const out0 = cardinalOf(door.facing[0], door.facing[1]);   // outward cardinal

    // Pad/floor elevation ≈ terrain at the building centre; grade ≈ a couple tiles out the door.
    const padElev = opts.elevAt(ox, oy);
    const gx = Math.round(door.x + out0.f[0] * PROBE_TILES);
    const gy = Math.round(door.y + out0.f[1] * PROBE_TILES);
    const riseM = (padElev - opts.elevAt(gx, gy)) * opts.reliefM;
    if (riseM < MIN_STOOP_RISE_M || riseM > MAX_STOOP_RISE_M) continue;

    // Foot = the grade tile just outside the door (low); the flight climbs back to the door.
    const fx = Math.round(door.x + out0.f[0]);
    const fy = Math.round(door.y + out0.f[1]);
    if (opts.cellBlocked?.(fx, fy)) continue;
    const climb = cardinalOf(-out0.f[0], -out0.f[1]).dir;   // toward the door
    const material = (rb.materials?.walls as string) ?? 'stone';
    const fp = stairFootprint({ riseM, construction: STOOP_CONSTRUCTION, widthM: STOOP_WIDTH_M });
    const bp: Blueprint = {
      version: BLUEPRINT_VERSION, class: 'prop', preset: 'stair_perron', category: 'infrastructure',
      footprint: { w: fp.w, h: fp.h }, materials: { walls: material, roof: material, ground: 'dirt' },
      parts: { flight: { type: 'stair_flight', at: { x: 0, y: 0 }, size: { w: fp.w, h: fp.h }, params: {
        riseM, widthM: STOOP_WIDTH_M, construction: STOOP_CONSTRUCTION, dir: climb, railing: 'none',
      } } },
    };
    const ent = blueprintEntity(`${e.id}:stoop`, resolveBlueprint([bp], 0), fx, fy);
    const lift = opts.liftElevAt?.(fx, fy);
    if (lift !== undefined) (ent.properties as Record<string, unknown>).liftElev = lift;
    out.push(ent);
  }
  return out;
}
