/**
 * Cross-producer SPATIAL INVARIANTS for full settlement generation.
 *
 * Every worldgen producer (internal roads, building placer, croft/settlement
 * barriers, inter-POI road graph) writes into the same World independently. Each
 * is unit-tested in isolation, but nothing asserts that their outputs don't
 * COLLIDE — and that is exactly where the visible bugs live: hedges/walls landing
 * under a building, and inter-settlement roads carving through one.
 *
 * This test generates real worlds (default.json + a few seeds) and asserts the
 * invariants that must hold ACROSS producers. It is the regression net for the
 * deconfliction work: it should be RED until barriers and roads consult building
 * footprints, then stay green.
 *
 * "Structure cell" = a SOLID building cell: `blueprint.collision.blocked` minus
 * `doorCells`. The door/lawn cells are the building's passable interface with the
 * world — a road reaching the door and the croft gate sitting at the door are
 * CORRECT, so they are excluded. A barrier or road on a solid (wall) cell is the bug.
 * This matches `tileBlockedByBuilding` (movement collision), so the invariant and
 * the deconfliction fixes share one notion of "inside the walls".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed, Entity } from '@/core/types';
import type { World } from '@/world/world';
import { blueprintOf } from '@/blueprint/entity';

const seed = JSON.parse(
  readFileSync('public/data/worlds/default.json', 'utf-8'),
) as WorldSeed;

const ROAD_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);
const key = (x: number, y: number) => `${x},${y}`;

/** Absolute solid-structure cells of every building, keyed by entity id. */
function buildingStructureCells(world: World): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of world.query({ tag: 'building' }) as Entity[]) {
    const bp = blueprintOf(e);
    if (!bp) continue;
    const ox = Math.floor(e.x), oy = Math.floor(e.y);
    const doors = new Set(bp.collision.doorCells);
    const cells = new Set<string>();
    for (const local of bp.collision.blocked) {
      if (doors.has(local)) continue;          // passable doorway — not a solid wall cell
      const [lx, ly] = local.split(',').map(Number);
      cells.add(key(ox + lx, oy + ly));
    }
    out.set(String(e.id), cells);
  }
  return out;
}

/** Absolute blocking cells of every placed barrier run (croft/settlement rings). */
function barrierBlockingCells(world: World): string[] {
  const cells: string[] = [];
  for (const e of world.query({ tag: 'barrier' }) as Entity[]) {
    const fc = (e.properties as { footprintCells?: [number, number][] } | undefined)?.footprintCells;
    if (!Array.isArray(fc)) continue;
    for (const [x, y] of fc) cells.push(key(x, y));
  }
  return cells;
}

interface GenWorld { world: World; roadCells: Set<string> }

async function generate(s: number): Promise<GenWorld> {
  const { map, world } = await generateWithNoise(
    seed.size.width, seed.size.height, s, seed, { onProgress() {} },
  );
  const roadCells = new Set<string>();
  for (let y = 0; y < map.tiles.length; y++) {
    const row = map.tiles[y];
    for (let x = 0; x < row.length; x++) {
      if (ROAD_TYPES.has(row[x]?.type)) roadCells.add(key(x, y));
    }
  }
  return { world, roadCells };
}

const SEEDS = [12345, 777, 2024];

describe('settlement spatial invariants (cross-producer)', () => {
  for (const s of SEEDS) {
    describe(`seed ${s}`, () => {
      let g: GenWorld;
      let structures: Map<string, Set<string>>;

      it('generates a world with buildings', async () => {
        g = await generate(s);
        structures = buildingStructureCells(g.world);
        expect(structures.size).toBeGreaterThan(0);
      }, 30_000);

      it('INV1 — no two buildings share a structure cell', () => {
        const owner = new Map<string, string>();
        const clashes: string[] = [];
        for (const [id, cells] of structures) {
          for (const c of cells) {
            const prev = owner.get(c);
            if (prev && prev !== id) clashes.push(`${c} (${prev} ∩ ${id})`);
            else owner.set(c, id);
          }
        }
        expect(clashes, `overlapping building structure cells: ${clashes.slice(0, 8).join('; ')}`).toEqual([]);
      });

      it('INV2 — no barrier blocking cell sits on a building structure cell', () => {
        const all = new Set<string>();
        for (const cells of structures.values()) for (const c of cells) all.add(c);
        const under = barrierBlockingCells(g.world).filter(c => all.has(c));
        expect(under, `barrier cells under buildings: ${[...new Set(under)].slice(0, 12).join('; ')}`).toEqual([]);
      });

      it('INV3 — no road tile sits on a building structure cell', () => {
        const under: string[] = [];
        for (const cells of structures.values()) {
          for (const c of cells) if (g.roadCells.has(c)) under.push(c);
        }
        expect(under, `road tiles under buildings: ${[...new Set(under)].slice(0, 12).join('; ')}`).toEqual([]);
      });
    });
  }
});
