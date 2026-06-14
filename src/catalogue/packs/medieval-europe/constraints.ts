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
import type { Era, FactEntry, BuildingTypeFields } from '@/catalogue/types';

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

export const MEDIEVAL_CONSTRAINTS: Constraint[] = [
  chimneyEraGate as unknown as Constraint,
  buildingRefsExist as unknown as Constraint,
];
