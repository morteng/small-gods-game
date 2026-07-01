// src/world/connectome-contracts.ts
//
// The CONTRACT layer — a scoped, leveled generalization of the connectome LINTER
// (`connectome-diagnostics.ts`). Where the linter runs a fixed set of GLOBAL rules, a
// Contract adds two dimensions the linter lacks:
//
//   • LEVEL   — building / site / settlement / world: "validation features at all levels".
//   • KIND    — an INVARIANT is a post-hoc check (the existing 12 rules: no road through a
//               building, …); a REQUIREMENT is something a recipe asked the generator to
//               actively satisfy (a road MUST reach this gate). An unmet requirement is the
//               actionable half of the report — it carries a `suggestedFix`.
//
// A recipe (e.g. a walled town) DECLARES the contracts it commits to as pure data
// (`ContractDeclaration`s), stored on `GameMap.contracts` beside `roadGraph`/`barrierRuns`.
// `evaluateContracts` runs every world-level invariant globally PLUS every declared scoped
// contract, and returns a `ContractReport` — a structural superset of `DiagnosticReport`, so
// every existing consumer (MCP `lint_world`, the studios, Fate) keeps working unchanged.
//
// This is the "the recipe asks for specific things in the connectome and it spits back out
// something that can be evaluated" loop. Everything here is `Math.random`-free and reads only
// committed world state, so a report is reproducible for a given world.

import type {
  Diagnostic, DiagnosticSeverity, DiagnosticContext,
  DiagnosticRule, DiagnosticReport,
} from '@/world/connectome-diagnostics';
import { DEFAULT_RULES } from '@/world/connectome-diagnostics';

export type ContractLevel = 'building' | 'site' | 'settlement' | 'world';
/** INVARIANT = post-hoc check (the existing rules). REQUIREMENT = something the generator
 *  must ACTIVELY satisfy; an unmet requirement carries a `suggestedFix`. */
export type ContractKind = 'invariant' | 'requirement';

/** WHAT part of the world a declaration governs. Absent fields = unconstrained. */
export interface ContractScope {
  poi?: string;
  entities?: string[];                                   // ring id, building id, …
  bbox?: { minX: number; minY: number; maxX: number; maxY: number };
}

/** A reusable, registered check. A world-level invariant ignores `scope`. */
export interface Contract {
  id: string;
  level: ContractLevel;
  kind: ContractKind;
  severity: DiagnosticSeverity;
  description: string;
  evaluate(
    ctx: DiagnosticContext,
    scope: ContractScope,
    params?: Record<string, number | string>,
  ): Diagnostic[];
}

/** A recipe's COMMITMENT, as pure data. Persisted on the map beside roadGraph/barrierRuns →
 *  rides `structuredClone(map)` in the save; evaluation is a pure function of committed state. */
export interface ContractDeclaration {
  contract: string;                                      // Contract.id
  scope: ContractScope;
  params?: Record<string, number | string>;
}

export interface ContractSet { declarations: ContractDeclaration[] }

/** A `DiagnosticReport` plus the contract dimensions. Structurally a superset, so any consumer
 *  that reads `{ total, counts, byRule, diagnostics }` keeps working. */
export interface ContractReport extends DiagnosticReport {
  byLevel: Record<ContractLevel, number>;
  byKind: Record<ContractKind, number>;
  /** Unmet REQUIREMENT clauses — the actionable list, each with a `suggestedFix`. */
  unmet: Diagnostic[];
}

/** A `DiagnosticRule` IS a world-level invariant Contract that ignores scope. The 12 existing
 *  rules are wrapped by this and edited nowhere. */
export function invariantFromRule(rule: DiagnosticRule): Contract {
  return {
    id: rule.id,
    level: 'world',
    kind: 'invariant',
    severity: rule.severity,
    description: rule.description,
    evaluate: (ctx) => rule.evaluate(ctx),
  };
}

// ── Registry ───────────────────────────────────────────────────────────────────────
//
// The 12 diagnostics become world-level invariants automatically; recipe contracts (gate /
// wall / geometry) register alongside. New contracts append to `CONTRACT_CONTRACTS` below.

