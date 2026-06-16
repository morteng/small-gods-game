// src/blueprint/register-buildings.ts
// Registers every v1 building part + feature. Import this once at app/test bootstrap.
import { registerPartType, registerFeatureType, listPartTypes } from './registry';
import { bodyPartType } from './parts/body';
import { wingPartType } from './parts/wing';
import { towerPartType, porchPartType, chimneyPartType } from './parts/structural';
import { primPartType } from './parts/prim';
import { wellPartType, graveyardPartType } from './parts/civic';
import { stallPartType, tentPartType } from './parts/lightweight';
import { treePartType } from './parts/flora';
import { branchPlantPartType, rockPartType } from './parts/flora-branch';
import { doorFeatureType } from './features/door';
import { ventFeatureType } from './features/vent';
import { windowFeatureType } from './features/window';
import { dormerFeatureType } from './features/dormer';

export function ensureBuildingTypesRegistered(): void {
  if (listPartTypes().some(pt => pt.type === 'body')) return;   // already registered
  for (const pt of [bodyPartType, wingPartType, towerPartType, porchPartType, chimneyPartType, primPartType, wellPartType, graveyardPartType, stallPartType, tentPartType, treePartType, branchPlantPartType, rockPartType]) registerPartType(pt);
  for (const ft of [doorFeatureType, ventFeatureType, windowFeatureType, dormerFeatureType]) registerFeatureType(ft);
}
