/**
 * `AssetProvider` → `SpriteBackend`. This is the dispatch the provenance tag
 * never had.
 *
 * Kept separate from `backend.ts` on purpose: the interface module stays a leaf
 * that the concrete backends import, and the wiring lives one level up where it
 * can import all of them. The other arrangement — dispatch inside the interface
 * module — is an import cycle, and the house does not need an eleventh.
 *
 * A provider with no backend is REFUSED by name. `'fal'` is declared in
 * `AssetProvider` because assets could arrive tagged with it; that is not a
 * claim we can generate through it, and pretending otherwise would surface as a
 * confusing failure deep in a pipeline instead of a sentence at the seam.
 */
import type { AssetProvider } from '@/core/types';
import { isReplicateImageModel } from '@/llm/image-dispatch';
import { SpriteBackendUnavailableError, type SpriteBackend } from './backend';
import { createImg2ImgBackend, type Img2ImgBackendConfig } from './img2img-backend';
import { createMockBackend, type MockBackendConfig } from './mock-backend';
import { createPixelLabBackend, type PixelLabBackendConfig } from './pixellab-backend';

/** Per-provider wiring. A provider whose entry is absent is unavailable — the
 *  refusal names what is missing, so a caller learns "no PixelLab key" rather
 *  than "undefined is not a function". */
export interface SpriteBackendDeps {
  pixellab?: PixelLabBackendConfig;
  /** ONE img2img config serves both hosts: the model id decides which, by the
   *  same rule `image-dispatch` routes on. Keying it per-host would let the two
   *  disagree about where a model lives. */
  img2img?: Img2ImgBackendConfig;
  mock?: MockBackendConfig;
}

/** Providers this build can actually generate through, given `deps`. Useful for
 *  a settings surface that should not offer a backend it cannot run. */
export function availableProviders(deps: SpriteBackendDeps): AssetProvider[] {
  const out: AssetProvider[] = [];
  if (deps.pixellab?.apiKey) out.push('pixellab');
  // The configured model names its own host — offering the other one would
  // promise a backend that immediately refuses.
  if (deps.img2img) out.push(isReplicateImageModel(deps.img2img.model) ? 'replicate' : 'openrouter');
  if (deps.mock) out.push('mock');
  return out;
}

export function createSpriteBackend(
  provider: AssetProvider,
  deps: SpriteBackendDeps = {},
): SpriteBackend {
  switch (provider) {
    case 'pixellab': {
      const cfg = deps.pixellab;
      if (!cfg?.apiKey) {
        throw new SpriteBackendUnavailableError(provider, 'no PixelLab API key configured');
      }
      return createPixelLabBackend(cfg);
    }
    case 'replicate':
    case 'openrouter': {
      const cfg = deps.img2img;
      if (!cfg) {
        throw new SpriteBackendUnavailableError(provider, 'no img2img model/providers configured');
      }
      const backend = createImg2ImgBackend(cfg);
      if (backend.provider !== provider) {
        throw new SpriteBackendUnavailableError(
          provider,
          `'${cfg.model}' is hosted on '${backend.provider}', not '${provider}'`,
        );
      }
      return backend;
    }
    case 'mock':
      return createMockBackend(deps.mock ?? {});
    case 'fal':
      throw new SpriteBackendUnavailableError(
        provider,
        "'fal' is a declared provenance value with no backend implemented — nothing generates through it yet",
      );
  }
}
