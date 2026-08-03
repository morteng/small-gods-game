/**
 * PixelLab as a `SpriteBackend` — one plugin among siblings, not the wall the
 * asset pipeline is built against.
 *
 * Everything provider-shaped stays behind this adapter: the base64-without-a-
 * data-URI init field, the 1–999 `init_image_strength` scale, the style enums,
 * the LPC palette anchor it ships on every call. The seam above sees a prompt,
 * a size, a seed and a normalized `denoise01`.
 */
import type { PixelLabGenerateOpts } from '@/core/types';
import { generate } from '@/services/pixellab';
import {
  acceptJob,
  type SpriteBackend,
  type SpriteBackendCapabilities,
  type SpriteJob,
  type SpriteResult,
} from './backend';

/** Pixflux is a text-to-sprite generator: it seeds, it sizes, it takes a
 *  negative prompt, and an init image is optional guidance rather than the
 *  subject. It has no cancellation — the client takes no AbortSignal. */
export const PIXELLAB_CAPABILITIES: SpriteBackendCapabilities = {
  init: 'optional',
  seed: true,
  size: true,
  denoise: true,
  negative: true,
  abort: false,
};

/** PixelLab's own scale for how hard the init image pulls: 1–999, higher =
 *  closer to the init. `denoise01` runs the other way (0 = keep the init), so
 *  the map is inverse and linear. It is calibrated on the endpoint's own
 *  default: denoise01 0.7 lands on 300, the strength this project has always
 *  sent, so an unstated adherence keeps generating what it generated before. */
export function denoiseToInitStrength(denoise01: number): number {
  const d = Math.min(1, Math.max(0, denoise01));
  return Math.round(999 - d * 998);
}

/** The `denoise01` that reproduces PixelLab's shipped default strength (300). */
export const PIXELLAB_DEFAULT_DENOISE01 = 0.7;

/** Strip the 'data:image/png;base64,' prefix — pixflux wants bare base64. */
function toBareBase64(pngDataUri: string): string {
  const comma = pngDataUri.indexOf(',');
  return comma < 0 ? pngDataUri : pngDataUri.slice(comma + 1);
}

export interface PixelLabBackendConfig {
  apiKey: string;
  /** Injected for tests; defaults to the real client. */
  generateFn?: typeof generate;
}

export function createPixelLabBackend(cfg: PixelLabBackendConfig): SpriteBackend {
  const call = cfg.generateFn ?? generate;
  const provider = 'pixellab' as const;
  return {
    provider,
    model: 'pixflux',
    capabilities: PIXELLAB_CAPABILITIES,
    async generate(job: SpriteJob): Promise<SpriteResult> {
      const ignored = acceptJob(provider, PIXELLAB_CAPABILITIES, job);
      // jobRefusal has already guaranteed both are present for a size-capable
      // backend; the non-null assertions restate that rather than inventing a
      // fallback size.
      const opts: PixelLabGenerateOpts = {
        prompt: job.prompt,
        width: job.width!,
        height: job.height!,
        seed: job.seed,
        kind: job.meta?.kind,
        tags: job.meta?.tags,
        description: job.meta?.description,
        origin: job.meta?.origin,
        affinity: job.meta?.affinity,
        // Left undefined the client applies its own conservative default —
        // every pixflux call carries the LPC palette anchor, so 'lpc-derived'.
        lineage: job.meta?.lineage,
      };
      if (job.negative !== undefined) opts.negativeDescription = job.negative;
      if (job.init) {
        opts.initImage = toBareBase64(job.init.pngDataUri);
        if (job.init.denoise01 !== undefined) {
          opts.initImageStrength = denoiseToInitStrength(job.init.denoise01);
        }
      }
      const res = await call(cfg.apiKey, opts);
      return {
        blob: res.blob,
        provider,
        model: 'pixflux',
        // No costUsd: PixelLab bills subscription generations, not per-call
        // dollars. Reporting 0 would read as "this was free".
        cached: res.cached,
        ignored,
      };
    },
  };
}
