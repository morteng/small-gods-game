/**
 * The shipped img2img editors as a `SpriteBackend` — the same seam the building
 * art pipeline already runs on, reached the same way an NPC sprite will reach
 * it. Routing (qwen → Replicate, everything else → OpenRouter) is not repeated
 * here; it is `src/llm/image-dispatch.ts`'s single job.
 *
 * These models are a genuinely different animal from a text-to-sprite
 * generator, and the capabilities say so rather than papering over it: the init
 * image is the SUBJECT (mandatory), the output size matches it, and none of
 * seed / negative prompt / denoise strength reaches the model through our
 * clients. A job that asks for a seed here gets an honest `ignored: ['seed']`
 * back — which is exactly what a gate needs to know before it records art as
 * reproducible.
 */
import type { AssetProvider } from '@/core/types';
import {
  generateImageAuto,
  isReplicateImageModel,
  type ImageProviders,
} from '@/llm/image-dispatch';
import {
  acceptJob,
  SpriteBackendUnavailableError,
  type SpriteBackend,
  type SpriteBackendCapabilities,
  type SpriteJob,
  type SpriteResult,
} from './backend';

/** An instruction editor: hand it a picture, get the picture back repainted.
 *  Everything else in `SpriteJob` is beyond what our clients can express. */
export const IMG2IMG_CAPABILITIES: SpriteBackendCapabilities = {
  init: 'required',
  seed: false,
  size: false,
  denoise: false,
  negative: false,
  abort: true,
};

export interface Img2ImgBackendConfig {
  /** Model id — decides the host. No default: the asset family that owns a
   *  default model states it (see BUILDING_IMAGE_MODEL). */
  model: string;
  providers: ImageProviders;
  /** Injected for tests; defaults to the real dispatcher. */
  generateFn?: typeof generateImageAuto;
}

/**
 * Build a backend for `cfg.model`.
 *
 * THROWS for an OpenRouter-routed model, and the reason is worth stating: an
 * asset's `provider` is persisted provenance, and `AssetProvider` has no
 * `'openrouter'` member. Tagging a FLUX-via-OpenRouter generation `'replicate'`
 * would be a lie written into IndexedDB and the vendored manifest, where it
 * would outlive everyone who could correct it. Widening the union is a
 * deliberate change to stored data and belongs in its own commit; until then
 * this seam serves the Replicate-hosted models and the studio's A/B harness
 * keeps calling the dispatcher directly.
 */
export function createImg2ImgBackend(cfg: Img2ImgBackendConfig): SpriteBackend {
  const provider: AssetProvider = 'replicate';
  if (!isReplicateImageModel(cfg.model)) {
    throw new SpriteBackendUnavailableError(
      provider,
      `no AssetProvider names the host of '${cfg.model}' (OpenRouter-routed); ` +
        'widen AssetProvider deliberately before persisting art from it',
    );
  }
  const call = cfg.generateFn ?? generateImageAuto;
  const model = cfg.model;
  return {
    provider,
    model,
    capabilities: IMG2IMG_CAPABILITIES,
    async generate(job: SpriteJob): Promise<SpriteResult> {
      const ignored = acceptJob(provider, IMG2IMG_CAPABILITIES, job);
      // acceptJob has already refused a job with no init.
      const res = await call(cfg.providers, {
        initImageDataUri: job.init!.pngDataUri,
        prompt: job.prompt,
        model,
        signal: job.signal,
      });
      return { blob: res.blob, provider, model, costUsd: res.costUsd, ignored };
    },
  };
}
