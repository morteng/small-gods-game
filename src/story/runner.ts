/**
 * StoryRunner — the deterministic stepper that walks one storylet body.
 *
 * Execution is an explicit stack of frames (`{ nodes, ip }`); choice options and
 * if-branches push child frames. Driving by an instruction pointer rather than JS
 * generators keeps the machine inspectable and (scope/RNG/seen) snapshot-friendly.
 *
 * `advance()` runs until it must surface something to the caller, returning a
 * `Yield`:
 *  - `say`    — a resolved line; caller renders, then calls `advance()` again.
 *  - `effect` — a host command; caller dispatches it, then calls `advance()`.
 *  - `choice` — caller renders options, then calls `choose(index)` before advancing.
 *  - `end`    — this playthrough of the current storylet is done.
 *
 * Determinism: the only entropy is the injected `Rng`. Same pack + seed + same
 * choice sequence ⇒ identical yield stream. `goto` replaces the whole stack
 * (Loreline `-> Beat`); re-entering a `once` storylet is the selector's job.
 */
import type { Rng } from '@/core/rng';
import type { StoryPack, Storylet, Node, ChoiceNode, Effect, Expr } from './story-ir';
import { Scope } from './story-state';
import type { Director } from './director';
import { evalExpr, evalCondition } from './expr';
import { resolveText } from './text';

export interface StageLine { who: string | null; text: string; tags: string[]; }
export interface StageChoice { index: number; text: string; }

export type Yield =
  | { kind: 'say'; line: StageLine }
  | { kind: 'choice'; options: StageChoice[] }
  | { kind: 'effect'; effect: Effect }
  | { kind: 'end' };

interface Frame { nodes: Node[]; ip: number; }

export class StoryRunner {
  private readonly byId = new Map<string, Storylet>();
  private stack: Frame[] = [];
  private current: string | null = null;
  private pending: ChoiceNode | null = null;
  readonly seen = new Set<string>();

  constructor(
    pack: StoryPack,
    readonly scope: Scope,
    private readonly rng: Rng,
    private readonly director?: Director,
  ) {
    for (const s of pack.storylets) this.byId.set(s.id, s);
  }

  get currentStorylet(): string | null { return this.current; }
  get awaitingChoice(): boolean { return this.pending !== null; }

  /** Enter a storylet, seeding its local state and resetting the frame stack. */
  enter(id: string): void {
    const s = this.byId.get(id);
    if (!s) throw new Error(`storylet not found: "${id}"`);
    if (s.state) for (const [k, v] of Object.entries(s.state)) this.scope.initIfAbsent(k, v);
    this.seen.add(id);
    this.current = id;
    this.pending = null;
    this.stack = [{ nodes: s.body, ip: 0 }];
  }

  /** Advance until the next thing the caller must handle. */
  advance(): Yield {
    if (this.pending) throw new Error('advance() called while awaiting a choice');

    // A `goto` cycle with no intervening yield (a→b→a…) would spin here forever,
    // synchronously — so nothing outside, not even a timer-based test timeout,
    // could interrupt it. Bound the work a single advance() may do.
    let guard = 0;
    for (;;) {
      if (++guard > 1_000_000) throw new Error('story runner stalled (goto cycle?)');
      const frame = this.stack[this.stack.length - 1];
      if (!frame) return { kind: 'end' };
      if (frame.ip >= frame.nodes.length) { this.stack.pop(); continue; }

      const node = frame.nodes[frame.ip++];
      switch (node.t) {
        case 'say':
          return {
            kind: 'say',
            line: {
              who: node.who ?? null,
              text: resolveText(node.text, this.scope, this.rng, this.director),
              tags: node.tags ?? [],
            },
          };

        case 'do':
          return { kind: 'effect', effect: node.effect };

        case 'set':
          this.applySet(node.target, node.op, node.value);
          continue;

        case 'if': {
          for (const b of node.branches) {
            if (b.when === undefined || evalCondition(b.when, this.scope, this.rng)) {
              this.stack.push({ nodes: b.body, ip: 0 });
              break;
            }
          }
          continue;
        }

        case 'choice': {
          const options = this.eligibleOptions(node);
          if (options.length === 0) continue; // no option satisfiable → skip
          this.pending = node;
          return { kind: 'choice', options };
        }

        case 'goto':
          this.enter(node.storylet);
          continue;

        case 'end':
          this.stack = [];
          return { kind: 'end' };
      }
    }
  }

  /** Resolve a presented choice by the `index` from its `StageChoice`. */
  choose(index: number): void {
    if (!this.pending) throw new Error('choose() called with no pending choice');
    const opt = this.pending.options[index];
    if (!opt) throw new Error(`invalid choice index: ${index}`);
    this.pending = null;
    this.stack.push({ nodes: opt.body, ip: 0 });
  }

  private applySet(target: string, op: '=' | '+=' | '-=', expr: Expr): void {
    const val = evalExpr(expr, this.scope, this.rng);
    if (op === '=') { this.scope.set(target, val); return; }
    const cur = Number(this.scope.get(target) ?? 0);
    this.scope.set(target, op === '+=' ? cur + Number(val ?? 0) : cur - Number(val ?? 0));
  }

  private eligibleOptions(node: ChoiceNode): StageChoice[] {
    const out: StageChoice[] = [];
    node.options.forEach((opt, i) => {
      if (opt.when === undefined || evalCondition(opt.when, this.scope, this.rng)) {
        out.push({ index: i, text: resolveText(opt.text, this.scope, this.rng, this.director) });
      }
    });
    return out;
  }
}
