/**
 * `SpriteBackend` — the one seam a sprite generator is reached through, so
 * `AssetProvider` stops being a provenance label that dispatches nothing.
 *
 * The design constraint that shaped this file: **the backends do not have the
 * same powers, and pretending otherwise would be the bug.** PixelLab's pixflux
 * endpoint is a text-to-sprite generator with a seed, an explicit output size,
 * a negative prompt and an optional init image at a chosen strength. The
 * img2img editors we already ship (qwen-image-edit on Replicate, FLUX/gemini on
 * OpenRouter) are the opposite shape: an init image is MANDATORY, the output
 * size matches it, and none of them takes a seed, a negative prompt or a
 * denoise strength through our clients.
 *
 * So a `SpriteJob` states what the CALLER wants and every field beyond
 * prompt+init is optional, while each backend DECLARES what it can honour
 * (`SpriteBackendCapabilities`). Two pure functions make the mismatch legible
 * before a request is ever sent: `jobRefusal` (this backend cannot run this job
 * at all) and `unsupportedJobFields` (it will run it, silently doing without
 * these). A result repeats the ignored list, so a pipeline gate can record that
 * "seeded" art was in fact unseeded rather than assume reproducibility it never
 * had.
 *
 * This module is a LEAF — types, two pure predicates, two error classes, and
 * no import of any concrete backend. `backend-registry.ts` does the wiring;
 * backends depend on this file and never on each other.
 */
import type { AssetAffinity, AssetKind, AssetLineage, AssetOrigin, AssetProvider } from '@/core/types';

/**
 * Provider-neutral library metadata carried alongside a job, for backends that
 * persist what they generate (PixelLab writes through the sprite library, which
 * doubles as its cache). Backends that only return pixels ignore it.
 *
 * `lineage` is here rather than invented at write time because provenance
 * cannot be reconstructed afterwards — see `AssetLineage`.
 */
export interface SpriteJobMeta {
  kind?: AssetKind;
  tags?: string[];
  description?: string;
  origin?: AssetOrigin;
  affinity?: AssetAffinity;
  lineage?: AssetLineage;
}

/** What the caller wants generated. Only `prompt` is universal; everything else
 *  is a request a backend may or may not be able to honour. */
export interface SpriteJob {
  prompt: string;
  /** What to avoid. Only PixelLab has a real negative-prompt field. */
  negative?: string;
  /** Output size. Edit models match the init image instead and ignore this. */
  width?: number;
  height?: number;
  /** Reproducibility. Absent from every img2img client we ship. */
  seed?: number;
  /** img2img guidance. `pngDataUri` is a 'data:image/png;base64,…' string —
   *  the form both img2img clients already take; the PixelLab backend strips
   *  the prefix for its own base64 field. */
  init?: {
    pngDataUri: string;
    /** Normalized init adherence: 0 = keep the init, 1 = ignore it. Backends
     *  without a strength control ignore this and say so. */
    denoise01?: number;
  };
  meta?: SpriteJobMeta;
  /** Cancellation. The PixelLab client takes no signal and says so rather than
   *  accepting one it would drop — a dropped abort keeps spending. */
  signal?: AbortSignal;
}

/** Job fields that a backend may be unable to honour, named for reporting. */
export type SpriteJobField = 'negative' | 'width' | 'height' | 'seed' | 'denoise01' | 'signal';

/** What a backend can actually do — declared per backend, never assumed. */
export interface SpriteBackendCapabilities {
  /** `'required'` is the img2img editors: no init image, no request. */
  init: 'required' | 'optional' | 'unsupported';
  /** Honours a caller-chosen seed, so the same job reproduces. */
  seed: boolean;
  /** The output size comes from the job (vs matching the init image). A
   *  size-capable backend has no size of its own, so the job must carry one. */
  size: boolean;
  /** Honours `init.denoise01`. */
  denoise: boolean;
  /** Honours a negative prompt. */
  negative: boolean;
  /** Honours `signal` — the request can actually be cancelled. */
  abort: boolean;
}

