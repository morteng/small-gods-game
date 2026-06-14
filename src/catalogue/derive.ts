/**
 * Domain-neutral derivations over `material` facts. No content literals — these
 * read whatever the registered packs declare, which is what makes the catalogue
 * (not a hard-coded table) the single source of truth for the wealth ladders that
 * `descriptors.ts` shifts along.
 */
import type { CatalogueRegistry } from '@/catalogue/registry';
import type { FactEntry, MaterialFields } from '@/catalogue/types';

/**
 * Wealth ladders per material role, poorest→richest, from ranked `material`
 * entries. Materials with no `rank` are off-ladder specialties (hide, log, cob,
 * grass …) and excluded — exactly as the old `descriptors.ts` `LADDERS` behaved.
 */
export function roleLaddersFromEntries(
  materials: FactEntry<MaterialFields>[],
): Record<string, string[]> {
  const byRole: Record<string, { id: string; rank: number }[]> = {};
  for (const e of materials) {
    const { role, rank } = e.fields;
    if (!role || rank == null) continue;
    (byRole[role] ??= []).push({ id: e.id, rank });
  }
  const out: Record<string, string[]> = {};
  for (const [role, list] of Object.entries(byRole)) {
    out[role] = list.sort((a, b) => a.rank - b.rank).map((x) => x.id);
  }
  return out;
}

/** As above, but reading every `material` fact from a populated registry. */
export function roleLadders(registry: CatalogueRegistry): Record<string, string[]> {
  return roleLaddersFromEntries(registry.all<MaterialFields>('material'));
}
