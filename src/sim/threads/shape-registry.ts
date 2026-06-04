/**
 * Thread shapes — data-driven story templates.
 *
 * A shape is PURE DATA: an ordered phase list, each phase tagged with a
 * narrative weight. No shape is special-cased in code; recognizers reference
 * shapes by id, and adding a shape (incl. future Fate/authored ones) is adding
 * data. `monomyth` deliberately ships WITHOUT a recognizer — its presence proves
 * data and recognition are decoupled (a shape can exist awaiting the brain).
 */
import type { ShapeId, NarrativeWeight, ThreadSubject } from './thread-types';

export interface ThreadShape {
  id: ShapeId;
  name: string;
  subjectKind: ThreadSubject['kind'];
  /** Ordered; phases[0] is the initial phase a thread opens at. */
  phases: { id: string; weight: NarrativeWeight }[];
}

export const SHAPES: Record<ShapeId, ThreadShape> = {
  'loss-given-meaning': {
    id: 'loss-given-meaning',
    name: 'A loss given meaning',
    subjectKind: 'npc',
    phases: [
      { id: 'loss', weight: 'setup' },
      { id: 'reaching', weight: 'rising' },
      { id: 'meaning', weight: 'climax' },
      { id: 'carried', weight: 'resolution' },
    ],
  },
  'trial': {
    id: 'trial',
    name: 'A settlement in trial',
    subjectKind: 'settlement',
    phases: [
      { id: 'onset', weight: 'setup' },
      { id: 'hardship', weight: 'rising' },
      { id: 'turning', weight: 'climax' },
      { id: 'aftermath', weight: 'resolution' },
    ],
  },
  'monomyth': {
    id: 'monomyth',
    name: "A hero's journey",
    subjectKind: 'npc',
    phases: [
      { id: 'call', weight: 'setup' },
      { id: 'threshold', weight: 'rising' },
      { id: 'ordeal', weight: 'climax' },
      { id: 'return', weight: 'resolution' },
    ],
  },
};

export function getShape(id: ShapeId): ThreadShape {
  const s = SHAPES[id];
  if (!s) throw new Error(`Unknown thread shape: ${id}`);
  return s;
}

/** The narrative weight of a given phase in a shape (throws on bad phase). */
export function phaseWeight(shapeId: ShapeId, phase: string): NarrativeWeight {
  const p = getShape(shapeId).phases.find(x => x.id === phase);
  if (!p) throw new Error(`Shape ${shapeId} has no phase ${phase}`);
  return p.weight;
}

/** Throw if any seed shape is malformed (non-empty phases, unique ids, one climax). */
export function validateShapes(): void {
  for (const s of Object.values(SHAPES)) {
    if (s.phases.length === 0) throw new Error(`Shape ${s.id} has no phases`);
    const ids = s.phases.map(p => p.id);
    if (new Set(ids).size !== ids.length) throw new Error(`Shape ${s.id} has duplicate phase ids`);
    const climaxes = s.phases.filter(p => p.weight === 'climax').length;
    if (climaxes !== 1) throw new Error(`Shape ${s.id} must have exactly one climax (has ${climaxes})`);
  }
}
