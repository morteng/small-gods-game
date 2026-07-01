// The shared seam every divine-action surface renders (powers panel, hover
// popover, inspector, inbox, Fate card): "a verb I could issue now." Derived —
// registry ∩ belief-unlock ∩ context — never authored. See
// docs/superpowers/specs/2026-07-01-agent-driven-ui-semantic-zoom-spec.md §2.
import type { CommandVerb } from '@/sim/command/types';
import type { Preview } from '@/sim/command/preview';

/** Target vocabulary. `entity`/`tile`/`area` land in P2+; P1 produces npc/settlement/none. */
export type TargetKind = 'npc' | 'entity' | 'settlement' | 'tile' | 'area' | 'none';

export interface CommandAffordance {
  verb: CommandVerb;
  /** Human/agent-readable, from `CapabilityDef.describe()`. */
  label: string;
  targetKind: TargetKind;
  /** Reticle shape (see `capFootprint`). */
  footprint: 'point' | 'area';
  /** 'leaf' fires immediately; 'branch' expands to a UiSpec card (see `capShape`). */
  shape: 'leaf' | 'branch';
  /** Belief gate: false ⇒ conviction below the domain's unlock threshold (render locked). */
  unlocked: boolean;
  /** Structured cost / affordability / block reason (see `derivePreview`). */
  preview: Preview;
}
