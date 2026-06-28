/**
 * Site-scale connectome — an ESTABLISHMENT expanded from a catalogue `siteType` (or
 * synthesised from a bare buildingType). Where the building grammar (grammar.ts)
 * wires rooms into one building, and the complex grammar (complex.ts) wires defended
 * WARDS, this wires the PREMISES around a single core building: the core leaf + an
 * optional yard + auxiliary buildings + ground/façade fixtures + the "wall (or not)".
 *
 * It is the generalisation of complex.ts's `enclosure` topology: defence is not
 * special — every placement is a sub-graph. `enclosure` stays in complex.ts (DC-2,
 * byte-identical); this adds the everyday topologies:
 *
 *   yard         — core + an enclosed/open court + outbuildings facing it. The court's
 *                  `barrier?` is the "wall or not": present ⇒ walled, absent ⇒ open.
 *   freestanding — core + ground/setback fixtures, no enclosure (a wayside chapel).
 *   derive       — DEFAULT (no recipe): synthesise a plausible site from the core's
 *                  `functions`/`requires` tags by querying the catalogue for satisfiers.
 *
 * CONTENT-FREE (engine-purity guard): it reads catalogue fields and dispatches on the
 * topology id; no building/yard/fixture names are hard-coded. The role words
 * ('core'/'yard'/'auxiliary'/'fronts'/'gates-onto') are structural vocabulary, like
 * complex.ts's 'core'/'ward'. New site grammar = register a site interpreter.
 *
 * This is the E1 boundary: it stops at a graph + a structured plan (`siteToPlan`).
 * Co-placing the parts on the shared OccupancyGrid is E2 (spatial-coordination C1).
 */
import { createRng } from '@/core/rng';
import type {
  BuildingTypeFields,
  FixtureTypeFields,
  SiteBuildingSlot,
  SiteTypeFields,
} from '@/catalogue/types';
import type { CatalogueRegistry } from '@/catalogue/registry';
import type { Barrier, Connectome, ExpandCtx, Fixture, Portal, Zone } from './types';

/** A site interpreter turns a (resolved or synthesised) recipe into the four primitives. */
type SiteInterpreter = (
  fields: SiteTypeFields,
  ctx: ExpandCtx,
) => Pick<Connectome, 'zones' | 'portals' | 'barriers' | 'fixtures'>;

/** Copy the requirement tokens a fixtureType carries onto a Fixture instance. */
function fixtureFrom(id: string, zoneId: string, reg: CatalogueRegistry, idx: number): Fixture {
  const ft = reg.get<FixtureTypeFields>('fixtureType', id);
  return {
    id: `fx${idx}`,
    type: id,
    zoneId,
    ...(ft?.fields.requires ? { requires: ft.fields.requires } : {}),
    ...(ft?.fields.satisfies ? { satisfies: ft.fields.satisfies } : {}),
  };
}

/** The core building zone — the establishment's leaf. */
function coreZone(buildingType: string, ctx: ExpandCtx): Zone {
  return {
    id: 'core',
    type: buildingType,
    fn: 'core',
    scale: 'building',
    builtEra: ctx.era,
    tags: ['building'],
    attrs: { buildingType, role: 'core' },
  };
}

/** An auxiliary building zone sited within the premises (e.g. a stable in the yard). */
function auxZone(slot: SiteBuildingSlot, host: string, idx: number, ctx: ExpandCtx): Zone {
  return {
    id: `b${idx}`,
    type: slot.type,
    fn: 'auxiliary',
    scale: 'building',
    builtEra: ctx.era,
    tags: ['building'],
    attrs: { buildingType: slot.type, role: slot.role ?? 'auxiliary', site: host },
  };
}

/** "X fronts/gates-onto Y" — the site's internal access relations as Portals. */
function relation(id: string, from: string, to: string | 'OUTSIDE', rel: string): Portal {
  return { id, type: rel, from, to, attrs: { relation: rel } };
}

