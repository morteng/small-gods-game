/**
 * The connectome grammar interpreter — `expand(buildingTypeId, ctx)` turns a
 * catalogue buildingType into a Zone/Portal/Fixture graph. CONTENT-FREE: it reads
 * catalogue fields and dispatches on the topology's `interpreter` id; it hard-codes
 * no room/material/building names (engine-purity guard enforces this). The four
 * master interpreters below are reusable across any pack that declares those
 * topologies; a new pack adds a topology entry + (if novel) registers its own
 * interpreter here — the only engine touch-point for new structural grammar.
 *
 * Deterministic: `(buildingTypeId, era, wealth, region, seed)` → a fixed graph.
 */
import { createRng } from '@/core/rng';
import type {
  BuildingTypeFields,
  FixtureTypeFields,
  PortalTypeFields,
  RoomTypeFields,
} from '@/catalogue/types';
import type { CatalogueRegistry } from '@/catalogue/registry';
import type { Connectome, ExpandCtx, Fixture, Portal, WallFace, Zone } from './types';

const FACE: Record<string, WallFace> = { n: 'north', s: 'south', e: 'east', w: 'west' };
const OPP: Record<WallFace, WallFace> = { north: 'south', south: 'north', east: 'west', west: 'east' };

/** Resolve the entrance face letter → WallFace (defaults south). */
function entryFace(letter?: string): WallFace {
  return FACE[letter ?? 's'] ?? 'south';
}

/**
 * Choose a portalType id. Prefers an explicit id; else queries the catalogue for a
 * passable portal of the wanted size class and picks deterministically (shortest id,
 * then alphabetical). Returns '' if the pack has none (caller skips).
 */
function pickPortal(reg: CatalogueRegistry, sizeClass: string, explicit?: string): string {
  if (explicit) return explicit;
  const matches = reg
    .all<PortalTypeFields>('portalType')
    .filter((e) => e.fields.passable && e.fields.sizeClass === sizeClass)
    .sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
  return matches[0]?.id ?? '';
}

/** Instantiate the room programme into zones (count × each slot), tagging fn + light need. */
function makeZones(bt: BuildingTypeFields, reg: CatalogueRegistry): Zone[] {
  const zones: Zone[] = [];
  let i = 0;
  for (const slot of bt.roomProgram) {
    const rt = reg.get<RoomTypeFields>('roomType', slot.type);
    for (let c = 0; c < slot.count; c++) {
      const tags: string[] = [];
      if (rt?.fields.needsLight) tags.push('needs-light');
      zones.push({
        id: `z${i}`,
        type: slot.type,
        fn: rt?.fields.fn,
        bays: slot.bays,
        level: 0,
        scale: 'room',
        ...(tags.length ? { tags } : {}),
      });
      i++;
    }
  }
  return zones;
}

// ── Topology interpreters: (zones, bt, ctx) → exterior + interior portals ──────

type Interpreter = (zones: Zone[], bt: BuildingTypeFields, ctx: ExpandCtx) => Portal[];

/** A single range read end-to-end; cross-passage (opposed doors) when through/≥2 rooms. */
const tripartiteLinear: Interpreter = (zones, bt, ctx) => {
  const portals: Portal[] = [];
  const face = entryFace(bt.entrance.face);
  const door = pickPortal(ctx.registry, bt.entrance.sizeClass, bt.entrance.portal);
  const through = bt.entrance.through ?? zones.length >= 2; // a cross-passage punches both walls
  const interiorDoor = pickPortal(ctx.registry, 'human');

  if (door) {
    portals.push({ id: 'p-door', type: door, from: 'OUTSIDE', to: zones[0].id, face, main: true });
    if (through && zones.length >= 2) {
      portals.push({ id: 'p-door-rear', type: door, from: 'OUTSIDE', to: zones[0].id, face: OPP[face] });
    }
  }
  // interior doors between consecutive zones along the run
  for (let i = 0; i < zones.length - 1 && interiorDoor; i++) {
    portals.push({ id: `p-i${i}`, type: interiorDoor, from: zones[i].id, to: zones[i + 1].id });
  }
  return portals;
};

