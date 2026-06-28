/**
 * medieval-europe pack — SITE TYPES (establishment recipes). Each names a CORE
 * buildingType plus the yard / auxiliaries / fixtures / "wall (or not)" that make it
 * a premises rather than a lone footprint. The `topology` routes to a site
 * interpreter (blueprint/connectome/site.ts):
 *
 *   yard         — core fronts an enclosed court with outbuildings + fixtures.
 *   freestanding — core with ground fixtures, no enclosure.
 *
 * Authoring is OPTIONAL: a bare buildingType with `functions`/`requires` tags expands
 * through the `derive` default (no recipe) into a plausible open-yard site. These
 * recipes are the OVERRIDE — the walled, fully-appointed version of an establishment.
 */
import type { FactEntry, SiteTypeFields } from '@/catalogue/types';

type S = FactEntry<SiteTypeFields>;

const s = (id: string, fields: SiteTypeFields, l0: string, l1: string[], extra: Partial<S> = {}): S => ({
  id,
  kind: 'siteType',
  pack: 'medieval-europe',
  lod: { l0, l1 },
  fields,
  visibility: 'data-only',
  ...extra,
});

export const MEDIEVAL_SITE_TYPES: S[] = [
  // The appointed tavern: a fenced yard the taproom fronts, with a stable, a sign,
  // benches and a well. (A poor tavern is the `derive` default — open yard, no wall.)
  s(
    'tavern-yard',
    {
      topology: 'yard',
      core: 'tavern',
      buildings: [{ type: 'stable', role: 'auxiliary', satisfies: ['stabling'] }],
      fixtures: ['hanging-sign', 'tavern-bench', 'well'],
      yard: { barrier: 'paling-fence' },
    },
    'a tavern with a walled drinking yard',
    ['fenced court', 'stable range', 'hung ale-sign', 'yard benches', 'well'],
    { provenance: ['https://en.wikipedia.org/wiki/Inn'] },
  ),

  // The wayside shrine: a freestanding cell on the verge, no enclosure.
  s(
    'wayside-shrine',
    { topology: 'freestanding', core: 'shrine', fixtures: ['cresset'] },
    'a shrine standing free on the wayside',
    ['gabled stone cell', 'open verge', 'a votive light'],
    { applicability: { eras: ['classical', 'medieval'] } },
  ),
];