// ── yard ─────────────────────────────────────────────────────────────────────────
// Core + a court it fronts onto, with outbuildings + fixtures in the court. The
// court's barrier (if any) rings the YARD, never the building — the "wall or not".
const yard: SiteInterpreter = (fields, ctx) => {
  const zones: Zone[] = [coreZone(fields.core, ctx)];
  const portals: Portal[] = [];
  const barriers: Barrier[] = [];
  const fixtures: Fixture[] = [];

  const court: Zone = {
    id: 'yard',
    type: 'yard',
    fn: 'yard',
    scale: 'site',
    builtEra: ctx.era,
    attrs: { role: 'yard' },
  };
  zones.push(court);
  portals.push(relation('p-core-yard', 'core', 'yard', 'fronts'));

  (fields.buildings ?? []).forEach((slot, i) => {
    if (slot.role === 'core') return; // the core is already the `core` zone
    zones.push(auxZone(slot, 'yard', i, ctx));
    portals.push(relation(`p-b${i}-yard`, `b${i}`, 'yard', 'fronts'));
  });

  (fields.fixtures ?? []).forEach((id, i) => fixtures.push(fixtureFrom(id, 'yard', ctx.registry, i)));

  // The wall (or not): a barrier ringing the yard + the gate that pierces it.
  const wall = fields.yard?.barrier;
  if (wall) {
    barriers.push({
      id: 'yard-wall',
      type: wall,
      encloses: 'yard',
      ring: 0,
      builtEra: ctx.era,
      attrs: { walled: true },
    });
    portals.push(relation('gate-yard', 'OUTSIDE', 'yard', 'gates-onto'));
  } else {
    portals.push(relation('open-yard', 'OUTSIDE', 'yard', 'gates-onto'));
  }

  return { zones, portals, barriers, fixtures };
};

// ── freestanding ───────────────────────────────────────────────────────────────────
// A building with ground/setback fixtures and no enclosure — a wayside chapel, a
// smithy on the green. Fixtures sit on the core's own apron (zoneId = core).
const freestanding: SiteInterpreter = (fields, ctx) => {
  const zones: Zone[] = [coreZone(fields.core, ctx)];
  const fixtures: Fixture[] = (fields.fixtures ?? []).map((id, i) =>
    fixtureFrom(id, 'core', ctx.registry, i),
  );
  const portals: Portal[] = [relation('approach', 'OUTSIDE', 'core', 'gates-onto')];
  return { zones, portals, barriers: [], fixtures };
};

// ── derive (the default) ───────────────────────────────────────────────────────────
// No authored recipe: synthesise a plausible site from the core building's
// `requires` tokens. Each token is resolved to the first matching satisfier —
// fixtureTypes first (a sign, a bench, a well), then buildingTypes (a stable).
// Deterministic: candidates are sorted by id so the choice never depends on pack
// order. Yields an open court (poor establishment); a richer walled version is an
// authored `yard` recipe.
function firstSatisfier<F extends { satisfies?: string[] }>(
  entries: { id: string; fields: F }[],
  token: string,
): { id: string; fields: F } | undefined {
  return entries
    .filter((e) => e.fields.satisfies?.includes(token))
    .sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id))[0];
}

const derive: SiteInterpreter = (fields, ctx) => {
  const reg = ctx.registry;
  const zones: Zone[] = [coreZone(fields.core, ctx)];
  const portals: Portal[] = [relation('p-core-yard', 'core', 'yard', 'fronts')];
  const fixtures: Fixture[] = [];

  const court: Zone = {
    id: 'yard',
    type: 'yard',
    fn: 'yard',
    scale: 'site',
    builtEra: ctx.era,
    attrs: { role: 'yard', derived: true },
  };
  zones.push(court);

  const core = reg.get<BuildingTypeFields>('buildingType', fields.core);
  const tokens = core?.fields.requires ?? [];
  const fixtureEntries = reg.all<FixtureTypeFields>('fixtureType').map((e) => ({ id: e.id, fields: e.fields }));
  const buildingEntries = reg
    .all<BuildingTypeFields>('buildingType')
    .filter((e) => e.id !== fields.core)
    .map((e) => ({ id: e.id, fields: e.fields }));

  let fIdx = 0;
  let bIdx = 0;
  for (const token of tokens) {
    const fx = firstSatisfier(fixtureEntries, token);
    if (fx) {
      fixtures.push(fixtureFrom(fx.id, 'yard', reg, fIdx++));
      continue;
    }
    const bt = firstSatisfier(buildingEntries, token);
    if (bt) {
      zones.push(auxZone({ type: bt.id, satisfies: [token] }, 'yard', bIdx, ctx));
      portals.push(relation(`p-b${bIdx}-yard`, `b${bIdx}`, 'yard', 'fronts'));
      bIdx++;
    }
    // else: no satisfier in the catalogue — the need goes unmet (a sparse site).
  }

  portals.push(relation('open-yard', 'OUTSIDE', 'yard', 'gates-onto'));
  return { zones, portals, barriers: [], fixtures };
};