/** A processional axis (porch→nave→chancel); aisles flank the first zone. */
const churchAxial: Interpreter = (zones, bt, ctx) => {
  const portals: Portal[] = [];
  const face = entryFace(bt.entrance.face);
  const door = pickPortal(ctx.registry, bt.entrance.sizeClass, bt.entrance.portal);
  const interiorDoor = pickPortal(ctx.registry, 'human');
  const through = bt.entrance.through ?? false;

  // aisle zones flank the nave (the first non-aisle zone); the rest form the axis
  const aisles = zones.filter((z) => z.fn === undefined ? false : z.tags?.includes('aisle') || z.type === 'aisle');
  const axis = zones.filter((z) => !aisles.includes(z));
  const head = axis[0] ?? zones[0];

  if (door) {
    portals.push({ id: 'p-door', type: door, from: 'OUTSIDE', to: head.id, face, main: true });
    if (through) portals.push({ id: 'p-door-rear', type: door, from: 'OUTSIDE', to: head.id, face: OPP[face] });
  }
  for (let i = 0; i < axis.length - 1 && interiorDoor; i++) {
    portals.push({ id: `p-ax${i}`, type: interiorDoor, from: axis[i].id, to: axis[i + 1].id });
  }
  aisles.forEach((a, i) => {
    if (interiorDoor) portals.push({ id: `p-aisle${i}`, type: interiorDoor, from: head.id, to: a.id });
  });
  return portals;
};

/** One zone per level; stairs link consecutive levels. */
const verticalStack: Interpreter = (zones, bt, ctx) => {
  const portals: Portal[] = [];
  zones.forEach((z, i) => (z.level = i));
  const face = entryFace(bt.entrance.face);
  const door = pickPortal(ctx.registry, bt.entrance.sizeClass, bt.entrance.portal);
  const stair = pickPortal(ctx.registry, 'human');
  if (door) portals.push({ id: 'p-door', type: door, from: 'OUTSIDE', to: zones[0].id, face, main: true });
  for (let i = 0; i < zones.length - 1 && stair; i++) {
    portals.push({ id: `p-stair${i}`, type: stair, from: zones[i].id, to: zones[i + 1].id, attrs: { vertical: true } });
  }
  return portals;
};

/** Ranges open off a central court (the first zone is the court). */
const courtyardHub: Interpreter = (zones, bt, ctx) => {
  const portals: Portal[] = [];
  const face = entryFace(bt.entrance.face);
  const gate = pickPortal(ctx.registry, bt.entrance.sizeClass, bt.entrance.portal);
  const interiorDoor = pickPortal(ctx.registry, 'human');
  const court = zones[0];
  court.fn = court.fn ?? 'circulation';
  court.tags = [...(court.tags ?? []), 'court'];
  if (gate) portals.push({ id: 'p-gate', type: gate, from: 'OUTSIDE', to: court.id, face, main: true });
  zones.slice(1).forEach((z, i) => {
    if (interiorDoor) portals.push({ id: `p-range${i}`, type: interiorDoor, from: court.id, to: z.id });
  });
  return portals;
};

const INTERPRETERS: Record<string, Interpreter> = {
  'tripartite-linear': tripartiteLinear,
  'church-axial': churchAxial,
  'vertical-stack': verticalStack,
  'courtyard-hub': courtyardHub,
};

/** Register a custom topology interpreter (the one engine touch-point for new grammar). */
export function registerInterpreter(id: string, fn: Interpreter): void {
  INTERPRETERS[id] = fn;
}

/** Place the hearth fixture per the buildingType's hearthRule (or none). */
function placeHearth(zones: Zone[], bt: BuildingTypeFields, reg: CatalogueRegistry): Fixture[] {
  const rule = bt.hearthRule;
  if (rule.room === 'none' || !rule.fixture) return [];
  const zone = zones.find((z) => z.type === rule.room) ?? zones[0];
  if (!zone) return [];
  const ft = reg.get<FixtureTypeFields>('fixtureType', rule.fixture);
  return [
    {
      id: 'fx-hearth',
      type: rule.fixture,
      zoneId: zone.id,
      ...(ft?.fields.requires ? { requires: ft.fields.requires } : {}),
      ...(ft?.fields.satisfies ? { satisfies: ft.fields.satisfies } : {}),
    },
  ];
}

/** Expand a buildingType into a building-scale connectome. Deterministic. */
export function expand(buildingTypeId: string, ctx: ExpandCtx): Connectome {
  const bt = ctx.registry.get<BuildingTypeFields>('buildingType', buildingTypeId);
  if (!bt) return { scale: 'building', zones: [], portals: [], fixtures: [] };
  // Seed reserved for future stochastic grammar choices; consumed to keep the
  // signature deterministic and ready for variation.
  createRng(ctx.seed);

  const zones = makeZones(bt.fields, ctx.registry);
  const interpreter = ctx.registry.get<{ interpreter: string }>('topology', bt.fields.topology)?.fields.interpreter;
  const wire = (interpreter && INTERPRETERS[interpreter]) || tripartiteLinear;
  const portals = zones.length ? wire(zones, bt.fields, ctx) : [];
  const fixtures = placeHearth(zones, bt.fields, ctx.registry);

  return {
    scale: 'building',
    zones,
    portals,
    fixtures,
    source: { type: buildingTypeId, topology: bt.fields.topology },
  };
}
