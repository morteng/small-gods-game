/**
 * medieval-europe pack — COMPLEX TYPES. Multi-building defended works expanded by the
 * `enclosure` interpreter (see blueprint/connectome/complex.ts). Each names its wards
 * (district zones + the buildings inside them), its barrier rings (inner→outer) with
 * gate counts, and — for earthwork castles — a motte/ditch/rampart programme that the
 * siting step balances by conservation of spoil.
 *
 * The fortification ladder (ringwork → motte-and-bailey → … → concentric) is a wealth/
 * era progression; DC-1 seeds the timber end + the retrofit town wall. Building ids
 * reference existing buildingTypes so each ward leaf resolves to a real blueprint.
 */
import type { ComplexTypeFields, FactEntry } from '@/catalogue/types';

const cx = (
  id: string,
  fields: ComplexTypeFields,
  l0: string,
  l1: string[],
  l2: string,
  provenance?: string[],
): FactEntry<ComplexTypeFields> => ({
  id,
  kind: 'complexType',
  pack: 'medieval-europe',
  applicability: { eras: ['medieval'] },
  lod: { l0, l1, l2 },
  fields,
  visibility: 'geometry',
  ...(provenance ? { provenance } : {}),
});

export const MEDIEVAL_COMPLEX_TYPES: FactEntry<ComplexTypeFields>[] = [
  cx(
    'motte_and_bailey',
    {
      topology: 'enclosure',
      wards: [
        // ring 0 = motte top (core/refuge, holds the keep); ring 1 = bailey court.
        { type: 'motte-top', ring: 0, core: true, buildings: ['castle_keep'] },
        {
          type: 'bailey',
          ring: 1,
          buildings: ['manor', 'shrine', 'farm_barn', 'smithy', 'granary'],
          fixtures: ['well'], // siege water MUST sit inside the walls
        },
      ],
      rings: [
        { barrier: 'palisade', radius: 6, gates: 1 }, // ring around the motte top
        { barrier: 'palisade', radius: 20, gates: 1 }, // the bailey palisade-on-rampart
      ],
      earthworks: {
        motteHeight: 8,
        motteTopRadius: 5,
        slope: 1.5,
        rampartHeight: 2,
        rampartWidth: 4,
        ditchWidth: 5,
      },
      desiredHeight: 8,
    },
    'a timber motte-and-bailey castle',
    ['an artificial mound (motte) topped by a keep', 'a palisaded courtyard (bailey)', 'ditch and rampart', 'a flying bridge to the motte'],
    'The classic Norman earth-and-timber castle: a flat-topped mound (the motte) raised from ditch spoil and crowned by a palisaded keep, beside an enclosed bailey holding the hall, chapel, stores and stables. Cheap, fast, and thrown up in weeks — the form a stone castle later replaced in place.',
    ['https://en.wikipedia.org/wiki/Motte-and-bailey_castle'],
  ),
  cx(
    'ringwork',
    {
      topology: 'enclosure',
      wards: [
        { type: 'bailey', ring: 0, core: true, buildings: ['manor', 'farm_barn'], fixtures: ['well'] },
      ],
      rings: [{ barrier: 'rampart', radius: 16, gates: 1 }],
      earthworks: {
        motteHeight: 0, // no mound — a ringwork is a single banked enclosure
        motteTopRadius: 0,
        slope: 1.5,
        rampartHeight: 3,
        rampartWidth: 5,
        ditchWidth: 6,
      },
      desiredHeight: 0,
    },
    'a banked ringwork enclosure',
    ['a single circular bank and ditch', 'a palisade on the crest', 'no motte', 'a simple gate'],
    'A castle without a motte: one circular rampart-and-ditch enclosure with a timber palisade and a gate. Cheaper than a motte-and-bailey and often raised where the ground or the haste forbade a mound; some were later heightened into mottes.',
    ['https://en.wikipedia.org/wiki/Ringwork'],
  ),
  cx(
    'town_wall',
    {
      // A RETROFIT: one ring wrapped around an existing settlement ward. Realised via
      // encloseExisting in practice; seeded as a complexType so the schema carries it.
      topology: 'enclosure',
      wards: [{ type: 'high-street', ring: 0, core: false }],
      rings: [{ barrier: 'town-wall', radius: 40, gates: 4 }],
      desiredHeight: 0,
    },
    'a walled town circuit',
    ['a masonry wall around the town', 'four strongly-gated entrances', 'mural towers', 'follows the built-up edge'],
    'The defensive circuit of an existing town — streets and plots predate it, so the wall follows the built-up edge and is pierced by a handful of heavily-gated entrances. The commonest large defensive work, and a retrofit rather than a freestanding build.',
    ['https://en.wikipedia.org/wiki/Defensive_wall#Town_walls'],
  ),
];
