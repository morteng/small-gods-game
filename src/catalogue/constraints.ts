/**
 * Constraint engine — declarative validation over catalogue entries and (Slice 1)
 * connectomes. Domain-neutral: the predicates and auto-corrections live in the
 * content pack; this module only runs them and collects issues.
 *
 * `severity: 'error'` blocks resolution; `'warn'` logs and (when `apply:true`) runs
 * `autoCorrect` to repair the target. The headline rule — "no chimney before the
 * late medieval period" — is a `warn` that downgrades the egress to a louver.
 */
import type { CatalogueRegistry } from '@/catalogue/registry';

export type Severity = 'error' | 'warn';

export interface Constraint<T = unknown> {
  id: string;
  /** Optional scope hint (catalogue kind, or a connectome marker) — informational. */
  kind?: string;
  severity: Severity;
  /** True = the target satisfies the constraint. */
  check: (target: T, registry: CatalogueRegistry) => boolean;
  message: string;
  /** Returns a repaired copy of the target. Only invoked for `warn` + `apply:true`. */
  autoCorrect?: (target: T, registry: CatalogueRegistry) => T;
}

export interface Issue {
  constraintId: string;
  severity: Severity;
  message: string;
}

export interface ValidateResult<T> {
  issues: Issue[];
  /** Present only when `apply:true` and at least one auto-correction ran. */
  corrected?: T;
}

export interface ValidateOpts {
  /** When true, run `autoCorrect` for failing `warn` constraints and return the repaired target. */
  apply?: boolean;
}

export function validate<T>(
  target: T,
  constraints: Constraint<T>[],
  registry: CatalogueRegistry,
  opts: ValidateOpts = {},
): ValidateResult<T> {
  const issues: Issue[] = [];
  let current = target;
  let didCorrect = false;

  for (const c of constraints) {
    if (c.check(current, registry)) continue;
    issues.push({ constraintId: c.id, severity: c.severity, message: c.message });
    if (opts.apply && c.severity === 'warn' && c.autoCorrect) {
      current = c.autoCorrect(current, registry);
      didCorrect = true;
    }
  }

  return didCorrect ? { issues, corrected: current } : { issues };
}
