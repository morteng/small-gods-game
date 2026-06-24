/**
 * Complex-scale connectome — a defended/planned MULTI-building work (motte-and-bailey,
 * concentric castle, walled town) expanded from a catalogue `complexType`. Where the
 * building grammar (grammar.ts) wires rooms into a single building, this wires WARDS
 * (district zones) + the buildings inside them + the BARRIER rings that enclose them +
 * the controlled GATE portals that pierce those rings.
 *
 * The headline topology is `enclosure`: nested wards, each bounded by a ring with ≥1
 * gate, one designated high-point CORE ward (its building — the keep — sits on the
 * motte). The access sequence is strictly ordered outer→inner, so circulation is a
 * controlled chain of checkpoints. Earthworks (the motte/ditch) are produced by the
 * siting step (earthworks.ts) at placement, not here — this builds the graph.
 *
 * CONTENT-FREE (engine-purity guard): it reads catalogue fields and dispatches on the
 * topology's interpreter id; no ward/building/barrier names are hard-coded. New
 * structural grammar = register a complex interpreter (the one engine touch-point).
 */
import { createRng } from '@/core/rng';
import type {
  BarrierTypeFields,
  ComplexTypeFields,
  FixtureTypeFields,
  PortalTypeFields,
  RingSlot,
  WardSlot,
} from '@/catalogue/types';
import type { CatalogueRegistry } from '@/catalogue/registry';
import type { Barrier, Connectome, ExpandCtx, Fixture, Portal, WallFace, Zone } from './types';
import {
  siteSelect,
  deriveEarthworks,
  type Earthwork,
  type EarthworkSpec,
  type SiteCandidate,
  type SiteIntent,
  type SiteScore,
  type SiteWeights,
} from './earthworks';

/** Pick a gate portalType: explicit id, else the largest passable portal the pack has. */
function pickGate(reg: CatalogueRegistry, sizeClass: string, explicit?: string): string {
  if (explicit) return explicit;
  const matches = reg
    .all<PortalTypeFields>('portalType')
    .filter((e) => e.fields.passable && e.fields.sizeClass === sizeClass)
    .sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
  return matches[0]?.id ?? '';
}

/** The ward that sits primarily inside ring `i` (first declared wins). */
function primaryWard(wards: { slot: WardSlot; zone: Zone }[], ring: number): Zone | undefined {
  return wards.find((w) => w.slot.ring === ring)?.zone;
}

type ComplexInterpreter = (
  fields: ComplexTypeFields,
  ctx: ExpandCtx,
) => Pick<Connectome, 'zones' | 'portals' | 'barriers' | 'fixtures'>;

/**
 * The `enclosure` interpreter — nested rings of wards with controlled gates and a
 * high-point core. Realises three constraints structurally: a gate per ring, the
 * core innermost, and the access chain outer→inner.
 */
const enclosure: ComplexInterpreter = (fields, ctx) => {
  const reg = ctx.registry;
  const zones: Zone[] = [];
  const portals: Portal[] = [];
  const barriers: Barrier[] = [];
  const fixtures: Fixture[] = [];

  // ── Ward zones (districts) + their buildings + their fixtures (the well) ──
  const wards: { slot: WardSlot; zone: Zone }[] = [];
  let bIdx = 0;
  let fIdx = 0;
  fields.wards.forEach((slot, wi) => {
    const wardZone: Zone = {
      id: `w${wi}`,
      type: slot.type,
      fn: slot.core ? 'core' : 'ward',
      scale: 'district',
      builtEra: ctx.era,
      attrs: { ring: slot.ring, core: !!slot.core },
    };
    zones.push(wardZone);
    wards.push({ slot, zone: wardZone });

    for (const bt of slot.buildings ?? []) {
      zones.push({
        id: `b${bIdx++}`,
        type: bt,
        scale: 'building',
        builtEra: ctx.era,
        tags: ['building'],
        attrs: { ward: wardZone.id, onCore: !!slot.core, buildingType: bt },
      });
    }
    for (const fxId of slot.fixtures ?? []) {
      const ft = reg.get<FixtureTypeFields>('fixtureType', fxId);
      fixtures.push({
        id: `fx${fIdx++}`,
        type: fxId,
        zoneId: wardZone.id,
        ...(ft?.fields.requires ? { requires: ft.fields.requires } : {}),
        ...(ft?.fields.satisfies ? { satisfies: ft.fields.satisfies } : {}),
      });
    }
  });

  // ── Barrier rings (inner→outer by radius) + gate portals piercing each ──
  const rings = fields.rings
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.radius - b.r.radius);
  // ringOrder[i] = how far out ring index i sits (0 = innermost) — drives the access chain.
  rings.forEach(({ r }, order) => {
    const ringIndex = fields.rings.indexOf(r);
    const inside = primaryWard(wards, ringIndex);
    if (!inside) return;

    const bt = reg.get<BarrierTypeFields>('barrierType', r.barrier);
    barriers.push({
      id: `ring${ringIndex}`,
      type: r.barrier,
      encloses: inside.id,
      ring: order,
      builtEra: ctx.era,
      attrs: {
        radius: r.radius,
        ...(bt?.fields.defensibility != null ? { defensibility: bt.fields.defensibility } : {}),
        ...(bt?.fields.material ? { material: bt.fields.material } : {}),
      },
    });

    // Gate(s): connect the zone OUTSIDE this ring (the next ring out, else OUTSIDE) to
    // the ward inside it. Controlled checkpoints — the heart of the access chain.
    const isOutermost = order === rings.length - 1;
    const outerRingIndex = isOutermost ? -1 : fields.rings.indexOf(rings[order + 1].r);
    const outerWard = isOutermost ? undefined : primaryWard(wards, outerRingIndex);
    const from = outerWard?.id ?? 'OUTSIDE';
    const gateType = pickGate(reg, 'grand', r.gatePortal);
    const gates = Math.max(1, r.gates);
    for (let g = 0; g < gates && gateType; g++) {
      portals.push({
        id: `gate${ringIndex}-${g}`,
        type: gateType,
        from,
        to: inside.id,
        ...(from === 'OUTSIDE' ? { face: 'south' as WallFace, main: g === 0 } : {}),
        attrs: { controlled: true, gate: true, ring: order },
      });
    }
  });

  return { zones, portals, barriers, fixtures };
};

