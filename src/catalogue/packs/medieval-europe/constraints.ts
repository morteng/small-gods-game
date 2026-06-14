/**
 * medieval-europe pack — declarative CONSTRAINTS.
 *
 * Two scopes:
 * - Pack-integrity constraints (`kind: 'buildingType'`) run over catalogue entries
 *   at load/validate time: every roomProgram reference must resolve.
 * - Derivation constraints (`kind: 'smoke-egress'`) run in Slice 1 over a smoke
 *   target `{ egress, era, wealth }` — the headline chimney gate, which warns and
 *   auto-downgrades an anachronistic chimney to a louver.
 *
 * The `validatePack` helper runs the entry-scoped ones; `smoke.ts` runs the
 * derivation ones explicitly.
 */
import type { Constraint } from '@/catalogue/constraints';
import { validate } from '@/catalogue/constraints';
import type { CatalogueRegistry } from '@/catalogue/registry';
import type { Era, FactEntry, BuildingTypeFields } from '@/catalogue/types';
import type { Connectome } from '@/blueprint/connectome';

/** Target shape for the smoke-egress gate (built in Slice 1's derivation). */
export interface SmokeTarget {
  egress: string; // fixtureType id chosen
  era: Era;
  wealth?: string;
  topology?: string;
}

const EARLY_NO_CHIMNEY: Era[] = ['primordial', 'ancient', 'classical'];

/**
 * The headline rule: a wall-chimney is anachronistic in the early eras, and in the
 * medieval era only the rich get one. Otherwise downgrade to a louver. Stone
 * vertical-stack builds (keeps) are exempt — they are where the chimney was born.
 */
export const chimneyEraGate: Constraint<SmokeTarget> = {
  id: 'chimney-era-gate',
  kind: 'smoke-egress',
  severity: 'warn',
  check: (t) => {
    if (t.egress !== 'wall-chimney') return true;
    if (t.topology === 'vertical-stack') return true; // keeps: the chimney's cradle
    if (EARLY_NO_CHIMNEY.includes(t.era)) return false;
    if (t.era === 'medieval' && !(t.wealth === 'rich' || t.wealth === 'opulent')) return false;
    return true;
  },
  message: 'wall-chimney is anachronistic for this era/wealth — downgrading to a ridge louver',
  autoCorrect: (t) => ({ ...t, egress: 'louver' }),
};

/** Pack integrity: every roomProgram / hearthRule reference resolves in the registry. */
export const buildingRefsExist: Constraint<FactEntry<BuildingTypeFields>> = {
  id: 'buildingtype-refs-exist',
  kind: 'buildingType',
  severity: 'error',
  check: (entry, registry) => {
    const f = entry.fields;
    if (!registry.get('topology', f.topology)) return false;
    for (const slot of f.roomProgram) if (!registry.get('roomType', slot.type)) return false;
    if (f.hearthRule.room !== 'none' && !registry.get('roomType', f.hearthRule.room)) return false;
    if (f.hearthRule.fixture && !registry.get('fixtureType', f.hearthRule.fixture)) return false;
    return true;
  },
  message: 'buildingType references an unknown topology / roomType / fixtureType',
};

// ── Defended-complex constraints (Slice DC-1) ────────────────────────────────────
// Realism guardrails over an expanded enclosure connectome. They encode the three
// rules a defensive work must obey: the refuge sits innermost, water lives inside the
// walls, and no ring is left ungated.

/** The barrier rings that enclose a ward, sorted innermost (ring 0) → outermost. */
function enclosingRings(con: Connectome) {
  return (con.barriers ?? []).filter((b) => b.encloses != null);
}

/** A castle's KEEP/core must sit in the innermost ring — the last redoubt, on the high ground. */
export const keepOnHighestZone: Constraint<Connectome> = {
  id: 'keep-on-highest-zone',
  kind: 'complex',
  severity: 'warn',
  check: (con) => {
    const core = con.zones.find((z) => z.attrs?.core);
    if (!core) return true; // no designated core ⇒ rule N/A
    const rings = enclosingRings(con);
    if (!rings.length) return true;
    const innermost = rings.reduce((m, b) => Math.min(m, b.ring ?? 0), Infinity);
    const coreRing = rings.find((b) => b.encloses === core.id)?.ring;
    return coreRing === innermost; // the core is enclosed by the innermost ring
  },
  message: 'the core/keep ward is not inside the innermost ring — a refuge must be the last redoubt',
};

/** A defended complex MUST have a water source (well/cistern) inside its walls — siege survival. */
export const waterInsideInnermostRing: Constraint<Connectome> = {
  id: 'water-inside-innermost-ring',
  kind: 'complex',
  severity: 'warn',
  check: (con) => {
    if (!enclosingRings(con).length) return true; // unwalled ⇒ rule N/A
    const enclosedWards = new Set(enclosingRings(con).map((b) => b.encloses));
    return con.fixtures.some(
      (f) => f.satisfies?.includes('water-supply') && enclosedWards.has(f.zoneId),
    );
  },
  message: 'no water source inside the walls — a castle cannot withstand a siege without a well',
};

/** Every barrier ring MUST be pierced by at least one controlled gate (else there is no way in). */
export const everyRingNeedsAGate: Constraint<Connectome> = {
  id: 'every-ring-needs-a-gate',
  kind: 'complex',
  severity: 'error',
  check: (con) => {
    const gates = con.portals.filter((p) => p.attrs?.gate);
    return enclosingRings(con).every((ring) => gates.some((g) => g.to === ring.encloses));
  },
  message: 'a barrier ring has no gate — every enclosed ward needs a controlled entrance',
};

export const COMPLEX_CONSTRAINTS: Constraint<Connectome>[] = [
  keepOnHighestZone,
  waterInsideInnermostRing,
  everyRingNeedsAGate,
];

/** Run the defended-complex guardrails over an expanded connectome. */
export function validateComplex(con: Connectome, registry: CatalogueRegistry) {
  return validate(con, COMPLEX_CONSTRAINTS, registry);
}

export const MEDIEVAL_CONSTRAINTS: Constraint[] = [
  chimneyEraGate as unknown as Constraint,
  buildingRefsExist as unknown as Constraint,
  ...(COMPLEX_CONSTRAINTS as unknown as Constraint[]),
];
