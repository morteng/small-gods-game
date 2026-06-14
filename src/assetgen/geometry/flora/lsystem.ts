// src/assetgen/geometry/flora/lsystem.ts
// A compact, seeded, stochastic context-free L-system string rewriter — the
// "good part" of lindenmayer (MIT) reimplemented so it (a) takes our sfc32 RNG
// for deterministic output and (b) carries zero dependencies. Symbols are single
// chars; the 3D turtle (turtle.ts) interprets the expanded string into geometry.
//
// A rule maps a symbol to either one successor string, or a weighted list of
// successors (stochastic). Unmatched symbols pass through unchanged (so the
// turtle commands +-&^\/[] survive rewriting verbatim).
import type { Rng } from '@/core/rng';

export interface StochasticChoice { to: string; prob: number }
export type Rule = string | StochasticChoice[];
export type Rules = Record<string, Rule>;

/** Pick a successor for a stochastic rule by cumulative weight. */
function chooseStochastic(choices: StochasticChoice[], rng: Rng): string {
  const total = choices.reduce((s, c) => s + c.prob, 0);
  let r = rng.next() * total;
  for (const c of choices) { r -= c.prob; if (r <= 0) return c.to; }
  return choices[choices.length - 1].to;
}

/** Expand `axiom` for `iterations` passes under `rules`. Deterministic given `rng`. */
export function expandLSystem(axiom: string, rules: Rules, iterations: number, rng: Rng): string {
  let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = '';
    for (const ch of s) {
      const rule = rules[ch];
      if (rule === undefined) { next += ch; continue; }
      next += typeof rule === 'string' ? rule : chooseStochastic(rule, rng);
    }
    s = next;
  }
  return s;
}
