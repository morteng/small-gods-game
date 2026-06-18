/**
 * Storylet IR — the dual-consumer, capability-sandboxed authored-narrative format.
 *
 * One body of content, two consumers:
 *  - the DUMB director (no AI key) plays it deterministically and standalone;
 *  - the FATE director (AI key) uses the SAME data as a reservoir to draw from,
 *    narrating transitions and rewriting AI-optional slots.
 *
 * Concepts borrowed from Loreline (jeremyfa/loreline) — `beat` bodies of say /
 * choice / if / set / goto nodes, `pick`-variant text, `chance()`, save/restore —
 * but rebuilt natively so it lives inside our seeded-RNG / command-bus / World
 * discipline instead of a foreign runtime. The single hard rule that makes the
 * no-key path possible: **no IR node may REQUIRE the AI to be runnable.** Every
 * AI-touchable slot carries a deterministic `fallback` (enforced by the type AND
 * the validator).
 *
 * `version` is the public contract for user-authored story packs — bump it only
 * with a migration, the same discipline as ART_RECIPE_VERSION / save gating.
 */

export type Value = string | number | boolean | null;

// ── Expressions & conditions ──────────────────────────────────────────────────

export type BinOp =
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | '&&' | '||'
  | '+' | '-' | '*';

/** A pure expression over scope fields + a seeded `chance`. No host side effects. */
export type Expr =
  | Value
  | { var: string }                       // read a scope/host field, e.g. "elder.faith"
  | { not: Expr }
  | { op: BinOp; l: Expr; r: Expr }
  | { chance: number };                   // borrowed from Loreline: 1-in-N, seeded

/** An expression evaluated for truthiness. */
export type Condition = Expr;

// ── Text slots — the dual-consumer enrichment seam ────────────────────────────

/** Free-form direction for an AI director; entirely ignored by the dumb one. */
export interface EnrichHint {
  /** Stable id so an AI rewrite can be cached/persisted deterministically. */
  slotId: string;
  /** What the AI should produce in place of the fallback. */
  prompt?: string;
  /** Style exemplars (often the original pick-variants) for the AI to imitate. */
  exemplars?: string[];
}

/**
 * A piece of authored text. Three forms, in ascending AI-involvement:
 *  - a literal string (may contain `$path` interpolation);
 *  - `{ pick }` — deterministic variant chosen by the seeded RNG (Loreline `pick`);
 *  - `{ fallback, enrich }` — AI-OPTIONAL. `fallback` is ALWAYS present so the
 *    no-key path renders; a Fate director may replace it via `enrich`.
 */
export type TextSlot =
  | string
  | { pick: string[] }
  | { fallback: string; enrich: EnrichHint };

// ── Effects — host commands (capability-sandboxed bus verbs) ───────────────────

/**
 * A side effect on the game world. Dispatched to the host, which routes it onto
 * the command/query bus — so authored content can only ever invoke REGISTERED,
 * safe capabilities (the sandbox boundary for user-authored packs). NPC-connected
 * animation commands are just effects with the relevant verb.
 */
export interface Effect {
  verb: string;
  args?: Record<string, unknown>;
}

// ── Body nodes ────────────────────────────────────────────────────────────────

export type Node =
  | SayNode | ChoiceNode | IfNode | SetNode | DoNode | GotoNode | EndNode;

/** A line. `who` null/absent = narration; otherwise a speaker key. */
export interface SayNode { t: 'say'; who?: string | null; text: TextSlot; tags?: string[]; }

/** A branch point presented to the player. Options whose `when` is false are hidden. */
export interface ChoiceNode { t: 'choice'; options: ChoiceOption[]; }
export interface ChoiceOption { text: TextSlot; when?: Condition; body: Node[]; }

/** if / else-if / else. A trailing branch with no `when` is the `else`. */
export interface IfNode { t: 'if'; branches: IfBranch[]; }
export interface IfBranch { when?: Condition; body: Node[]; }

/** Mutate a scope field. World mutation goes through effects, never `set`. */
export interface SetNode { t: 'set'; target: string; op: SetOp; value: Expr; }
export type SetOp = '=' | '+=' | '-=';

/** Fire a host effect (bus command). */
export interface DoNode { t: 'do'; effect: Effect; }

/** Jump to another storylet (Loreline `-> Beat`). Replaces the current frame stack. */
export interface GotoNode { t: 'goto'; storylet: string; }

/** End the current playthrough of this pack. */
export interface EndNode { t: 'end'; }

// ── Storylet & pack ───────────────────────────────────────────────────────────

/**
 * The reservoir unit: a Loreline `beat` plus `when` preconditions and a `priority`,
 * so the "graph" between storylets emerges from state-gating rather than hand-drawn
 * (and merge-fragile) edges. Local branching lives INSIDE the body via choice/if/goto.
 */
export interface Storylet {
  id: string;
  title?: string;
  tags?: string[];
  /** All must be truthy for the storylet to be eligible for selection. */
  when?: Condition[];
  /** Higher wins in the dumb selector; ties broken by the seeded RNG. */
  priority?: number;
  /** Fire at most once per playthrough. */
  once?: boolean;
  /** Fields seeded into scope on first entry (only if absent). */
  state?: Record<string, Value>;
  body: Node[];
}

/** A self-contained, distributable unit of authored content. */
export interface StoryPack {
  id: string;
  title?: string;
  /** IR version — the public contract for user-authored packs. */
  version: number;
  /** Shared initial scope (characters, world flags). */
  state?: Record<string, Value>;
  storylets: Storylet[];
}

export const STORY_IR_VERSION = 1;
