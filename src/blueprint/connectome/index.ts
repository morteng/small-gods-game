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
export { expandComplex, encloseExisting, complexToPlan, registerComplexInterpreter } from './complex';
export type { ComplexPlan } from './complex';
export {
  siteSelect,
  scoreSite,
  deriveEarthworks,
  frustumVolume,
  ringVolume,
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
