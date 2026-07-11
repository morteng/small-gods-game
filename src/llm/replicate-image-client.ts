// img2img building-sprite generation via Replicate's official-model predictions
// API. Adopted for qwen/qwen-image-edit-2511 (2026-07-11 pilot: silhouette IoU
// 0.974–0.994 vs FLUX.2 Klein's 0.80 — an instruction editor optimized against
// image drift, exactly what the geometry-registered pipeline wants). Mirrors the
// OpenRouter client's contract ({blob, costUsd}, typed fatal/retryable errors)
// so GeneratedBuildingArtSource / the seeder / the studio treat both providers
// identically. Never used in tests against the real API.
import {
  BuildingImageError, type BuildingImageResult, type ImageErrorKind,
} from './openrouter-image-client';

/** Replicate's API reports no per-call cost in the prediction body. This is the
 *  official qwen-image-edit-2511 list price (~$0.03/image, replicate.com pricing
 *  2026-07) — a documented ESTIMATE we return as costUsd so the session spend
 *  tracker keeps counting, not a billed figure. */
export const QWEN_EDIT_COST_USD = 0.03;

/** Direct API hosts. In the dev browser both are unreachable cross-origin, so a
 *  cfg can supply same-origin proxy bases (see vite-plugins/llm-proxy.ts) and
 *  every absolute URL Replicate hands back (poll URL, delivery URL) is rewritten
 *  onto them before fetching. */
const API_ORIGIN = 'https://api.replicate.com';
const DELIVERY_ORIGIN = 'https://replicate.delivery';

/** Low-credit Replicate accounts (<$5 balance) are throttled to 6 prediction
 *  creates/min with burst 1 — pace creates PROACTIVELY instead of eating 429s.
 *  Overridable via REPLICATE_CREATE_SPACING_MS (0 disables; tests do this). */
const DEFAULT_CREATE_SPACING_MS = 11_000;
/** Bounded 429 retry (each also honours the body's `retry_after`). */
const MAX_CREATE_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 300_000;

export interface ReplicateImageClientConfig {
  /** Absent in the browser — the dev proxy injects REPLICATE_API_TOKEN. Direct
   *  (Node seeder / prod) calls need it or Replicate answers 401. */
  apiToken?: string;
  /** dev → '/api/img/replicate'; undefined → direct https://api.replicate.com */
  baseUrl?: string;
  /** dev → '/api/img/replicate-delivery'; undefined → direct https://replicate.delivery */
  deliveryBaseUrl?: string;
}

export interface GenerateReplicateImageOpts {
  initImageDataUri: string; // 'data:image/png;base64,...'
  prompt: string;
  /** Replicate model path, e.g. 'qwen/qwen-image-edit-2511'. */
  model?: string;
  signal?: AbortSignal;
}

/** Replicate-flavoured remedies/links (same kinds as the OpenRouter maps, so a
 *  seeder abort message points at the RIGHT billing page for the provider). */
export const REPLICATE_HELP_URL: Record<ImageErrorKind, string> = {
  limit: 'https://replicate.com/account/billing',
  auth: 'https://replicate.com/account/api-tokens',
  rate: 'https://replicate.com/account/billing',    // the 6/min throttle lifts with credit
  'no-image': 'https://replicate.com/predictions',  // inspect the failed prediction
  http: 'https://replicate.com/predictions',
  network: 'https://status.replicate.com',
};

export const REPLICATE_HELP_HINT: Record<ImageErrorKind, string> = {
  limit: 'Add Replicate credit (insufficient balance)',
  auth: 'Check or recreate your Replicate API token',
  rate: 'Replicate rate limit hit — low-credit accounts get 6 creates/min; wait or add credit',
  'no-image': 'The prediction produced no image — inspect it on Replicate',
  http: 'Replicate request failed — inspect your predictions',
  network: 'Network error reaching Replicate — check your connection / Replicate status',
};

/** Same fatal semantics as BuildingImageError (limit/auth abort a batch), but
 *  hint/helpUrl point at Replicate's pages instead of OpenRouter's. `instanceof
 *  BuildingImageError` keeps working everywhere (seeder, studio, art source). */
export class ReplicateImageError extends BuildingImageError {
  constructor(kind: ImageErrorKind, message: string, status?: number) {
    super(kind, message, status);
    this.name = 'ReplicateImageError';
  }
  override get hint(): string { return REPLICATE_HELP_HINT[this.kind]; }
  override get helpUrl(): string { return REPLICATE_HELP_URL[this.kind]; }
}

const LIMIT_RE = /\b(credit|insufficient|spend|quota|exceed|billing|payment|balance|limit reached|out of)\b/i;

/** Classify a Replicate HTTP failure into the shared typed-error vocabulary:
 *  401/403 → auth (fatal), 402 or a payment/credit body → limit (fatal),
 *  429 → rate (retryable), everything else → http. */
export function classifyReplicateImageError(status: number, bodyText: string): ReplicateImageError {
  const snippet = bodyText.slice(0, 300);
  if (status === 402 || (status >= 400 && LIMIT_RE.test(bodyText))) {
    return new ReplicateImageError('limit', `insufficient Replicate credit (HTTP ${status}): ${snippet}`, status);
  }
  if (status === 401 || status === 403) {
    return new ReplicateImageError('auth', `invalid or unauthorised Replicate token (HTTP ${status}): ${snippet}`, status);
  }
  if (status === 429) {
    return new ReplicateImageError('rate', `rate limited (HTTP 429): ${snippet}`, status);
  }
  return new ReplicateImageError('http', `HTTP ${status}: ${snippet}`, status);
}

