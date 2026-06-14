/**
 * FactPack — the unit of content distribution. A pack bundles catalogue entries,
 * constraints, and (Slice 1) declarative grammar rules. The engine ships empty;
 * `loadDefaultPacks()` loads `medieval-europe` at boot. Agents and the user author
 * new content at runtime through `registerFact` / `registerPack` — no recompile,
 * no engine branch on content ids.
 */
import { CatalogueRegistry } from '@/catalogue/registry';
import type { Constraint } from '@/catalogue/constraints';
import type { FactEntry } from '@/catalogue/types';

/** A declarative grammar rule consumed by the connectome interpreter (Slice 1). */
export interface GrammarRule {
  id: string;
  topology?: string; // applies to building types with this topology
  [k: string]: unknown; // open — rules are data the interpreter reads
}

export interface FactPack {
  name: string;
  entries: FactEntry[];
  constraints: Constraint[];
  grammarRules: GrammarRule[];
}

/** Append a pack's entries (overriding by `(kind,id)`) into a registry. */
export function loadPack(pack: FactPack, registry: CatalogueRegistry): void {
  for (const e of pack.entries) registry.register(e);
  for (const c of pack.constraints) registeredConstraints.push(c);
  for (const r of pack.grammarRules) registeredGrammarRules.push(r);
}

// ── The default singleton (the live catalogue the game reads) ───────────────

export const catalogue = new CatalogueRegistry();

/** Pack-supplied constraints + grammar rules accumulate here as packs load. */
export const registeredConstraints: Constraint[] = [];
export const registeredGrammarRules: GrammarRule[] = [];

/** Agent / user seam: register one fact into the live catalogue at runtime. */
export function registerFact(entry: FactEntry): void {
  catalogue.register(entry);
}

/** Agent / user seam: load a whole pack into the live catalogue at runtime. */
export function registerPack(pack: FactPack): void {
  loadPack(pack, catalogue);
}

let defaultsLoaded = false;

/**
 * Load the built-in content packs into the default singleton. Idempotent. The
 * medieval-europe pack is wired here in Task 11; until then this is a no-op so the
 * engine stays decoupled from content.
 */
export function loadDefaultPacks(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;
  // TODO(Task 11): registerPack(medievalEuropePack);
}
