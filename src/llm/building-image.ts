// The single dispatch seam for building/flora img2img: every consumer (game
// runtime sources, studio, seeder) imports THE model constant and the auto
// dispatcher from here, and the provider split (Replicate vs OpenRouter) stays
// an implementation detail of this module. Both clients share the result shape
// ({blob, costUsd}) and the typed BuildingImageError vocabulary, so callers
// never care which side served the request.

import {
  generateBuildingImage,
  type BuildingImageClientConfig,
  type BuildingImageResult,
  type GenerateBuildingImageOpts,
} from './openrouter-image-client';
import {
  generateBuildingImageReplicate,
  type ReplicateImageClientConfig,
} from './replicate-image-client';

// Default img2img model. Qwen-Image-Edit-2511 on Replicate (~$0.03/img):
// adopted 2026-07-11 after the structure-adherence pilot measured silhouette
// IoU 0.974–0.994 vs FLUX.2 Klein's 0.80 baseline — an instruction editor that
// repaints surfaces without drifting the geometry, which is exactly what the
// register-onto-the-geometry-grid pipeline wants. Explicit non-qwen model ids
// (the studio A/B harness, gemini) still route to OpenRouter below.
export const BUILDING_IMAGE_MODEL = 'qwen/qwen-image-edit-2511';

/** Replicate-hosted models are namespaced 'qwen/…' in our model-id space;
 *  everything else is an OpenRouter chat-completions image model. */
export function isReplicateImageModel(model: string): boolean {
  return model.startsWith('qwen/');
}

/** Both providers' credentials/base-URLs — the dispatcher picks per model, so a
 *  call site wires this once and any model id keeps working through it. */
export interface BuildingImageProviders {
  openrouter: BuildingImageClientConfig;
  replicate?: ReplicateImageClientConfig;
}

/** Generate through whichever provider hosts `opts.model` (default:
 *  BUILDING_IMAGE_MODEL). Same contract both ways — {blob, costUsd}, throws
 *  BuildingImageError with fatal limit/auth semantics. */
export async function generateBuildingImageAuto(
  cfg: BuildingImageProviders,
  opts: GenerateBuildingImageOpts,
): Promise<BuildingImageResult> {
  const model = opts.model ?? BUILDING_IMAGE_MODEL;
  if (isReplicateImageModel(model)) {
    return generateBuildingImageReplicate(cfg.replicate ?? {}, {
      initImageDataUri: opts.initImageDataUri,
      prompt: opts.prompt,
      model,
      signal: opts.signal,
    });
  }
  return generateBuildingImage(cfg.openrouter, { ...opts, model });
}