/** Rewrite an absolute Replicate URL onto a same-origin proxy base (when one is
 *  configured), so browser callers never fetch cross-origin. Non-matching URLs
 *  pass through untouched. */
function rewriteOrigin(url: string, origin: string, proxyBase?: string): string {
  if (!proxyBase || !url.startsWith(origin)) return url;
  return proxyBase + url.slice(origin.length);
}

/** Env read at call time (not module load) so tests/tools can flip it; safe in
 *  the browser where `process` doesn't exist. */
function createSpacingMs(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const v = Number(env?.REPLICATE_CREATE_SPACING_MS);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_CREATE_SPACING_MS;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Module-level: creates are paced across ALL callers in the tab/process (the
// throttle is per account, not per call site).
let lastCreateAt = 0;

function dataUriToBlob(uri: string): Blob {
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(uri);
  if (!m) throw new ReplicateImageError('no-image', 'malformed data-URI in prediction output');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

interface Prediction {
  status: string;
  output?: unknown;
  error?: string;
  urls?: { get?: string };
}

export async function generateBuildingImageReplicate(
  cfg: ReplicateImageClientConfig,
  opts: GenerateReplicateImageOpts,
): Promise<BuildingImageResult> {
  const model = opts.model ?? 'qwen/qwen-image-edit-2511';
  const apiBase = cfg.baseUrl ?? API_ORIGIN;
  // Official-model endpoint (community models would need a version-pinned create
  // on /v1/predictions — qwen/* are official, so this stays simple). Prefer:
  // wait=60 usually returns a terminal prediction in ONE round trip; the poll
  // loop below only runs when generation outlasts the hold.
  const createUrl = `${apiBase}/v1/models/${model}/predictions`;
  const authHeaders: Record<string, string> = {};
  if (cfg.apiToken) authHeaders['Authorization'] = `Bearer ${cfg.apiToken}`;
  const body = JSON.stringify({
    // qwen-image-edit-2511 input shape, proven in the adoption pilot
    // (scripts/pilot-structure-adherence.ts).
    input: {
      prompt: opts.prompt,
      image: [opts.initImageDataUri],
      aspect_ratio: 'match_input_image',
      output_format: 'png',
      disable_safety_checker: true,
    },
  });

  let resp: Response | null = null;
  for (let i = 0; i < MAX_CREATE_ATTEMPTS; i++) {
    // Proactive spacing first (see DEFAULT_CREATE_SPACING_MS), then a reactive
    // bounded retry honouring the 429 body's retry_after.
    const wait = Math.max(0, lastCreateAt + createSpacingMs() - Date.now());
    if (wait > 0) await sleep(wait);
    lastCreateAt = Date.now();
    try {
      resp = await fetch(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'wait=60', ...authHeaders },
        body,
        signal: opts.signal,
      });
    } catch (err) {
      throw new ReplicateImageError('network', `network error: ${(err as Error).message}`);
    }
    if (resp.status !== 429) break;
    const retry = Number(((await resp.json().catch(() => ({}))) as { retry_after?: number }).retry_after ?? 10);
    await sleep((retry + 1) * 1000);
  }
  if (!resp || !resp.ok) {
    const txt = resp ? await resp.text().catch(() => '') : '';
    throw classifyReplicateImageError(resp?.status ?? 429, txt);
  }

  let pred = await resp.json() as Prediction;
  const started = Date.now();
  while (pred.status === 'starting' || pred.status === 'processing') {
    if (Date.now() - started > POLL_TIMEOUT_MS) {
      throw new ReplicateImageError('http', `prediction still ${pred.status} after ${POLL_TIMEOUT_MS / 1000}s — gave up polling`);
    }
    const pollUrl = pred.urls?.get;
    if (!pollUrl) throw new ReplicateImageError('no-image', 'prediction pending but carried no poll URL');
    await sleep(POLL_INTERVAL_MS);
    let poll: Response;
    try {
      // urls.get is ABSOLUTE (https://api.replicate.com/...) — rewrite onto the
      // proxy base so a browser caller stays same-origin.
      poll = await fetch(rewriteOrigin(pollUrl, API_ORIGIN, cfg.baseUrl), { headers: authHeaders, signal: opts.signal });
    } catch (err) {
      throw new ReplicateImageError('network', `network error polling prediction: ${(err as Error).message}`);
    }
    if (!poll.ok) throw classifyReplicateImageError(poll.status, await poll.text().catch(() => ''));
    pred = await poll.json() as Prediction;
  }
  if (pred.status !== 'succeeded') {
    // failed/canceled predictions are retryable (nondeterministic model) — same
    // non-fatal class as an empty output.
    throw new ReplicateImageError('no-image', `prediction ${pred.status}: ${(pred.error ?? '').slice(0, 300)}`);
  }

  const out = pred.output;
  const url = Array.isArray(out) ? out[0] as unknown : out;
  if (typeof url !== 'string') throw new ReplicateImageError('no-image', 'prediction succeeded but returned no image output');
  if (url.startsWith('data:')) return { blob: dataUriToBlob(url), costUsd: QWEN_EDIT_COST_USD };

  // Output images live on replicate.delivery (absolute URL) — same proxy rewrite.
  let img: Response;
  try {
    img = await fetch(rewriteOrigin(url, DELIVERY_ORIGIN, cfg.deliveryBaseUrl), { signal: opts.signal });
  } catch (err) {
    throw new ReplicateImageError('network', `network error fetching output image: ${(err as Error).message}`);
  }
  if (!img.ok) throw classifyReplicateImageError(img.status, await img.text().catch(() => ''));
  return { blob: await img.blob(), costUsd: QWEN_EDIT_COST_USD };
}
