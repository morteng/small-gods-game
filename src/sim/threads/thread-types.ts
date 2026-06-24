/**
 * Narrative substrate — core thread types.
 *
 * A PlotThread is the sim's record of a multi-stage dramatic arc: a subject
 * (an NPC, a settlement, or a spirit) moving through the ordered phases of a
 * *shape* (see shape-registry.ts). This layer SENSES and TRACKS; the authoring
 * intelligence (which arcs are worth recognizing) is the future Fate brain.
 * See docs/superpowers/specs/2026-06-04-narrative-substrate-design.md.
 */
import type { EntityId } from '@/core/types';
import type { SpiritId } from '@/core/spirit';

export type ThreadId = number;
export type ShapeId = string;

export type ThreadSubject =
  | { kind: 'npc'; npcId: EntityId }
  | { kind: 'settlement'; poiId: string }
  | { kind: 'spirit'; spiritId: SpiritId }
  /** W-I: an ephemeral causal site (a god-flooded plain). Its id is poiId-compatible. */
  | { kind: 'site'; siteId: string };

export type NarrativeWeight = 'setup' | 'rising' | 'climax' | 'resolution';

/** 'staged' anticipates the prospective layer (Slice 2); Slice-1 recognizers
 *  only ever produce 'active' → 'resolved' | 'abandoned'. */
export type ThreadStatus = 'staged' | 'active' | 'resolved' | 'abandoned';

export interface ContributingEvent {
  eventId: number;
  phase: string;
  tick: number;
}

export interface PlotThread {
  id: ThreadId;
  shapeId: ShapeId;
  subject: ThreadSubject;
  /** Current phase id within the shape. */
  phase: string;
  status: ThreadStatus;
  openedTick: number;
  updatedTick: number;
  contributingEvents: ContributingEvent[];
  /** Recognizer bookkeeping (e.g. peak severity seen). */
  vars: Record<string, number>;
}

/** Stable key for indexing/comparing subjects. */
export function subjectKey(s: ThreadSubject): string {
  switch (s.kind) {
    case 'npc': return `npc:${s.npcId}`;
    case 'settlement': return `set:${s.poiId}`;
    case 'spirit': return `spr:${s.spiritId}`;
    case 'site': return `site:${s.siteId}`;
  }
}
