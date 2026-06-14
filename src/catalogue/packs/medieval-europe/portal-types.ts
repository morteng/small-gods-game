/**
 * Medieval-Europe content pack — PORTAL TYPE catalogue.
 *
 * Pure data: doors, windows, gates, and openings that pierce a building or wall
 * shell. No logic lives here. Each entry follows `FactEntry<PortalTypeFields>`:
 * an LOD description ladder plus structured fields (size class, passability,
 * metric size hints). `widthHint`/`heightHint` are in metres.
 *
 * Convention: `passable` = people or goods can move through (doors, gates,
 * hatches sized for use); windows, slits, smoke vents, and ornamental rounds are
 * not passable. Most portals are `visibility: 'geometry'` because they shape the
 * exterior silhouette; ornamental glazed ones are `'texture-prompt'`.
 */
import type { FactEntry, PortalTypeFields } from '@/catalogue/types';

export const MEDIEVAL_PORTAL_TYPES: FactEntry<PortalTypeFields>[] = [
  // ── Everyday doors ────────────────────────────────────────────────────────
  {
    id: 'doorway',
    kind: 'portalType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A plain human-sized doorway, the common entrance of a dwelling.',
      l1: ['single plank-and-batten leaf', 'low square or shallow-arched head', 'iron strap hinges', 'timber threshold'],
      l2: 'The default building entrance: a single ledged-and-braced board door on strap hinges, narrow and low enough to conserve heat and timber. Sized for one person to pass.',
    },
    fields: { sizeClass: 'human', passable: true, widthHint: 0.9, heightHint: 2.0 },
    visibility: 'geometry',
    tags: ['door', 'entrance'],
  },
  {
    id: 'two-leaf-door',
    kind: 'portalType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A wide double-leaf door, two leaves meeting at the centre.',
      l1: ['two matched leaves', 'central meeting stile', 'paired hinges per side', 'often studded'],
      l2: 'Two leaves hung from opposite jambs and closing on a central rebate, giving a wider opening for halls, churches, and wealthier houses while each leaf stays light enough to swing.',
    },
    fields: { sizeClass: 'human', passable: true, widthHint: 1.6, heightHint: 2.2 },
    visibility: 'geometry',
    tags: ['door', 'entrance', 'double'],
  },
  {
    id: 'postern',
    kind: 'portalType',
    pack: 'medieval-europe',
    applicability: { wealth: ['comfortable', 'wealthy', 'elite'] },
    lod: {
      l0: 'A small concealed secondary door in a wall or fortification.',
      l1: ['narrow low opening', 'tucked in a recess or angle', 'heavy single leaf', 'often barred within'],
      l2: 'A discreet back or side door through a curtain wall or castle, placed where it is hard to see and easy to defend; in a siege it doubled as a sally port for sorties.',
    },
    fields: { sizeClass: 'human', passable: true, widthHint: 0.8, heightHint: 1.8 },
    provenance: ['https://en.wikipedia.org/wiki/Postern'],
    visibility: 'geometry',
    tags: ['door', 'fortification', 'concealed'],
  },
  {
    id: 'undercroft-door',
    kind: 'portalType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A low door into a vaulted cellar or undercroft, often below street level.',
      l1: ['set down a few steps', 'stone-arched head', 'stout barred leaf', 'half-buried in the plinth'],
      l2: 'The entrance to a storage undercroft, dropped below grade so the door head sits near the ground line; arched in stone and heavily barred to protect goods.',
    },
    fields: { sizeClass: 'human', passable: true, widthHint: 1.0, heightHint: 1.8 },
    visibility: 'geometry',
    tags: ['door', 'cellar', 'storage'],
  },
  {
    id: 'byre-door',
    kind: 'portalType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A stable or cow-house door, often split top and bottom.',
      l1: ['stable/Dutch split leaf', 'wide enough for an ox', 'rough boarding', 'mud-worn threshold'],
      l2: 'The animal end of a longhouse or byre: a broad, often horizontally split door so the upper half can stand open for air and light while the lower keeps stock penned.',
    },
    fields: { sizeClass: 'human', passable: true, widthHint: 1.3, heightHint: 2.0 },
    visibility: 'geometry',
    tags: ['door', 'animal', 'farm'],
  },

  // ── Cart / vehicle openings ───────────────────────────────────────────────
  {
    id: 'cart-door',
    kind: 'portalType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A great barn or workshop door wide enough to drive a loaded cart through.',
      l1: ['very wide double leaves', 'full-height boarding', 'diagonal bracing', 'big drop-bar across'],
      l2: 'The threshing-barn or wagon-house opening: tall, broad double leaves spanning a full bay so a harvest cart or wain can be driven straight in to unload.',
    },
    fields: { sizeClass: 'cart', passable: true, widthHint: 3.0, heightHint: 3.2 },
    visibility: 'geometry',
    tags: ['door', 'cart', 'barn', 'large'],
  },
  {
    id: 'hayloft-door',
    kind: 'portalType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A high loft door in a gable for hoisting fodder or goods.',
      l1: ['set high under the gable apex', 'no threshold below', 'often a projecting hoist beam', 'single or double leaf'],
      l2: 'An opening near the top of a barn or warehouse gable through which hay, grain, or wares were winched up to the loft on a gibbet beam; there is no floor beneath it outside.',
    },
    fields: { sizeClass: 'human', passable: true, widthHint: 1.2, heightHint: 1.8 },
    visibility: 'geometry',
    tags: ['door', 'loft', 'hoist', 'gable'],
  },
  {
    id: 'hatch',
    kind: 'portalType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A small shop or service hatch in a wall, opening for trade.',
      l1: ['small square opening', 'hinged shutter or board', 'shop counter sill below', 'street-facing'],
      l2: 'A counter hatch in a craftsman or shopkeeper wall, the shutter dropping to form a stall board for selling to the street; sized for handing goods, not passing through.',
    },
    fields: { sizeClass: 'human', passable: true, widthHint: 1.0, heightHint: 1.2 },
    visibility: 'geometry',
    tags: ['hatch', 'shop', 'service'],
  },

  // ── Windows ───────────────────────────────────────────────────────────────
  {
    id: 'window-shuttered',
    kind: 'portalType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A plain unglazed window closed by wooden shutters.',
      l1: ['small rectangular opening', 'interior or exterior board shutters', 'no glass', 'sometimes a fixed mullion bar'],
      l2: 'The common house window before glass was affordable: an unglazed opening with hinged board shutters for weather and security, kept small to hold heat.',
    },
    fields: { sizeClass: 'human', passable: false, widthHint: 0.7, heightHint: 0.9 },
    visibility: 'geometry',
    tags: ['window', 'shutter', 'unglazed'],
  },
  {
    id: 'mullioned-window',
    kind: 'portalType',
    pack: 'medieval-europe',
    applicability: { eras: ['medieval'], wealth: ['comfortable', 'wealthy', 'elite'] },
    lod: {
      l0: 'A larger window divided into lights by stone or timber mullions.',
      l1: ['two or more glazed lights', 'vertical mullion bars', 'often a transom', 'dressed stone surround'],
      l2: 'A status window of wealthier houses and halls: vertical mullions (and sometimes a transom) split a wide opening into lights, allowing real glazing while keeping each pane small and supported.',
    },
    fields: { sizeClass: 'human', passable: false, widthHint: 1.2, heightHint: 1.4 },
    provenance: ['https://en.wikipedia.org/wiki/Mullion'],
    visibility: 'texture-prompt',
    tags: ['window', 'mullion', 'glazed', 'elite'],
  },
  {
    id: 'lancet',
    kind: 'portalType',
    pack: 'medieval-europe',
    applicability: { eras: ['medieval'], wealth: ['wealthy', 'elite'] },
    lod: {
      l0: 'A tall narrow window with a sharply pointed arch.',
      l1: ['steep pointed-arch head', 'tall and slender', 'often grouped in odd numbers', 'no tracery'],
      l2: 'The austere single-light Gothic window of the early Lancet period, lance-shaped and narrow; grouped windows step up to the tallest at the centre. A church and chapel feature.',
    },
    fields: { sizeClass: 'slit', passable: false, widthHint: 0.4, heightHint: 2.5 },
    provenance: ['https://en.wikipedia.org/wiki/Lancet_window'],
    visibility: 'geometry',
    tags: ['window', 'gothic', 'church', 'pointed-arch'],
  },
  {
    id: 'oculus',
    kind: 'portalType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A small round window without tracery, an "eye" in the wall or gable.',
      l1: ['plain circular opening', 'stone or timber rim', 'centred in a gable or above a door', 'sometimes glazed'],
      l2: 'A simple circular light (Latin "eye"), set high in a gable or over a portal; the untraceried cousin of the rose window, common in Italian and vernacular churches.',
    },
    fields: { sizeClass: 'human', passable: false, widthHint: 0.8, heightHint: 0.8 },
    provenance: ['https://en.wikipedia.org/wiki/Oculus'],
    visibility: 'geometry',
    tags: ['window', 'round', 'gable'],
  },
  {
    id: 'rose-window',
    kind: 'portalType',
    pack: 'medieval-europe',
    applicability: { eras: ['medieval'], wealth: ['elite'] },
    lod: {
      l0: 'A great circular window of radiating stone tracery and stained glass.',
      l1: ['large circle', 'radiating mullions and tracery', 'stained-glass petals', 'on a church facade or transept'],
      l2: 'The signature Gothic cathedral window: a large wheel of stone tracery filled with stained glass in petal-like segments, set over the main portal or in a transept gable. The grandest, costliest opening.',
    },
    fields: { sizeClass: 'grand', passable: false, widthHint: 8.0, heightHint: 8.0 },
    provenance: ['https://en.wikipedia.org/wiki/Rose_window'],
    visibility: 'texture-prompt',
    tags: ['window', 'rose', 'gothic', 'cathedral', 'stained-glass', 'elite'],
  },
  {
    id: 'dormer',
    kind: 'portalType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A roof window in its own little gabled projection.',
      l1: ['projects from the roof slope', 'own miniature pitched roof', 'small glazed or shuttered light', 'lights an attic'],
      l2: 'A window set vertically in a small projecting structure that rises through the roof slope, bringing light and headroom to a loft or attic room.',
    },
    fields: { sizeClass: 'human', passable: false, widthHint: 0.7, heightHint: 0.9 },
    visibility: 'geometry',
    tags: ['window', 'roof', 'attic', 'dormer'],
  },

  // ── Fortification openings ────────────────────────────────────────────────
  {
    id: 'arrow-slit',
    kind: 'portalType',
    pack: 'medieval-europe',
    applicability: { wealth: ['wealthy', 'elite'] },
    lod: {
      l0: 'A narrow vertical loophole for shooting from cover.',
      l1: ['tall thin slot', 'often cruciform', 'splayed wide inside', 'set in thick wall'],
      l2: 'A slender aperture in a fortification wall through which an archer or crossbowman shoots; the inner wall is splayed for a wide field of fire while the outer slit gives attackers almost nothing to hit.',
    },
    fields: { sizeClass: 'slit', passable: false, widthHint: 0.1, heightHint: 1.0 },
    provenance: ['https://en.wikipedia.org/wiki/Arrowslit'],
    visibility: 'geometry',
    tags: ['slit', 'fortification', 'defensive', 'loophole'],
  },
  {
    id: 'gate',
    kind: 'portalType',
    pack: 'medieval-europe',
    applicability: { wealth: ['comfortable', 'wealthy', 'elite'] },
    lod: {
      l0: 'A great fortified gateway through a wall, wide enough for traffic.',
      l1: ['tall arched passage', 'massive double leaves', 'iron studding and bands', 'flanking jambs or towers'],
      l2: 'The main entrance through a town or castle wall: a tall arched passage closed by huge ironbound double leaves, often set between towers and backed by a portcullis. The principal point of control.',
    },
    fields: { sizeClass: 'grand', passable: true, widthHint: 3.5, heightHint: 4.5 },
    visibility: 'geometry',
    tags: ['gate', 'fortification', 'entrance', 'large'],
  },
  {
    id: 'wicket-gate',
    kind: 'portalType',
    pack: 'medieval-europe',
    lod: {
      l0: 'A small person-sized door set within a larger gate leaf.',
      l1: ['little door cut into the big leaf', 'low and narrow', 'one person at a time', 'opens without the main gate'],
      l2: 'A pedestrian door framed inside one leaf of a great gate, so people can pass singly without unbarring and swinging the whole heavy gate.',
    },
    fields: { sizeClass: 'human', passable: true, widthHint: 0.8, heightHint: 1.7 },
    visibility: 'geometry',
    tags: ['gate', 'wicket', 'pedestrian'],
  },
  {
    id: 'portcullis',
    kind: 'portalType',
    pack: 'medieval-europe',
    applicability: { wealth: ['wealthy', 'elite'] },
    lod: {
      l0: 'A heavy latticed grille that drops vertically to seal a gateway.',
      l1: ['wood-and-iron lattice', 'vertical grooves in the jambs', 'pointed spiked feet', 'raised on chains from above'],
      l2: 'A vertically sliding portcullis (Old French "sliding gate"): a spiked latticed grille of timber and iron that runs in grooves cut into the gate jambs and drops to block the passage, often paired with the swinging gate leaves behind it.',
    },
    fields: { sizeClass: 'cart', passable: true, widthHint: 3.0, heightHint: 4.0 },
    provenance: ['https://en.wikipedia.org/wiki/Portcullis'],
    visibility: 'geometry',
    tags: ['gate', 'portcullis', 'fortification', 'defensive'],
  },

  // ── Smoke / venting openings ──────────────────────────────────────────────
  {
    id: 'smoke-hole',
    kind: 'portalType',
    pack: 'medieval-europe',
    applicability: { eras: ['ancient', 'classical', 'medieval'] },
    lod: {
      l0: 'A simple hole in the roof or gable letting hearth smoke escape.',
      l1: ['plain gap at the ridge or apex', 'no cover or a removable board', 'sooted edges', 'over the central hearth'],
      l2: 'The earliest smoke egress for an open central hearth: an unglazed gap in the roof or upper gable through which smoke seeps out. Soot-stained and weather-prone — the ancestor of the louver and chimney.',
    },
    fields: { sizeClass: 'slit', passable: false, widthHint: 0.4, heightHint: 0.4 },
    visibility: 'geometry',
    tags: ['vent', 'smoke', 'roof', 'hearth'],
  },
  {
    id: 'louver',
    kind: 'portalType',
    pack: 'medieval-europe',
    applicability: { eras: ['classical', 'medieval'] },
    lod: {
      l0: 'A slatted roof turret that vents hearth smoke while keeping rain out.',
      l1: ['raised ridge turret', 'angled timber slats', 'little capping roof', 'over the hall hearth'],
      l2: 'A timber lantern or turret on the ridge above a hall hearth, its sloping slats (louvers) letting smoke rise out while shedding rain — the refined successor to the bare smoke-hole, before chimneys took over.',
    },
    fields: { sizeClass: 'slit', passable: false, widthHint: 0.6, heightHint: 0.8 },
    visibility: 'geometry',
    tags: ['vent', 'smoke', 'roof', 'ridge', 'louver'],
  },
];
