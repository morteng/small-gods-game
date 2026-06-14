// img2img building-sprite generation via an OpenRouter image model. Mirrors the
// text OpenRouterProvider's request/header shape (see llm-client.ts), but sends
// an image_url init part + modalities:['image','text'] and parses the image out
// of choices[0].message.images. Never used in tests against the real API.

// Default img2img model. FLUX.2 Klein 4B: ~$0.014/img vs gemini-2.5-flash-image's
// ~$0.039 (≈64% cheaper) at our ≤1 MP sprite size, with equal-or-better silhouette
// IoU + clean magenta keying in A/B eval (2026-06-13). Image-only output, so
// defaultModalitiesFor() routes it to ['image'] (the 'text' modality 404s on FLUX).
export const BUILDING_IMAGE_MODEL = 'black-forest-labs/flux.2-klein-4b';

export interface BuildingImageClientConfig {
  apiKey: string;
  baseUrl?: string;   // dev → '/api/llm/openrouter/api/v1'; prod → undefined (direct)
  siteUrl?: string;
  siteName?: string;
}

export interface GenerateBuildingImageOpts {
  initImageDataUri: string; // 'data:image/png;base64,...'
  prompt: string;
  /** Image model id; defaults to BUILDING_IMAGE_MODEL. The prompt must already be
   *  adapted for this model (see buildingImagePrompt). */
  model?: string;
  /** Output modalities. Gemini-image wants ['image','text']; some image-only
   *  providers (e.g. Black Forest FLUX) reject 'text' with a 404 ("no endpoints
   *  support the requested output modalities") and need just ['image']. Defaults
   *  to the modalities BUILDING_IMAGE_MODEL expects. */
  modalities?: string[];
  signal?: AbortSignal;
}

export interface BuildingImageResult { blob: Blob; costUsd: number }

/** Why a generation failed. `limit`/`auth` are FATAL — the same key will keep
 *  failing, so a batch should stop rather than burn attempts/quota. The rest are
 *  worth a retry (transient model/network hiccups). */
export type ImageErrorKind = 'limit' | 'auth' | 'rate' | 'no-image' | 'http' | 'network';

/** Deep links to the exact OpenRouter settings page a user needs to fix each
 *  failure — so an error message can point them straight at "add credits" /
 *  "raise this key's limit" rather than leaving them to hunt. */
export const OPENROUTER_HELP_URL: Record<ImageErrorKind, string> = {
  limit: 'https://openrouter.ai/settings/credits',   // add credits / raise the account balance
  auth: 'https://openrouter.ai/settings/keys',       // check / recreate the API key
  rate: 'https://openrouter.ai/settings/keys',       // a per-key rate or spend limit lives here
  'no-image': 'https://openrouter.ai/activity',      // inspect the actual response/usage
  http: 'https://openrouter.ai/activity',
  network: 'https://status.openrouter.ai',           // is OpenRouter up?
};

/** One-line, user-facing remedy per failure kind (pairs with OPENROUTER_HELP_URL). */
export const OPENROUTER_HELP_HINT: Record<ImageErrorKind, string> = {
  limit: 'Add credits or raise your account spend limit',
  auth: 'Check or recreate your OpenRouter API key',
  rate: 'Rate or spend limit hit — wait, or raise the key limit',
  'no-image': 'The model returned no image — inspect the request on OpenRouter',
  http: 'OpenRouter request failed — see your activity log',
  network: 'Network error reaching OpenRouter — check your connection / OpenRouter status',
};

/** Output modalities an image model expects on OpenRouter. Gemini-image emits
 *  text + image, so it needs ['image','text']; image-only providers (Black Forest
 *  FLUX, …) 404 with "No endpoints found that support the requested output
 *  modalities: image, text" if 'text' is requested, so they get ['image']. */
export function defaultModalitiesFor(model: string): string[] {
  const m = model.toLowerCase();
  if (m.includes('flux') || m.includes('black-forest')) return ['image'];
  return ['image', 'text'];
}

export class BuildingImageError extends Error {
  constructor(public readonly kind: ImageErrorKind, message: string, public readonly status?: number) {
    super(message);
    this.name = 'BuildingImageError';
  }
  /** Retrying with the same key/credentials cannot succeed — abort the batch. */
  get fatal(): boolean { return this.kind === 'limit' || this.kind === 'auth'; }
  /** Short remedy for this failure (e.g. "Add credits or raise your spend limit"). */
  get hint(): string { return OPENROUTER_HELP_HINT[this.kind]; }
  /** OpenRouter settings/help page that fixes this failure. */
  get helpUrl(): string { return OPENROUTER_HELP_URL[this.kind]; }
}

const LIMIT_RE = /\b(credit|insufficient|spend|quota|exceed|billing|payment|balance|limit reached|out of)\b/i;

/** Classify an OpenRouter image response (HTTP status + parsed body text) into a
 *  typed error kind. OpenRouter signals over-spend / no-credit as HTTP 402 (and
 *  sometimes a 200 whose body carries an `error` object), rate limits as 429, and
 *  bad keys as 401/403. We surface those distinctly so callers stop hammering a
 *  capped key instead of seeing a vague "no image". */
export function classifyImageError(status: number, bodyText: string): BuildingImageError {
  const snippet = bodyText.slice(0, 300);
  if (status === 402 || (status >= 400 && LIMIT_RE.test(bodyText))) {
    return new BuildingImageError('limit', `over spend limit / insufficient credits (HTTP ${status}): ${snippet}`, status);
  }
  if (status === 401 || status === 403) {
    return new BuildingImageError('auth', `invalid or unauthorised API key (HTTP ${status}): ${snippet}`, status);
  }
  if (status === 429) {
    return new BuildingImageError('rate', `rate limited (HTTP 429): ${snippet}`, status);
  }
  return new BuildingImageError('http', `HTTP ${status}: ${snippet}`, status);
}

function dataUriToBlob(uri: string): Blob {
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(uri);
  if (!m) throw new Error('building image: malformed data-URI in response');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

export async function generateBuildingImage(
  cfg: BuildingImageClientConfig,
  opts: GenerateBuildingImageOpts,
): Promise<BuildingImageResult> {
  const url = `${cfg.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`;
  const model = opts.model ?? BUILDING_IMAGE_MODEL;
  const body = {
    model,
    modalities: opts.modalities ?? defaultModalitiesFor(model),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: opts.prompt },
        { type: 'image_url', image_url: { url: opts.initImageDataUri } },
      ],
    }],
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`,
    'HTTP-Referer': cfg.siteUrl ?? (typeof window !== 'undefined' ? window.location?.href : '') ?? 'http://localhost:3000',
    'X-Title': cfg.siteName ?? 'Small Gods Game',
  };

  let resp: Response;
  try {
    resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
  } catch (err) {
    throw new BuildingImageError('network', `network error: ${(err as Error).message}`);
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw classifyImageError(resp.status, txt);
  }
  // OpenRouter sometimes returns HTTP 200 with an `error` object instead of a
  // result (provider-side billing/quota failures leak through this way) — detect
  // it so an over-spend key isn't misreported as a generic "no image".
  const json = await resp.json() as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    usage?: { cost?: number };
    error?: { message?: string; code?: number | string };
  };
  if (json.error) {
    const msg = json.error.message ?? JSON.stringify(json.error);
    const code = typeof json.error.code === 'number' ? json.error.code : 200;
    throw classifyImageError(code, msg);
  }
  const imgUri = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imgUri) throw new BuildingImageError('no-image', 'response contained no image (model returned text only)');
  return { blob: dataUriToBlob(imgUri), costUsd: json.usage?.cost ?? 0 };
}
