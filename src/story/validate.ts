/**
 * Pack validator — the public contract gate for (user-)authored story packs.
 *
 * Because packs are distributable UGC, validation is load-bearing, not a nicety.
 * It enforces the invariants the runtime assumes AND the one rule that keeps the
 * no-key path alive: every AI-optional slot must carry a non-empty `fallback`.
 *
 * `allowedVerbs` (optional) is the capability allowlist — the sandbox boundary.
 * Pass the bus's registered verbs and any effect referencing an unknown verb is
 * rejected before it can run.
 */
import type {
  StoryPack, Storylet, Node, TextSlot, ChoiceOption, IfBranch,
} from './story-ir';
import { STORY_IR_VERSION } from './story-ir';

export interface ValidateOptions {
  /** If provided, every effect verb must be in this set. */
  allowedVerbs?: ReadonlySet<string>;
}

export function validatePack(pack: StoryPack, opts: ValidateOptions = {}): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  if (pack.version !== STORY_IR_VERSION) {
    errors.push(`pack version ${pack.version} != engine version ${STORY_IR_VERSION}`);
  }
  if (pack.storylets.length === 0) errors.push('pack has no storylets');

  for (const s of pack.storylets) {
    if (ids.has(s.id)) errors.push(`duplicate storylet id: "${s.id}"`);
    ids.add(s.id);
  }

  for (const s of pack.storylets) {
    walkNodes(s.body, s, errors, opts);
  }

  // goto targets must resolve
  for (const s of pack.storylets) {
    forEachNode(s.body, (n) => {
      if (n.t === 'goto' && !ids.has(n.storylet)) {
        errors.push(`storylet "${s.id}": goto unknown target "${n.storylet}"`);
      }
    });
  }

  return errors;
}

function walkNodes(nodes: Node[], s: Storylet, errors: string[], opts: ValidateOptions): void {
  forEachNode(nodes, (n) => {
    switch (n.t) {
      case 'say':
        checkText(n.text, s, errors);
        break;
      case 'choice':
        if (n.options.length === 0) errors.push(`storylet "${s.id}": choice with no options`);
        n.options.forEach((o: ChoiceOption) => checkText(o.text, s, errors));
        break;
      case 'do':
        if (!n.effect.verb) errors.push(`storylet "${s.id}": effect with empty verb`);
        else if (opts.allowedVerbs && !opts.allowedVerbs.has(n.effect.verb)) {
          errors.push(`storylet "${s.id}": effect verb "${n.effect.verb}" not in capability allowlist`);
        }
        break;
    }
  });
}

function checkText(slot: TextSlot, s: Storylet, errors: string[]): void {
  if (typeof slot === 'string') return;
  if ('pick' in slot) {
    if (slot.pick.length === 0) errors.push(`storylet "${s.id}": empty pick`);
    return;
  }
  // the no-key law
  if (!slot.fallback || slot.fallback.length === 0) {
    errors.push(`storylet "${s.id}": AI-optional slot "${slot.enrich.slotId}" has no fallback`);
  }
}

/** Depth-first walk over a node tree (into choice options & if branches). */
export function forEachNode(nodes: Node[], visit: (n: Node) => void): void {
  for (const n of nodes) {
    visit(n);
    if (n.t === 'choice') n.options.forEach((o: ChoiceOption) => forEachNode(o.body, visit));
    else if (n.t === 'if') n.branches.forEach((b: IfBranch) => forEachNode(b.body, visit));
  }
}
