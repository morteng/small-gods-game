/**
 * medieval-europe pack — TRADE TYPES (settlement economy, Slice 5). Seeded now to
 * prove the schema carries the economic-edge graph; NO consumer yet. `consumes` /
 * `produces` are commodity tokens — the future settlement connectome wires
 * producer→consumer edges from them (farms→grain→miller→flour→baker→bread, etc.).
 * The smith is the universal supplier hub (no inputs modelled).
 */
import type { FactEntry } from '@/catalogue/types';

interface TradeTypeFields {
  consumes?: string[]; // commodity tokens this trade takes in
  produces?: string[]; // commodity tokens it puts out
  building?: string; // buildingType id it typically occupies
}

const t = (
  id: string,
  l0: string,
  fields: TradeTypeFields,
): FactEntry<TradeTypeFields> => ({
  id,
  kind: 'tradeType',
  pack: 'medieval-europe',
  lod: { l0, l1: [] },
  fields,
  visibility: 'data-only',
});

export const MEDIEVAL_TRADE_TYPES: FactEntry<TradeTypeFields>[] = [
  t('farmer', 'a farmer raising crops and stock', { produces: ['grain', 'wool', 'hides', 'livestock'] }),
  t('miller', 'a miller grinding grain to flour', { consumes: ['grain'], produces: ['flour'], building: 'watermill' }),
  t('baker', 'a baker making bread', { consumes: ['flour'], produces: ['bread'], building: 'bakehouse' }),
  t('butcher', 'a butcher slaughtering stock', { consumes: ['livestock'], produces: ['meat', 'hides'] }),
  t('tanner', 'a tanner curing leather', { consumes: ['hides'], produces: ['leather'] }),
  t('cordwainer', 'a shoemaker working new leather', { consumes: ['leather'], produces: ['shoes'] }),
  t('shepherd', 'a shepherd keeping sheep', { produces: ['wool'] }),
  t('weaver', 'a weaver making cloth', { consumes: ['wool', 'yarn'], produces: ['cloth'] }),
  t('fuller', 'a fuller finishing cloth', { consumes: ['cloth'], produces: ['fulled-cloth'] }),
  t('dyer', 'a dyer colouring cloth', { consumes: ['fulled-cloth'], produces: ['dyed-cloth'] }),
  t('draper', 'a draper selling cloth', { consumes: ['dyed-cloth'], produces: ['goods'] }),
  t('tailor', 'a tailor making garments', { consumes: ['cloth'], produces: ['garments'] }),
  t('smith', 'a blacksmith — the universal supplier', { produces: ['tools', 'nails', 'fittings', 'arms'], building: 'smithy' }),
  t('merchant', 'a merchant trading goods', { consumes: ['goods'], produces: ['coin'] }),
  t('brewer', 'a brewer making ale', { consumes: ['grain'], produces: ['ale'], building: 'brewhouse' }),
];
