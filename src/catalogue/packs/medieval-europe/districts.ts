/**
 * medieval-europe pack — DISTRICT TYPES (settlement connectome, Slice 5).
 * Seeded now so the schema is proven to carry them; NO consumer reads them yet.
 * Each district is a Zone in the future settlement-scale connectome, with a
 * `placement` hint (the logic that puts noxious/fire-risk trades on the edges,
 * water trades on the river, clean high-value trades central).
 */
import type { FactEntry } from '@/catalogue/types';

interface DistrictTypeFields {
  placement?: string; // 'centre' | 'edge' | 'riverside' | 'downwind' | 'gate' | 'rim'
  trades?: string[]; // tradeType ids typically found here
}

const d = (
  id: string,
  placement: string,
  l0: string,
  l1: string[],
  trades?: string[],
): FactEntry<DistrictTypeFields> => ({
  id,
  kind: 'districtType',
  pack: 'medieval-europe',
  lod: { l0, l1 },
  fields: trades ? { placement, trades } : { placement },
  visibility: 'data-only',
});

export const MEDIEVAL_DISTRICT_TYPES: FactEntry<DistrictTypeFields>[] = [
  d('market-square', 'centre', 'the central market place', ['open square', 'market cross', 'stalls'], ['merchant', 'baker']),
  d('high-street', 'centre', 'the principal trading street', ['frontage shops', 'burgage rows']),
  d('shambles', 'downwind', 'the butchers’ row', ['narrow lane', 'overhanging upper floors', 'offal channel'], ['butcher']),
  d('tannery-quarter', 'downwind', 'the tanners’ quarter', ['stinking pits', 'set apart', 'downstream'], ['tanner']),
  d('wharf', 'riverside', 'the river wharf', ['quays', 'warehouses', 'cranes'], ['merchant']),
  d('religious-close', 'centre', 'the precinct around the church', ['churchyard', 'walled close']),
  d('castle-ward', 'edge', 'the fortified ward', ['curtain wall', 'bailey']),
  d('burgage-rows', 'centre', 'rows of long narrow burgage plots', ['gable frontages', 'long back yards']),
  d('common-green', 'centre', 'the common or green', ['open grazing', 'pond', 'well']),
  d('mill-district', 'riverside', 'the mills by the water', ['leats', 'wheels'], ['miller']),
  d('suburb', 'edge', 'the extra-mural suburb', ['ribbon development', 'beyond the gate']),
  d('smiths-row', 'edge', 'the metalworkers’ row (fire risk)', ['forges', 'set from timber'], ['smith']),
  // ── defended-complex wards (Slice DC-1) ──
  d('bailey', 'edge', 'the enclosed courtyard ward of a castle', ['palisade or curtain', 'hall, chapel, stables, stores', 'the well']),
  d('motte-top', 'centre', 'the fortified summit of the motte', ['ring palisade', 'the keep', 'commands the bailey']),
];
