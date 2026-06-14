/**
 * medieval-europe pack — BARRIER TYPES. Linear defensive structures: the rings of a
 * castle and the spanning works (dykes, town walls). `kind` tells the world how to
 * realise each — a `wall` is built fabric, a `bank`/`ditch` is an earthwork the
 * heightfield carries. Ordered roughly weakest→strongest so a wealth/era gate can
 * walk the ladder (timber palisade → stone curtain).
 */
import type { BarrierTypeFields, FactEntry } from '@/catalogue/types';

const bar = (
  id: string,
  fields: BarrierTypeFields,
  l0: string,
  l1: string[],
  l2: string,
  provenance?: string[],
): FactEntry<BarrierTypeFields> => ({
  id,
  kind: 'barrierType',
  pack: 'medieval-europe',
  lod: { l0, l1, l2 },
  fields,
  visibility: 'geometry',
  ...(provenance ? { provenance } : {}),
});

export const MEDIEVAL_BARRIER_TYPES: FactEntry<BarrierTypeFields>[] = [
  bar(
    'rampart',
    { kind: 'bank', defensibility: 0.4, heightHint: 2.5 },
    'an earthen bank thrown up from the ditch spoil',
    ['heaped earth bank', 'palisade along the crest', 'spoil from the ditch'],
    'The defensive bank raised from the earth dug out of the ditch — the cheapest enclosure, usually crowned by a timber palisade. The bank and ditch are made in one operation, so their volumes balance.',
    ['https://en.wikipedia.org/wiki/Rampart_(fortification)'],
  ),
  bar(
    'ditch',
    { kind: 'ditch', defensibility: 0.6, heightHint: 3 },
    'a dry ditch encircling the work',
    ['steep-sided cut', 'spoil thrown inward', 'wet if water is near'],
    'The encircling ditch (fosse). Dry on high ground; where the water table or a river allows, it fills as a wet moat. Its spoil builds the rampart and motte.',
    ['https://en.wikipedia.org/wiki/Defensive_fighting_position'],
  ),
  bar(
    'palisade',
    { kind: 'wall', defensibility: 0.5, material: 'timber', heightHint: 3 },
    'a timber stockade of upright logs',
    ['close-set tree-trunks', 'pointed tops', 'fighting walk behind'],
    'A wall of split or whole tree-trunks set upright in the rampart crest, with a walkway behind. The standard early enclosure — fast, cheap, and flammable; the form a stone curtain later replaced.',
    ['https://en.wikipedia.org/wiki/Palisade'],
  ),
  bar(
    'curtain-wall',
    { kind: 'wall', defensibility: 0.85, material: 'stone', heightHint: 8 },
    'a high stone curtain between mural towers',
    ['ashlar or rubble masonry', 'crenellated parapet', 'wall-walk', 'flanking towers'],
    'The stone wall that replaced the palisade from the 12th century: a tall crenellated curtain with a wall-walk, flanked by projecting mural towers so defenders can rake the foot of the wall. The defining element of the stone castle.',
    ['https://en.wikipedia.org/wiki/Defensive_wall'],
  ),
  bar(
    'town-wall',
    { kind: 'wall', defensibility: 0.8, material: 'stone', heightHint: 7 },
    'the masonry wall enclosing a town',
    ['continuous circuit', 'gates and posterns', 'mural towers', 'sometimes a berm and ditch'],
    'The defensive circuit wrapped around an existing town — pierced by a handful of strongly-gated entrances. A retrofit: the streets and plots predate the wall, which follows the built-up edge.',
    ['https://en.wikipedia.org/wiki/Defensive_wall#Town_walls'],
  ),
  bar(
    'earth-dyke',
    { kind: 'bank', defensibility: 0.3, heightHint: 2 },
    'a long linear bank-and-ditch across the land',
    ['runs for miles', 'bank on one side, ditch on the other', 'no enclosure'],
    'A frontier earthwork that SPANS rather than encloses — a bank and ditch drawn across country to mark and hold a border (Offa’s Dyke, Wansdyke). Modelled as a spanning barrier with no zone it bounds.',
    ['https://en.wikipedia.org/wiki/Offa%27s_Dyke'],
  ),
];
