/**
 * OpenRouter model catalog — pikkolo-style.
 *
 * Two layers, mirroring pikkolo's model registry:
 *  1. A small curated VERIFIED allowlist of confirmed-working, tool-call-capable
 *     model IDs. These are what players see by default.
 *  2. A live fetch of the full OpenRouter catalog (`/api/v1/models`), filtered to
 *     tool-calling models, for devs who want to test any model.
 *
 * Every ID in the VERIFIED lists has been confirmed to exist and to advertise
 * `tools` in OpenRouter's `supported_parameters` (the backfill + Fate brain rely
 * on tool calling). Promotion = add the ID here after confirming it works.
 */

export interface CuratedModel {
  id: string;
  name: string;
}

/** Cheap/fast tier — the default backfill model players run. */
export const VERIFIED_CHAT_MODELS: readonly CuratedModel[] = [
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash (cheapest)' },
  { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite' },
  { id: 'google/gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
];

/** Capable tier — invoked at key moments (Fate / authoring). */
export const VERIFIED_CAPABLE_MODELS: readonly CuratedModel[] = [
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro (recommended)' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
];

export const DEFAULT_CHAT_MODEL = VERIFIED_CHAT_MODELS[0].id;
export const DEFAULT_CAPABLE_MODEL = VERIFIED_CAPABLE_MODELS[0].id;

/**
 * Model IDs that once shipped as defaults but are NOT valid OpenRouter IDs
 * (they 400 with "not a valid model ID"). `loadProviderConfig` remaps any
 * persisted config holding one of these to the current default so an old
 * localStorage entry can't keep breaking backfill.
 */
export const DEAD_MODEL_IDS: ReadonlySet<string> = new Set([
  'deepseek/deepseek-v4',
  'anthropic/claude-sonnet-4.6',
  'deepseek/deepseek-v4-pro-preview',
  'google/gemini-2.5-flash-image', // image-only; not a chat model
]);

export interface OpenRouterModel {
  id: string;
  name: string;
  /** Provider slug (the part before '/' in the id), e.g. 'google'. */
  provider: string;
  /** Short model description from the catalog, '' if absent. */
  description: string;
  /** Context window in tokens, null if absent. */
  contextLength: number | null;
  /** USD per million prompt tokens (null if the catalog omitted pricing). */
  promptPrice: number | null;
  /** USD per million completion tokens. */
  completionPrice: number | null;
  free: boolean;
}

const CATALOG_URL = 'https://openrouter.ai/api/v1/models';

// Module-level cache: one in-flight/settled promise shared across settings opens.
let cache: Promise<OpenRouterModel[]> | null = null;

interface RawModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  supported_parameters?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
}

function toPerMillion(raw: unknown): number | null {
  const n = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(n) ? n * 1_000_000 : null;
}

/** Parse a raw `/api/v1/models` payload into tool-calling models, sorted by price. */
export function parseCatalog(data: unknown): OpenRouterModel[] {
  const list = (data as { data?: unknown })?.data;
  if (!Array.isArray(list)) return [];
  const out: OpenRouterModel[] = [];
  for (const raw of list as RawModel[]) {
    if (typeof raw?.id !== 'string') continue;
    const params = raw.supported_parameters;
    const supportsTools = Array.isArray(params) && params.includes('tools');
    if (!supportsTools) continue; // backfill + Fate both need tool calling
    const promptPrice = toPerMillion(raw.pricing?.prompt);
    const completionPrice = toPerMillion(raw.pricing?.completion);
    out.push({
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : raw.id,
      provider: raw.id.includes('/') ? raw.id.split('/')[0] : '',
      description: typeof raw.description === 'string' ? raw.description : '',
      contextLength: typeof raw.context_length === 'number' ? raw.context_length : null,
      promptPrice,
      completionPrice,
      free: promptPrice === 0 && completionPrice === 0,
    });
  }
  out.sort((a, b) => (a.promptPrice ?? Infinity) - (b.promptPrice ?? Infinity));
  return out;
}

/**
 * Fetch the live tool-calling catalog from OpenRouter. Cached for the session.
 * Resolves to `[]` on any network/parse failure — callers fall back to the
 * verified lists, so a failed fetch degrades to "verified only", never throws.
 */
export function fetchOpenRouterModels(apiKey?: string): Promise<OpenRouterModel[]> {
  if (cache) return cache;
  cache = (async () => {
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const resp = await fetch(CATALOG_URL, { headers });
      if (!resp.ok) return [];
      return parseCatalog(await resp.json());
    } catch {
      return [];
    }
  })();
  return cache;
}

/** Drop the cached catalog (test seam / forced refresh). */
export function clearCatalogCache(): void {
  cache = null;
}

/** "$0.10/M" style price suffix for a dropdown label, or '' if unknown. */
export function formatPrice(m: OpenRouterModel): string {
  if (m.free) return 'free';
  if (m.promptPrice == null) return '';
  return `$${m.promptPrice.toFixed(m.promptPrice < 1 ? 2 : 1)}/M`;
}
