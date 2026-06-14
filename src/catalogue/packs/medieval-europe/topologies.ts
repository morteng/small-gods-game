/**
 * medieval-europe pack — the four master TOPOLOGIES. A topology names the grammar
 * INTERPRETER (Slice 1) that wires a building type's zones into portals. The
 * interpreter ids are structural (engine-side) — the connectome grammar dispatches
 * on `fields.interpreter`. These four cover the medieval building stock; a future
 * pack adds its own topologies + interpreters with zero engine change.
 */
import type { FactEntry, TopologyFields } from '@/catalogue/types';

const t = (
  id: string,
  interpreter: string,
  l0: string,
  l1: string[],
  l2: string,
): FactEntry<TopologyFields> => ({
  id,
  kind: 'topology',
  pack: 'medieval-europe',
  lod: { l0, l1, l2 },
  fields: { interpreter },
  visibility: 'data-only',
});

export const MEDIEVAL_TOPOLOGIES: FactEntry<TopologyFields>[] = [
  t(
    'tripartite-linear',
    'tripartite-linear',
    'a single range read end-to-end: service · hall · upper end',
    ['linear bays', 'cross-passage entry', 'hearth in the hall'],
    'The dominant house form: rooms strung along one axis, entered through a cross-passage that punches both long walls. Service (pantry/buttery/byre) at one end, the hall with its hearth in the middle, parlour/solar at the upper end. Covers cottage, hall house, longhouse, manor, guildhall.',
  ),
  t(
    'courtyard-hub',
    'courtyard-hub',
    'ranges arranged around a central open court',
    ['central court', 'ranges open off it', 'gatehouse entry'],
    'A central courtyard zone with ranges opening off each side; circulation passes through the court. Inns, monasteries, courtyard almshouses, and larger manors.',
  ),
  t(
    'vertical-stack',
    'vertical-stack',
    'one room per level, stacked, joined by stairs',
    ['storey per level', 'stair portals', 'tall narrow plan'],
    'A compact footprint built upward, one principal chamber per floor linked by a stair or vice. Keeps, tower houses, bastles, and mills — the form that most readily takes a true wall-chimney.',
  ),
  t(
    'church-axial',
    'church-axial',
    'a processional west→east axis: porch · nave · chancel · altar',
    ['long axis', 'altar at the east', 'flanking aisles'],
    'An axial plan entered from the west or south porch, leading down the nave to the chancel and altar at the east, with aisles flanking the nave. Churches, hospitals, and aisled barns.',
  ),
];