const COMPLEX_INTERPRETERS: Record<string, ComplexInterpreter> = {
  enclosure,
};

/** Register a custom complex interpreter (the one engine touch-point for new grammar). */
export function registerComplexInterpreter(id: string, fn: ComplexInterpreter): void {
  COMPLEX_INTERPRETERS[id] = fn;
}

/** Expand a complexType into a complex-scale connectome. Deterministic. */
export function expandComplex(complexTypeId: string, ctx: ExpandCtx): Connectome {
  const ct = ctx.registry.get<ComplexTypeFields>('complexType', complexTypeId);
  if (!ct) return { scale: 'settlement', zones: [], portals: [], fixtures: [], barriers: [] };
  // Seed reserved for stochastic grammar (gate placement jitter, ward shuffling);
  // consumed to keep the signature deterministic + ready for variation.
  createRng(ctx.seed);

  const topology = ct.fields.topology;
  const interp = COMPLEX_INTERPRETERS[topology] ?? enclosure;
  const { zones, portals, barriers, fixtures } = interp(ct.fields, ctx);

  return {
    scale: 'settlement',
    zones,
    portals,
    fixtures: fixtures ?? [],
    barriers,
    source: { type: complexTypeId, topology },
  };
}

// ── Resolve-down: a structured PLAN (world placement is DC-2) ─────────────────────

export interface ComplexPlan {
  /** Buildings to place — each a buildingType id + the ward it belongs to. */
  buildings: { buildingType: string; ward: string; onCore: boolean }[];
  /** Barrier rings + the spanning works, inner→outer. */
  barriers: { type: string; encloses: string | null; ring?: number; attrs?: Record<string, unknown> }[];
  /** Controlled entrances, in the access chain. */
  gates: { type: string; from: string; to: string }[];
  /** Water/other ward fixtures (the well). */
  fixtures: { type: string; ward: string; satisfies?: string[] }[];
}

/**
 * Resolve a complex connectome DOWN into a placement plan: building leaves → blueprint
 * refs, barriers → linear-structure refs, gates → controlled entrances. This is the
 * "layer above, resolve down" boundary — it stops at a structured plan; the actual
 * world placement + heightfield deformation (siteSelect/deriveEarthworks → tiles) is
 * DC-2. Content-free: pure restructuring of the graph.
 */
export function complexToPlan(con: Connectome): ComplexPlan {
  return {
    buildings: con.zones
      .filter((z) => z.scale === 'building')
      .map((z) => ({
        buildingType: (z.attrs?.buildingType as string) ?? z.type,
        ward: (z.attrs?.ward as string) ?? '',
        onCore: !!z.attrs?.onCore,
      })),
    barriers: (con.barriers ?? []).map((b) => ({
      type: b.type,
      encloses: b.encloses,
      ring: b.ring,
      ...(b.attrs ? { attrs: b.attrs } : {}),
    })),
    gates: con.portals
      .filter((p) => p.attrs?.gate)
      .map((p) => ({ type: p.type, from: p.from, to: p.to })),
    fixtures: con.fixtures.map((f) => ({
      type: f.type,
      ward: f.zoneId,
      ...(f.satisfies ? { satisfies: f.satisfies } : {}),
    })),
  };
}

