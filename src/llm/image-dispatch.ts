// The provider split for img2img generation, with no opinion about WHAT is
// being generated. A model id decides the host — 'qwen/…' is Replicate, every
// other id is an OpenRouter chat-completions image model — and both sides
// answer with the same {blob, costUsd} shape and the same typed
// BuildingImageError vocabulary, so a caller never learns which one served it.
//
// This module is a LEAF: it imports the two clients and nothing else. Callers
// that own a DEFAULT model (buildings via `building-image.ts`, flora, NPC
// sprites) layer that default on top and delegate here, so the routing rule
// lives in exactly one place instead of once per asset family.

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

/** Replicate-hosted models are namespaced 'qwen/…' in our model-id space;
 *  everything else is an OpenRouter chat-completions image model. */
export function isReplicateImageModel(model: string): boolean {
  return model.startsWith('qwen/');
}

/** Both providers' credentials/base-URLs — the dispatcher picks per model, so a
 *  call site wires this once and any model id keeps working through it. */
export interface ImageProviders {
  openrouter: BuildingImageClientConfig;
  replicate?: ReplicateImageClientConfig;
}

/** A dispatchable job: the client options with the model made EXPLICIT. The
 *  dispatcher has no default of its own — defaults belong to the asset family
 *  that owns them (see BUILDING_IMAGE_MODEL). */
export type ImageDispatchOpts = GenerateBuildingImageOpts & { model: string };

/** Generate through whichever provider hosts `opts.model`. Same contract both
 *  ways — {blob, costUsd}, throws BuildingImageError with fatal limit/auth
 *  semantics. */
export async function generateImageAuto(
  cfg: ImageProviders,
  opts: ImageDispatchOpts,
): Promise<BuildingImageResult> {
  if (isReplicateImageModel(opts.model)) {
    return generateBuildingImageReplicate(cfg.replicate ?? {}, {
      initImageDataUri: opts.initImageDataUri,
      prompt: opts.prompt,
      model: opts.model,
      signal: opts.signal,
    });
  }
  return generateBuildingImage(cfg.openrouter, opts);
}
