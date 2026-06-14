/**
 * medieval-europe pack — declarative GRAMMAR RULES. Data the connectome grammar
 * interpreter (Slice 1, `src/blueprint/connectome/grammar.ts`) reads to wire zones
 * into portals. Kept declarative so a cheap agent can tweak topology behaviour
 * without touching engine code. The interpreter dispatches on `topology`; these
 * rules carry the per-topology knobs.
 */
import type { GrammarRule } from '@/catalogue/pack';

export const MEDIEVAL_GRAMMAR_RULES: GrammarRule[] = [
  {
    id: 'tripartite-cross-passage',
    topology: 'tripartite-linear',
    // ≥2 rooms ⇒ a cross-passage punches BOTH long walls (opposed exterior doors)
    crossPassageMinRooms: 2,
    interiorDoorsBetweenAdjacentZones: true,
  },
  {
    id: 'courtyard-ranges',
    topology: 'courtyard-hub',
    // every range zone opens onto the central court via an interior door
    courtZoneFn: 'circulation',
    rangesOpenOntoCourt: true,
  },
  {
    id: 'vertical-stairs',
    topology: 'vertical-stack',
    // one zone per level; stair portals link consecutive levels
    stairBetweenLevels: true,
  },
  {
    id: 'church-axis',
    topology: 'church-axial',
    // porch → nave → chancel along the axis; aisles flank the nave
    axisOrder: ['porch', 'nave', 'chancel'],
    aislesFlank: 'nave',
    altarAt: 'east',
  },
];
