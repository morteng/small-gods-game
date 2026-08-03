// The BUILDING side of img2img generation: the model constant every building
// consumer (game runtime sources, studio, seeder) shares, plus the thin call
// that applies it. The provider split itself (Replicate vs OpenRouter) is NOT
// here — it moved to `image-dispatch.ts` so buildings, flora and NPC sprites
// route through one seam instead of growing one apiece.

import type { BuildingImageResult, GenerateBuildingImageOpts } from './openrouter-image-client';
import { generateImageAuto, type ImageProviders } from './image-dispatch';

// Default img2img model. Qwen-Image-Edit-2511 on Replicate (~$0.03/img):
// adopted 2026-07-11 after the structure-adherence pilot measured silhouette
// IoU 0.974–0.994 vs FLUX.2 Klein's 0.80 baseline — an instruction editor that
// repaints surfaces without drifting the geometry, which is exactly what the
// register-onto-the-geometry-grid pipeline wants. Explicit non-qwen model ids
// (the studio A/B harness, gemini) still route to OpenRouter via the dispatcher.
export const BUILDING_IMAGE_MODEL = 'qwen/qwen-image-edit-2511';

/** Historical name for the dispatcher's provider config, kept so building call
 *  sites read in their own vocabulary. */
export type BuildingImageProviders = ImageProviders;

/** Generate a building image through whichever provider hosts `opts.model`
 *  (default: BUILDING_IMAGE_MODEL). Same contract both ways — {blob, costUsd},
 *  throws BuildingImageError with fatal limit/auth semantics. */
export async function generateBuildingImageAuto(
  cfg: BuildingImageProviders,
  opts: GenerateBuildingImageOpts,
): Promise<BuildingImageResult> {
  return generateImageAuto(cfg, { ...opts, model: opts.model ?? BUILDING_IMAGE_MODEL });
}
