// src/blueprint/register-buildings.ts
// Registers every v1 building part + feature. Import this once at app/test bootstrap.
import { registerPartType, registerFeatureType } from './registry';
import { bodyPartType } from './parts/body';
import { wingPartType } from './parts/wing';
import { towerPartType, porchPartType, chimneyPartType } from './parts/structural';
import { primPartType } from './parts/prim';
import { doorFeatureType } from './features/door';
import { ventFeatureType } from './features/vent';
import { windowFeatureType } from './features/window';

let done = false;
export function ensureBuildingTypesRegistered(): void {
  if (done) return;
  done = true;
  for (const pt of [bodyPartType, wingPartType, towerPartType, porchPartType, chimneyPartType, primPartType]) registerPartType(pt);
  for (const ft of [doorFeatureType, ventFeatureType, windowFeatureType]) registerFeatureType(ft);
}
