// The NPC side of the img2img model default — the constant every NPC sprite
// consumer (G1's author-time seeder today; G2's runtime source when it ships)
// shares, mirroring `building-image.ts`'s role for structures. The provider
// split itself lives in `image-dispatch.ts` and is not repeated here.
//
// A SEPARATE constant from `BUILDING_IMAGE_MODEL` — not a re-export of it — on
// purpose: buildings and NPC sprites are different recipes (`npc-sprite-
// pipeline.ts`'s header spells out why: a building init is grey massing the
// model must invent a surface for, an NPC init is finished pixel art being
// redressed) that will get re-tuned independently once each has real
// generations to measure. Bumping one must never silently move the other.
//
// The VALUE is the same model, though: qwen-image-edit-2511 on Replicate is
// the only img2img editor this repo has actually measured (the structure-
// adherence pilot behind `BUILDING_IMAGE_MODEL`'s choice, 2026-07-11 — silhouette
// IoU 0.974–0.994 vs FLUX.2 Klein's 0.80 baseline), and NPC sprites lean on
// that same adherence property even harder (`NPC_MIN_SILHOUETTE_IOU` is set
// ABOVE the building gate). There is no NPC-specific pilot yet to justify a
// different model.
export const NPC_IMAGE_MODEL = 'qwen/qwen-image-edit-2511';
