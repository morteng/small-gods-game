/**
 * CatalogueRegistry — the in-memory fact store. Domain-neutral: it holds entries
 * keyed `(kind, id)` and answers lookups/queries; it knows nothing about what the
 * content means. Later registrations with the same `(kind, id)` override earlier
 * ones, which is how a content pack extends or overrides the packs before it.
 */
import type { CatalogueKind, Era, FactEntry } from '@/catalogue/types';

/** The context a query filters against. All axes optional; omitted = unconstrained. */
export interface QueryCtx {
  kind?: CatalogueKind;
  pack?: string;
  era?: Era;
  region?: string;
  wealth?: string;
}

function key(kind: CatalogueKind, id: string): string {
  return `${kind}:${id}`;
}

/** True when `entry.applicability` admits the given context. No applicability = always. */
export function appliesTo(
  entry: FactEntry<unknown>,
  ctx: { era?: Era; region?: string; wealth?: string },
): boolean {
  const a = entry.applicability;
  if (!a) return true;
  if (a.eras && ctx.era && !a.eras.includes(ctx.era)) return false;
  if (a.regions && ctx.region && !a.regions.includes(ctx.region)) return false;
  if (a.wealth && ctx.wealth && !a.wealth.includes(ctx.wealth)) return false;
  return true;
}

export class CatalogueRegistry {
  private readonly byKey = new Map<string, FactEntry>();
  private readonly byKind = new Map<CatalogueKind, Set<string>>(); // kind → ids

  register(entry: FactEntry): void {
    const k = key(entry.kind, entry.id);
    this.byKey.set(k, entry); // override = last wins
    let ids = this.byKind.get(entry.kind);
    if (!ids) {
      ids = new Set();
      this.byKind.set(entry.kind, ids);
    }
    ids.add(entry.id);
  }

  get<F = Record<string, unknown>>(kind: CatalogueKind, id: string): FactEntry<F> | undefined {
    return this.byKey.get(key(kind, id)) as FactEntry<F> | undefined;
  }

  all<F = Record<string, unknown>>(kind: CatalogueKind): FactEntry<F>[] {
    const ids = this.byKind.get(kind);
    if (!ids) return [];
    const out: FactEntry<F>[] = [];
    for (const id of ids) {
      const e = this.byKey.get(key(kind, id));
      if (e) out.push(e as FactEntry<F>);
    }
    return out;
  }

  query<F = Record<string, unknown>>(ctx: QueryCtx): FactEntry<F>[] {
    const pool = ctx.kind ? this.all<F>(ctx.kind) : [...this.byKey.values()] as FactEntry<F>[];
    return pool.filter((e) => {
      if (ctx.pack && e.pack !== ctx.pack) return false;
      return appliesTo(e, ctx);
    });
  }

  /** Total entry count (across all kinds). */
  get size(): number {
    return this.byKey.size;
  }
}
