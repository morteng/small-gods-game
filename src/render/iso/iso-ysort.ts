export type IsoEntityKind = 'npc' | 'tree' | 'deco' | 'building' | 'road' | 'river';

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