const SITE_INTERPRETERS: Record<string, SiteInterpreter> = {
  yard,
  freestanding,
  derive,
};

/** Register a custom site interpreter (the one engine touch-point for new grammar). */
export function registerSiteInterpreter(id: string, fn: SiteInterpreter): void {
  SITE_INTERPRETERS[id] = fn;
}

/**
 * Expand an establishment into a site-scale connectome. The id is either a `siteType`
 * (authored recipe → its topology interpreter) OR a bare `buildingType` (no recipe →
 * the `derive` default synthesises a plausible site). Deterministic; content-free.
 * Returns an empty site connectome for an unknown id.
 */
export function expandSite(siteOrBuildingTypeId: string, ctx: ExpandCtx): Connectome {
  // Seed reserved for stochastic grammar (fixture jitter, satisfier choice variation);
  // consumed to keep the signature deterministic + ready for variation, as complex.ts does.
  createRng(ctx.seed);

  const empty: Connectome = { scale: 'site', zones: [], portals: [], fixtures: [], barriers: [] };
  const st = ctx.registry.get<SiteTypeFields>('siteType', siteOrBuildingTypeId);

  let fields: SiteTypeFields;
  let topology: string;
  if (st) {
    fields = st.fields;
    topology = st.fields.topology;
  } else {
    // No authored recipe — derive from a buildingType of this id, if one exists.
    const bt = ctx.registry.get<BuildingTypeFields>('buildingType', siteOrBuildingTypeId);
    if (!bt) return empty;
    fields = { topology: 'derive', core: siteOrBuildingTypeId };
    topology = 'derive';
  }

  const interp = SITE_INTERPRETERS[topology] ?? derive;
  const { zones, portals, barriers, fixtures } = interp(fields, ctx);
  return {
    scale: 'site',
    zones,
    portals,
    fixtures: fixtures ?? [],
    barriers: barriers ?? [],
    source: { type: siteOrBuildingTypeId, topology },
  };
}

// ── Resolve-down: a structured PLAN (the E1 boundary — placement is E2) ────────────

export interface SitePlan {
  /** The establishment's core building. */
  core: { buildingType: string };
  /** Auxiliary buildings to co-place (stable, brewhouse), each with its role. */
  auxiliaries: { buildingType: string; role: string }[];
  /** The yard wall (or none) + any other barriers. */
  barriers: { type: string; encloses: string | null; attrs?: Record<string, unknown> }[];
  /** Ground/façade fixtures, each in the zone it sits in. */
  fixtures: { type: string; zone: string; satisfies?: string[] }[];
  /** Internal access relations (core fronts yard, yard gates-onto street, …). */
  relations: { from: string; to: string; relation: string }[];
}

/**
 * Resolve a site connectome DOWN into a placement plan: the core leaf → a blueprint
 * ref, auxiliaries → blueprint refs, the yard wall → a barrier run, fixtures → ground
 * features, relations → co-placement constraints. Stops at structured data — committing
 * footprints to the shared OccupancyGrid is E2. Content-free: pure graph restructuring.
 */
export function siteToPlan(con: Connectome): SitePlan {
  const buildings = con.zones.filter((z) => z.scale === 'building');
  const coreZ = buildings.find((z) => z.attrs?.role === 'core') ?? buildings[0];
  return {
    core: { buildingType: (coreZ?.attrs?.buildingType as string) ?? coreZ?.type ?? '' },
    auxiliaries: buildings
      .filter((z) => z !== coreZ)
      .map((z) => ({
        buildingType: (z.attrs?.buildingType as string) ?? z.type,
        role: (z.attrs?.role as string) ?? 'auxiliary',
      })),
    barriers: (con.barriers ?? []).map((b) => ({
      type: b.type,
      encloses: b.encloses,
      ...(b.attrs ? { attrs: b.attrs } : {}),
    })),
    fixtures: con.fixtures.map((f) => ({
      type: f.type,
      zone: f.zoneId,
      ...(f.satisfies ? { satisfies: f.satisfies } : {}),
    })),
    relations: con.portals
      .filter((p) => p.attrs?.relation)
      .map((p) => ({ from: p.from, to: p.to, relation: p.attrs!.relation as string })),
  };
}
