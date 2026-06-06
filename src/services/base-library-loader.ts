import type { AssetKind, AssetStyle, AssetProvider, AssetAffinity } from '@/core/types';
import { assetUrl } from '@/core/asset-url';

const MANIFEST_PATH = 'asset-library/manifest.ndjson';

/** One base-library entry. Mirrors LibraryAsset minus the Blob (a file instead). */
export interface BaseLibraryRecord {
  key: string;
  kind: AssetKind;
  style: AssetStyle;
  provider: AssetProvider;
  model: string;
  recipeVersion: string;
  prompt: string;
  width: number;
  height: number;
  tags: string[];
  affinity?: AssetAffinity;
  /** Path relative to public/asset-library/, e.g. "blobs/decoration-a1.png". */
  blob: string;
  generatedAt: number;
  description?: string;
}

const REQUIRED: (keyof BaseLibraryRecord)[] = [
  'key', 'kind', 'style', 'provider', 'model', 'recipeVersion',
  'prompt', 'width', 'height', 'tags', 'blob', 'generatedAt',
];

function isValid(o: unknown): o is BaseLibraryRecord {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  return REQUIRED.every(k => r[k] !== undefined && r[k] !== null);
}

/** Parse NDJSON text into records. Blank/malformed/incomplete lines are skipped
 *  (a dev warning is logged) so one bad line never breaks the whole library. */
export function parseManifest(text: string): BaseLibraryRecord[] {
  const out: BaseLibraryRecord[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (isValid(obj)) out.push(obj);
      else console.warn('[base-library] skipping incomplete manifest line:', line.slice(0, 80));
    } catch {
      console.warn('[base-library] skipping malformed manifest line:', line.slice(0, 80));
    }
  }
  return out;
}

/** Absolute URL for a record's blob file, subpath-safe (GitHub Pages). */
export function baseBlobUrl(rec: BaseLibraryRecord): string {
  return assetUrl(`asset-library/${rec.blob}`);
}

/** Fetch + parse the manifest at boot. Returns [] if absent/unreadable. */
export async function loadBaseLibrary(
  fetchImpl: typeof fetch = fetch,
): Promise<BaseLibraryRecord[]> {
  try {
    const res = await fetchImpl(assetUrl(MANIFEST_PATH));
    if (!res.ok) return [];
    return parseManifest(await res.text());
  } catch {
    return [];
  }
}