/** Recipe-declared contracts (scoped, level < world). Populated by later slices. */
export const CONTRACT_CONTRACTS: Contract[] = [];

/** Register a recipe contract (idempotent by id — last registration wins). */
export function registerContract(c: Contract): void {
  const i = CONTRACT_CONTRACTS.findIndex((x) => x.id === c.id);
  if (i >= 0) CONTRACT_CONTRACTS[i] = c; else CONTRACT_CONTRACTS.push(c);
}

/** The full registry: the 12 wrapped invariants + every registered recipe contract. Rebuilt on
 *  read so a contract registered after import is always visible. */
export function contractRegistry(): Record<string, Contract> {
  const out: Record<string, Contract> = {};
  for (const r of DEFAULT_RULES) out[r.id] = invariantFromRule(r);
  for (const c of CONTRACT_CONTRACTS) out[c.id] = c;
  return out;
}

// ── Evaluator ──────────────────────────────────────────────────────────────────────

interface Tagged { d: Diagnostic; level: ContractLevel; kind: ContractKind }

/** Wrap an evaluate in the same guard the linter uses — a broken contract never crashes eval. */
function safeEval(
  c: Contract, ctx: DiagnosticContext, scope: ContractScope,
  params?: Record<string, number | string>,
): Diagnostic[] {
  try { return c.evaluate(ctx, scope, params); }
  catch { return []; }
}

const SEV_ORDER: Record<DiagnosticSeverity, number> = { error: 0, warn: 1, info: 2 };
const locusKey = (d: Diagnostic): string => JSON.stringify(d.locus ?? {});

/** Run world-level invariants globally + every declared scoped contract, and grade the findings.
 *  Deterministic for a world: stable sort by severity → rule → locus. */
export function evaluateContracts(
  ctx: DiagnosticContext,
  opts: { declarations?: ContractDeclaration[]; registry?: Record<string, Contract> } = {},
): ContractReport {
  const reg = opts.registry ?? contractRegistry();
  const decls = opts.declarations ?? ctx.map?.contracts?.declarations ?? [];
  const tagged: Tagged[] = [];

  // 1. World-level invariants always run globally (unscoped), regardless of declarations.
  for (const c of Object.values(reg)) {
    if (c.level !== 'world' || c.kind !== 'invariant') continue;
    for (const d of safeEval(c, ctx, {})) tagged.push({ d, level: c.level, kind: c.kind });
  }
  // 2. Declared (scoped) contracts run at their instance scope.
  for (const decl of decls) {
    const c = reg[decl.contract];
    if (!c) continue;
    for (const d of safeEval(c, ctx, decl.scope, decl.params)) {
      tagged.push({ d, level: c.level, kind: c.kind });
    }
  }

  // Stable-sort for a reproducible ordering.
  tagged.sort((a, b) => {
    const s = SEV_ORDER[a.d.severity] - SEV_ORDER[b.d.severity];
    if (s !== 0) return s;
    const r = a.d.rule.localeCompare(b.d.rule);
    if (r !== 0) return r;
    return locusKey(a.d).localeCompare(locusKey(b.d));
  });

  const counts: Record<DiagnosticSeverity, number> = { error: 0, warn: 0, info: 0 };
  const byRule: Record<string, number> = {};
  const byLevel: Record<ContractLevel, number> = { building: 0, site: 0, settlement: 0, world: 0 };
  const byKind: Record<ContractKind, number> = { invariant: 0, requirement: 0 };
  const diagnostics: Diagnostic[] = [];
  const unmet: Diagnostic[] = [];
  for (const t of tagged) {
    diagnostics.push(t.d);
    counts[t.d.severity]++;
    byRule[t.d.rule] = (byRule[t.d.rule] ?? 0) + 1;
    byLevel[t.level]++;
    byKind[t.kind]++;
    if (t.kind === 'requirement') unmet.push(t.d);
  }
  return { total: diagnostics.length, counts, byRule, byLevel, byKind, diagnostics, unmet };
}