// ── Siting: place a complex on real terrain (DC-2 read side) ──────────────────────

export interface PlacedComplex {
  complexType: string;
  site: SiteScore; // chosen tile + its affordance/score breakdown
  earthworks: Earthwork[]; // motte/ditch/rampart in WORLD coords, centred on the site
  netVolume: number; // ≈ 0 — spoil conserved
  spec: EarthworkSpec;
}

const DEFAULT_SPEC: EarthworkSpec = {
  motteHeight: 0,
  motteTopRadius: 4,
  slope: 1.5,
  baileyRadius: 16,
  rampartHeight: 2,
  rampartWidth: 4,
  ditchWidth: 5,
};

/** Fill an EarthworkSpec from a complexType's (partial) earthwork programme + its rings. */
export function specFromComplexType(fields: ComplexTypeFields): EarthworkSpec {
  const outerRadius = fields.rings.length
    ? Math.max(...fields.rings.map((r) => r.radius))
    : DEFAULT_SPEC.baileyRadius;
  const e = fields.earthworks ?? {};
  return {
    ...DEFAULT_SPEC,
    baileyRadius: outerRadius,
    motteHeight: e.motteHeight ?? fields.desiredHeight ?? DEFAULT_SPEC.motteHeight,
    ...(e.motteTopRadius != null ? { motteTopRadius: e.motteTopRadius } : {}),
    ...(e.slope != null ? { slope: e.slope } : {}),
    ...(e.rampartHeight != null ? { rampartHeight: e.rampartHeight } : {}),
    ...(e.rampartWidth != null ? { rampartWidth: e.rampartWidth } : {}),
    ...(e.ditchWidth != null ? { ditchWidth: e.ditchWidth } : {}),
  };
}

/**
 * Pick where a complex sits on real terrain and derive its earthworks there. Composes
 * the siting argmax (over `candidates`, read through `ctx.terrain`) with the spoil-
 * conserving earthwork derivation: a prominent knoll wins on cost and builds little or
 * no motte; flat ground by a target wins on strategy and pays the full mound.
 *
 * Pure + deterministic given the probe + seed. Returns null with no terrain probe, no
 * candidates, or an unknown complexType. Stops at DATA — committing the earthworks to
 * the world heightfield is the SHARED deformation-channel step (DC-3), not done here.
 */
export function siteComplex(
  complexTypeId: string,
  ctx: ExpandCtx,
  intent: Omit<SiteIntent, 'desiredHeight'> & { desiredHeight?: number },
  candidates: SiteCandidate[],
  weights: SiteWeights,
): PlacedComplex | null {
  const ct = ctx.registry.get<ComplexTypeFields>('complexType', complexTypeId);
  if (!ct || !ctx.terrain) return null;
  const spec = specFromComplexType(ct.fields);
  const fullIntent: SiteIntent = {
    ...intent,
    desiredHeight: intent.desiredHeight ?? ct.fields.desiredHeight ?? spec.motteHeight,
  };
  const site = siteSelect(candidates, fullIntent, weights, ctx.terrain, ctx.seed);
  if (!site) return null;
  const { earthworks, netVolume } = deriveEarthworks(site.site, spec, ctx.terrain);
  return { complexType: complexTypeId, site, earthworks, netVolume, spec };
}

/**
 * Wrap a defensive ring around an ALREADY-PLACED ward — the retrofit case (town wall,
 * fortified church/manor, burh). Siting INVERTS: the protected thing exists, the
 * barrier follows it. Returns the barrier + its gates to splice into a connectome.
 */
export function encloseExisting(
  wardZoneId: string,
  ring: RingSlot,
  ctx: ExpandCtx,
): { barriers: Barrier[]; portals: Portal[] } {
  const reg = ctx.registry;
  const bt = reg.get<BarrierTypeFields>('barrierType', ring.barrier);
  const barrier: Barrier = {
    id: `wall-${wardZoneId}`,
    type: ring.barrier,
    encloses: wardZoneId,
    ring: 0,
    builtEra: ctx.era,
    attrs: {
      radius: ring.radius,
      retrofit: true,
      ...(bt?.fields.defensibility != null ? { defensibility: bt.fields.defensibility } : {}),
      ...(bt?.fields.material ? { material: bt.fields.material } : {}),
    },
  };
  const gateType = pickGate(reg, 'grand', ring.gatePortal);
  const portals: Portal[] = [];
  const gates = Math.max(1, ring.gates);
  for (let g = 0; g < gates && gateType; g++) {
    portals.push({
      id: `towngate-${wardZoneId}-${g}`,
      type: gateType,
      from: 'OUTSIDE',
      to: wardZoneId,
      face: 'south',
      main: g === 0,
      attrs: { controlled: true, gate: true, retrofit: true },
    });
  }
  return { barriers: [barrier], portals };
}