export interface SpriteResult {
  /** Generated image, PNG. Deliberately a Blob and not a decoded `Raster`:
   *  both shipped clients already answer in Blobs, and decoding needs a canvas
   *  the author-time Node scripts do not have. The pipeline decodes where it
   *  can, which is also where it gates. */
  blob: Blob;
  /** Provenance, for the library record. */
  provider: AssetProvider;
  model: string;
  /** Estimated spend, when the backend knows one. PixelLab bills in
   *  subscription generations rather than per-call dollars, so it omits this
   *  instead of reporting a fictional 0. */
  costUsd?: number;
  /** True when the backend served this from its own cache and no request left
   *  the machine. Only PixelLab tracks it today. */
  cached?: boolean;
  /** Job fields this backend could not honour. Empty is the happy path. */
  ignored: readonly SpriteJobField[];
}

export interface SpriteBackend {
  readonly provider: AssetProvider;
  /** The concrete model behind this backend, recorded on every asset. */
  readonly model: string;
  readonly capabilities: SpriteBackendCapabilities;
  generate(job: SpriteJob): Promise<SpriteResult>;
}

/** No backend exists for a provider, or the one that does is missing what it
 *  needs to run (credentials, endpoints). Thrown at construction. */
export class SpriteBackendUnavailableError extends Error {
  constructor(readonly provider: AssetProvider, message: string) {
    super(message);
    this.name = 'SpriteBackendUnavailableError';
  }
}

/** This backend exists but cannot run THIS job. Thrown instead of quietly
 *  generating something the caller did not ask for. */
export class SpriteJobUnsupportedError extends Error {
  constructor(readonly provider: AssetProvider, message: string) {
    super(message);
    this.name = 'SpriteJobUnsupportedError';
  }
}

/**
 * Why this backend cannot run this job at all, or null.
 *
 * The init image is fatal in both directions. An editor with no init has
 * nothing to edit. An init handed to a backend that cannot take one would be
 * silently dropped — and a pipeline that gates a result against the frame that
 * produced it would then be comparing against a frame the model never saw,
 * which is worse than a refusal.
 *
 * A missing size is fatal for a size-capable backend for the same reason it is
 * declared capable: the size comes from the job and there is nowhere else to
 * get one. Backends that match the init image's size declare `size: false` and
 * never reach this.
 */
export function jobRefusal(caps: SpriteBackendCapabilities, job: SpriteJob): string | null {
  if (caps.init === 'required' && !job.init) {
    return 'this backend edits an init image and the job supplied none';
  }
  if (caps.init === 'unsupported' && job.init) {
    return 'this backend cannot take an init image, and dropping one silently would break init-referenced gates';
  }
  if (caps.size && (job.width === undefined || job.height === undefined)) {
    return 'this backend takes its output size from the job, which supplied no width/height';
  }
  return null;
}

/** Fields the job SETS that this backend will do without. Order is stable so
 *  the list can be asserted and logged. */
export function unsupportedJobFields(
  caps: SpriteBackendCapabilities,
  job: SpriteJob,
): SpriteJobField[] {
  const out: SpriteJobField[] = [];
  if (job.negative !== undefined && !caps.negative) out.push('negative');
  if (job.width !== undefined && !caps.size) out.push('width');
  if (job.height !== undefined && !caps.size) out.push('height');
  if (job.seed !== undefined && !caps.seed) out.push('seed');
  if (job.init?.denoise01 !== undefined && !caps.denoise) out.push('denoise01');
  if (job.signal !== undefined && !caps.abort) out.push('signal');
  return out;
}

/** Refuse loudly, or return the fields that will be ignored. Every backend's
 *  `generate` opens with this so the two checks can never drift apart. */
export function acceptJob(
  provider: AssetProvider,
  caps: SpriteBackendCapabilities,
  job: SpriteJob,
): SpriteJobField[] {
  const refusal = jobRefusal(caps, job);
  if (refusal) throw new SpriteJobUnsupportedError(provider, refusal);
  return unsupportedJobFields(caps, job);
}
