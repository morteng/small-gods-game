import type { AssetKind, AssetStyle, AssetProvider, AssetAffinity } from '@/core/types';

/** The common metadata shape both base records and live summaries expose. */
export interface AssetMeta {
  kind: AssetKind;
  style: AssetStyle;
  model: string;
  provider: AssetProvider;
  tags: string[];
  affinity?: AssetAffinity;
  width: number;
  height: number;
}

export interface AssetRequest {
  kind: AssetKind;
  style: AssetStyle;
  model?: string;
  provider?: AssetProvider;
  tagsAny?: string[];
  biomeAny?: string[];
  eraAny?: string[];
  size?: { w: number; h: number };
}

/** Hard filters — all must pass for an asset to be a candidate. */
export function matchesAsset(a: AssetMeta, req: AssetRequest): boolean {
  if (a.kind !== req.kind) return false;
  if (a.style !== req.style) return false;
  if (req.model && a.model !== req.model) return false;
  if (req.provider && a.provider !== req.provider) return false;
  if (req.size && (a.width !== req.size.w || a.height !== req.size.h)) return false;
  return true;
}

function overlap(have: string[] | undefined, want: string[] | undefined): number {
  if (!have || !want) return 0;
  const set = new Set(have);
  let n = 0;
  for (const w of want) if (set.has(w)) n++;
  return n;
}

/** Soft score — higher is a better fit. Assumes matchesAsset already passed. */
export function scoreAsset(a: AssetMeta, req: AssetRequest): number {
  let s = 0;
  s += overlap(a.tags, req.tagsAny) * 3;
  s += overlap(a.affinity?.biome, req.biomeAny) * 2;
  s += overlap(a.affinity?.era, req.eraAny) * 2;
  return s;
}
