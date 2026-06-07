// src/assetgen/geometry/building.ts
export type RoofKind = 'gable' | 'hip' | 'pyramidal' | 'flat';
export type RoofStyle = 'gable' | 'hip';
export interface Wing { x: number; y: number; w: number; h: number; storeys?: number; roof?: RoofKind }

export const STOREY = 2.1;                           // cube-units of height per storey

export function occupancy(wings: Wing[]): Set<string> {
  const s = new Set<string>();
  for (const w of wings) for (let i = w.x; i < w.x+w.w; i++) for (let j = w.y; j < w.y+w.h; j++) s.add(i+','+j);
  return s;
}
