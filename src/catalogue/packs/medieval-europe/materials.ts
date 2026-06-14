/**
 * medieval-europe pack — materials. Each material sits on a blueprint role
 * ('walls'|'roof'|'ground') at a wealth `rank` (poorest = 0). The three role
 * ladders are DERIVED from these ranks (see `buildRoleLadders`), making this the
 * single source of truth for what `descriptors.ts` used to hard-code in `LADDERS`.
 *
 * Off-ladder materials (hide, log, cob, earth, grass) carry a role but no rank —
 * they are period/region specialties the wealth shift leaves untouched, exactly as
 * the old descriptor code did (`indexOf < 0 ⇒ leave as-is`).
 */
import type { FactEntry, MaterialFields } from '@/catalogue/types';

const m = (
  id: string,
  role: string,
  rank: number | undefined,
  rgb: string,
  l0: string,
  l1: string[],
  extra: Partial<FactEntry<MaterialFields>> = {},
): FactEntry<MaterialFields> => ({
  id,
  kind: 'material',
  pack: 'medieval-europe',
  lod: { l0, l1 },
  fields: { role, rank, rgb },
  visibility: 'texture-prompt',
  ...extra,
});

export const MEDIEVAL_MATERIALS: FactEntry<MaterialFields>[] = [
  // ── walls ladder (poorest → richest): mud · wattle · timber · brick · stone ──
  m('mud', 'walls', 0, '#7c6a55', 'packed mud or cob walling', ['earthen', 'rounded corners', 'lime-washed']),
  m('wattle', 'walls', 1, '#9b8460', 'wattle-and-daub infill', ['woven staves', 'daub render', 'cracked patches']),
  m('timber', 'walls', 2, '#8a6d4b', 'timber framing with infill', ['exposed studs', 'panelled infill', 'jettied upper']),
  m('brick', 'walls', 3, '#9c5b46', 'fired-brick walling', ['coursed brick', 'mortar joints', 'diaper patterning']),
  m('stone', 'walls', 4, '#8d8c87', 'dressed-stone walling', ['ashlar blocks', 'quoined corners', 'cool grey']),
  // off-ladder wall specialties
  m('cob', 'walls', undefined, '#8a7355', 'cob (earth + straw) walling', ['thick monolithic', 'thatched cap', 'rounded']),
  m('log', 'walls', undefined, '#7a5c3e', 'horizontal log walling', ['stacked rounds', 'notched corners', 'chinked gaps']),
  m('hide', 'walls', undefined, '#b8a07a', 'hide-and-frame covering', ['stretched skins', 'lattice frame', 'felt layers']),

  // ── roof ladder: thatch · wood · shingle · tile · slate ──
  m('thatch', 'roof', 0, '#b99748', 'thatched roofing', ['steep reed pitch', 'combed ridge', 'deep eaves']),
  m('wood', 'roof', 1, '#7d6a48', 'rough board roofing', ['plank sheathing', 'mossy seams', 'low pitch']),
  m('shingle', 'roof', 2, '#8a6a45', 'wooden shingle roofing', ['split oak shingles', 'overlapping courses', 'silvered']),
  m('tile', 'roof', 3, '#a85d44', 'clay-tile roofing', ['red peg tiles', 'regular courses', 'ridge tiles']),
  m('slate', 'roof', 4, '#5b5f63', 'stone-slate roofing', ['grey laminae', 'diminishing courses', 'heavy low pitch']),

  // ── ground ladder: dirt · packed_dirt · gravel · cobble · flagstone ──
  m('dirt', 'ground', 0, '#6f5b41', 'bare earth floor', ['trodden soil', 'uneven', 'dusty']),
  m('packed_dirt', 'ground', 1, '#7a6850', 'packed-earth floor', ['rammed surface', 'swept hard', 'ochre']),
  m('gravel', 'ground', 2, '#8f887b', 'gravel surface', ['loose stones', 'drained', 'pale']),
  m('cobble', 'ground', 3, '#79756e', 'cobbled paving', ['rounded setts', 'mortared joints', 'worn smooth']),
  m('flagstone', 'ground', 4, '#86837c', 'flagstone paving', ['large flat slabs', 'tight joints', 'polished']),
  // off-ladder ground
  m('earth', 'ground', undefined, '#6f5b41', 'natural earth', ['soil', 'grassed edges']),
  m('grass', 'ground', undefined, '#6f8a4a', 'turf / grass', ['green sward', 'worn paths']),
];

/**
 * Derive the three role ladders (poorest → richest) from the ranked materials.
 * Reproduces `descriptors.ts`' `LADDERS` exactly; off-ladder (rankless) materials
 * are excluded, matching the old behaviour.
 */
export function buildRoleLadders(materials: FactEntry<MaterialFields>[]): Record<string, string[]> {
  const byRole: Record<string, { id: string; rank: number }[]> = {};
  for (const e of materials) {
    const { role, rank } = e.fields;
    if (!role || rank == null) continue;
    (byRole[role] ??= []).push({ id: e.id, rank });
  }
  const out: Record<string, string[]> = {};
  for (const [role, list] of Object.entries(byRole)) {
    out[role] = list.sort((a, b) => a.rank - b.rank).map((x) => x.id);
  }
  return out;
}
