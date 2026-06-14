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
  Connectome,
  ConnectomeScale,
  ExpandCtx,
  TerrainProbe,
  WallFace,
} from './types';
export { expand, registerInterpreter } from './grammar';
export { deriveSmokeEgress } from './smoke';
