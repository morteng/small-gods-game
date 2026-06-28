/**
 * Building connectome — public API barrel. The grammar expands a catalogue
 * buildingType into a Zone/Portal/Fixture graph; `deriveSmokeEgress` runs the
 * hearth→vent rule; `connectomeToBlueprint` (Slice 1 Phase E) resolves it down into
 * the existing geometric Blueprint. All content-free — see the engine-purity guard.
 */
export type {
  Zone,
  Portal,
  Fixture,
  Barrier,
  Connectome,
  ConnectomeScale,
  ExpandCtx,
  TerrainProbe,
  WallFace,
} from './types';
export { expand, registerInterpreter } from './grammar';
export { deriveSmokeEgress } from './smoke';
export {
  expandComplex,
  encloseExisting,
  complexToPlan,
  siteComplex,
  specFromComplexType,
  registerComplexInterpreter,
} from './complex';
export type { ComplexPlan, PlacedComplex } from './complex';
export { expandSite, siteToPlan, registerSiteInterpreter } from './site';
export type { SitePlan } from './site';
export { selectFrame, annotateStructure, connectomeStructure } from './structure';
export type { ConnectomeStructure } from './structure';
export { connectomeForm, GEN_FORM_TAG } from './form';
export {
  siteSelect,
  scoreSite,
  deriveEarthworks,
  frustumVolume,
  ringVolume,
  DEFENSIVE_SITE_WEIGHTS,
  OPULENT_SITE_WEIGHTS,
  SHRINE_SITE_WEIGHTS,
} from './earthworks';
export type {
  Earthwork,
  EarthworkKind,
  EarthworkSpec,
  EarthworksResult,
  SiteCandidate,
  SiteIntent,
  SiteWeights,
  SiteScore,
  Affordance,
} from './earthworks';
