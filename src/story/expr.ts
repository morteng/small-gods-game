/**
 * Expression & condition evaluation.
 *
 * Pure over a `ReadonlyScope` plus the seeded RNG (for `chance`). No host effects.
 * Determinism note: the ONLY entropy source is `rng`, so the same scope + same RNG
 * state always evaluates identically — a hard requirement for replay/snapshot.
 */
import type { Rng } from '@/core/rng';
import type { Expr, Condition, Value } from './story-ir';
import type { ReadonlyScope } from './story-state';

export function evalExpr(expr: Expr, scope: ReadonlyScope, rng: Rng): Value {
  if (expr === null || typeof expr !== 'object') return expr; // literal

  if ('var' in expr) return scope.get(expr.var) ?? null;
  if ('not' in expr) return !truthy(evalExpr(expr.not, scope, rng));
  if ('chance' in expr) return rng.next() < 1 / Math.max(1, expr.chance);

  // binary op
  const op = expr.op;
  if (op === '&&') return truthy(evalExpr(expr.l, scope, rng)) && truthy(evalExpr(expr.r, scope, rng));
  if (op === '||') return truthy(evalExpr(expr.l, scope, rng)) || truthy(evalExpr(expr.r, scope, rng));

  const l = evalExpr(expr.l, scope, rng);
  const r = evalExpr(expr.r, scope, rng);
  switch (op) {
    case '==': return l === r;
    case '!=': return l !== r;
    case '<': return num(l) < num(r);
    case '<=': return num(l) <= num(r);
    case '>': return num(l) > num(r);
    case '>=': return num(l) >= num(r);
    case '+': return num(l) + num(r);
    case '-': return num(l) - num(r);
    case '*': return num(l) * num(r);
  }
}

export function evalCondition(cond: Condition, scope: ReadonlyScope, rng: Rng): boolean {
  return truthy(evalExpr(cond, scope, rng));
}

/** Falsy: null, false, 0, NaN, ''. Everything else truthy. */
export function truthy(v: Value): boolean {
  if (v === null || v === false) return false;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  return true;
}

function num(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') { const n = Number(v); return Number.isNaN(n) ? 0 : n; }
  return 0;
}
