// src/studio/reflib.ts
// Studio-side loader for the TTI reference-library (served by the dev-only reflib-sink plugin at
// /__reflib). Lets the Object studio show each subject's text-to-image REFERENCE image inline in
// its pipeline strip — a manual eval tool: compare our composed sprite against the reference the
// preset was authored toward. Dev-only (the studio itself is tree-shaken from prod).
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';

/** Load an image URL into a canvas (SpriteCanvas). Resolves null on any failure (missing file,
 *  decode error) so a subject with no reference simply shows no reference stage. */
function loadImageToCanvas(url: string): Promise<SpriteCanvas | null> {
  return new Promise((resolvePromise) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      const cx = c.getContext('2d');
      if (!cx || !c.width || !c.height) { resolvePromise(null); return; }
      cx.drawImage(img, 0, 0);
      resolvePromise(c);
    };
    img.onerror = () => resolvePromise(null);
    img.src = url;
  });
}

export interface RefLibResult {
  /** The reference-library slug chosen for this subject kind. */
  slug: string;
  /** The reference image, once loaded; null while loading (poll again next frame). */
  canvas: SpriteCanvas | null;
}

export interface RefLib {
  /** The primary reference for a subject `kind` (exact slug wins), or null if the library has no
   *  match. Lazily fetches the slug index (once) and the matched image (once); returns null until
   *  the index is in. Safe to call every frame — all work is memoised. */
  referenceFor(kind: string): RefLibResult | null;
  /** EVERY reference for a subject — the exact slug plus every `kind-*` variant — each with its
   *  image (lazy). An object legitimately has several references (different models / prompt takes). */
  referencesFor(kind: string): RefLibResult[];
  /** The matching slugs for a kind (null until the index has loaded). */
  slugsFor(kind: string): string[] | null;
  /** Drop a slug's cached image (and add it to the index) so the next call reloads it — used after
   *  a regen writes a new model-tti.png. */
  invalidate(slug: string): void;
  /** The reflib endpoint base (for the panel's prompt/manifest/regen fetches). */
  readonly base: string;
}

/** Map a subject kind to a reference slug: exact match wins; else the shortest slug that starts
 *  with `kind-` (so `watermill` → `watermill-wheel`, never a sibling like `tavern` → `tavern-target`,
 *  which only applies when there is no exact `tavern`). Pure — the loader's routing logic. */
export function pickRefSlug(slugs: Iterable<string>, kind: string): string | null {
  const set = slugs instanceof Set ? slugs : new Set(slugs);
  if (set.has(kind)) return kind;
  let best: string | null = null;
  for (const s of set) {
    if (s.startsWith(`${kind}-`) && (best === null || s.length < best.length)) best = s;
  }
  return best;
}

/** Create the reference-library loader. `base` overrides the endpoint (tests). */
export function createRefLib(base = '/__reflib'): RefLib {
  let slugs: Set<string> | null = null;
  let indexLoading = false;
  let indexFailAt = 0;   // last failed-fetch time; a FAILURE is retried (don't cache it as empty)
  const images = new Map<string, SpriteCanvas | null>();   // slug → canvas (null = failed)
  const imageLoading = new Set<string>();

  function ensureIndex(): void {
    if (slugs || indexLoading) return;
    // Retry a FAILED index fetch (e.g. the dev server was mid-restart) — but throttle so a down
    // endpoint isn't hammered every frame. A successful fetch that returns [] is terminal (real).
    if (indexFailAt && Date.now() - indexFailAt < 2000) return;
    indexLoading = true;
    fetch(base)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ slugs?: string[] }>; })
      .then((j) => { slugs = new Set(j.slugs ?? []); indexFailAt = 0; })
      .catch(() => { indexFailAt = Date.now(); })   // leave slugs null → ensureIndex retries later
      .finally(() => { indexLoading = false; });
  }

  function ensureImage(slug: string): void {
    if (images.has(slug) || imageLoading.has(slug)) return;
    imageLoading.add(slug);
    loadImageToCanvas(`${base}/${slug}/model-tti.png`)
      .then((c) => { images.set(slug, c); })
      .catch(() => { images.set(slug, null); })
      .finally(() => { imageLoading.delete(slug); });
  }

  /** Slugs that belong to `kind`: the exact slug + every `kind-*` variant. */
  function matchingSlugs(kind: string): string[] {
    if (!slugs) return [];
    const out: string[] = [];
    for (const s of slugs) if (s === kind || s.startsWith(`${kind}-`)) out.push(s);
    // Exact match first, then the variants alphabetically.
    return out.sort((a, b) => (a === kind ? -1 : b === kind ? 1 : a.localeCompare(b)));
  }

  return {
    base,
    referenceFor(kind: string): RefLibResult | null {
      ensureIndex();
      const slug = slugs ? pickRefSlug(slugs, kind) : null;
      if (!slug) return null;
      ensureImage(slug);
      return { slug, canvas: images.get(slug) ?? null };
    },
    referencesFor(kind: string): RefLibResult[] {
      ensureIndex();
      return matchingSlugs(kind).map((slug) => { ensureImage(slug); return { slug, canvas: images.get(slug) ?? null }; });
    },
    slugsFor(kind: string): string[] | null {
      ensureIndex();
      return slugs ? matchingSlugs(kind) : null;
    },
    invalidate(slug: string): void {
      images.delete(slug);
      imageLoading.delete(slug);
      if (slugs) slugs.add(slug);   // a regen may have created a brand-new variant slug
    },
  };
}
