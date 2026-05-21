export type IsoEntityKind = 'npc' | 'vegetation' | 'deco' | 'building' | 'road' | 'river';

export interface YSortEntry {
  id: string;
  kind: IsoEntityKind;
  tx: number;
  ty: number;
  z: number;
  kindPriority: number;
  sortTx?: number;
  sortTy?: number;
}

export interface BuildingFootprint {
  tx: number;
  ty: number;
  footprintW: number;
  footprintH: number;
}

export function buildingSortKey(b: BuildingFootprint): { sortTx: number; sortTy: number } {
  return {
    sortTx: b.tx + b.footprintW - 1,
    sortTy: b.ty + b.footprintH - 1,
  };
}

export function buildYSortBucket(entries: YSortEntry[]): YSortEntry[] {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    const aKey = (a.sortTx ?? a.tx) + (a.sortTy ?? a.ty);
    const bKey = (b.sortTx ?? b.tx) + (b.sortTy ?? b.ty);
    if (aKey !== bKey) return aKey - bKey;
    if (a.z !== b.z) return a.z - b.z;
    return a.kindPriority - b.kindPriority;
  });
  return sorted;
}
