import type { AssetKind, AssetSummary } from '@/core/types';
import {
  matchesAsset, scoreAsset, type AssetMeta, type AssetRequest as MatchRequest,
} from './asset-match';
import { type BaseLibraryRecord, baseBlobUrl } from './base-library-loader';
import { listKeptSummaries as defaultListKept, getAssetBlob } from './pixellab';

export interface AssetRequest extends MatchRequest {
  /** Deterministic tie-break among equally-scored candidates. */
  seed?: number;
}

export interface ResolvedAsset {
  id: string;
  sourceTier: 'base' | 'live';
  width: number;
  height: number;
  score: number;
}

/** Injection seam so tests can supply a fake live source. */
export interface AssetLibraryDeps {
  listKeptSummaries: (kind: AssetKind) => Promise<AssetSummary[]>;
}

function baseToMeta(r: BaseLibraryRecord): AssetMeta {
  return {
    kind: r.kind, style: r.style, model: r.model, provider: r.provider,
    tags: r.tags, affinity: r.affinity, width: r.width, height: r.height,
  };
}

function summaryToMeta(s: AssetSummary): AssetMeta {
  return {
    kind: s.kind, style: s.style, model: s.model, provider: s.provider,
    tags: s.tags, affinity: s.affinity, width: s.width, height: s.height,
  };
}

/** Tiny deterministic string hash (FNV-1a) → non-negative int. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export class AssetLibrary {
  private readonly baseByKey = new Map<string, BaseLibraryRecord>();
  private readonly listKept: AssetLibraryDeps['listKeptSummaries'];

  constructor(base: BaseLibraryRecord[], deps?: Partial<AssetLibraryDeps>) {
    for (const r of base) this.baseByKey.set(r.key, r);
    this.listKept = deps?.listKeptSummaries ?? defaultListKept;
  }

  /** All matching assets, scored desc, base-first on ties; base wins duplicate keys. */
  async query(req: AssetRequest): Promise<ResolvedAsset[]> {
    const out: ResolvedAsset[] = [];

    for (const r of this.baseByKey.values()) {
      const meta = baseToMeta(r);
      if (matchesAsset(meta, req)) {
        out.push({ id: r.key, sourceTier: 'base', width: r.width, height: r.height, score: scoreAsset(meta, req) });
      }
    }

    // The live (IndexedDB) source can fail in storage-degraded browsers
    // (private mode, quota). Degrade to base-only rather than rejecting — a
    // throw here would leave ArtResolver unable to memoize and re-fire every
    // frame. Mirrors loadBaseLibrary's []-on-error contract.
    let live: AssetSummary[] = [];
    try { live = await this.listKept(req.kind); } catch { /* IndexedDB unavailable */ }
    for (const s of live) {
      if (this.baseByKey.has(s.id)) continue; // base wins duplicate key
      const meta = summaryToMeta(s);
      if (matchesAsset(meta, req)) {
        out.push({ id: s.id, sourceTier: 'live', width: s.width, height: s.height, score: scoreAsset(meta, req) });
      }
    }

    out.sort((a, b) =>
      b.score - a.score ||
      (a.sourceTier === b.sourceTier ? 0 : a.sourceTier === 'base' ? -1 : 1) ||
      (a.id < b.id ? -1 : 1));
    return out;
  }

  /** Deterministic single pick: top score, ties broken by seed hash. */
  async pick(req: AssetRequest): Promise<ResolvedAsset | null> {
    const all = await this.query(req);
    if (all.length === 0) return null;
    const top = all.filter(a => a.score === all[0].score);
    if (top.length === 1) return top[0];
    const idx = hashStr(`${req.seed ?? 0}`) % top.length;
    return top[idx];
  }

  /** Resolve any asset id to a Blob: base → fetch file, else → IndexedDB. */
  async resolveBlob(id: string): Promise<Blob | null> {
    const baseRec = this.baseByKey.get(id);
    if (baseRec) {
      try {
        const res = await fetch(baseBlobUrl(baseRec));
        return res.ok ? await res.blob() : null;
      } catch { return null; }
    }
    return getAssetBlob(id);
  }
}
