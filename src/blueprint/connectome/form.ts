/**
 * Layer 2 — FORM. The architecture axis: a building's MASSING — how many storeys it stacks,
 * whether the upper floor oversails (jetty), how tall a storey, the plan — DERIVED from its
 * program (topology + room graph) and its structure (the frame's load limits) instead of
 * hand-listed per preset. The headline: the SAME program reads differently through a
 * different frame — a box-frame dwelling stacks a jettied upper storey, a cruck one stays a
 * single low range — so form follows construction, not a magic number.
 *
 * Opt-in via a `gen-form` tag on the body part (mirrors `gen-openings`); a preset that
 * hasn't opted in keeps its authored massing. The derivation respects `con.structure`'s
 * caps, so it can never out-build its frame. Content-free + deterministic.
 *
 * SCOPE (L2a): derives the VERTICAL massing (plan/levels/jetty/storeyM) and KEEPS the
 * authored footprint + roof, so placement is unchanged (ART-recipe change only). Footprint/
 * bay variety + per-instance seed variation is L2b (it shifts placement → a WORLD bump).
 */
import type { Blueprint, BlueprintPatch } from '../types';
import type { Connectome, ExpandCtx } from './types';

/** The part tag a preset sets to opt a body into graph-derived massing. */
export const GEN_FORM_TAG = 'gen-form';

/**
 * Derive the body-massing patch the program + structure imply for each `gen-form` body.
 * Returns `{}` for a blueprint that hasn't opted in. Keeps the authored footprint/roof.
 */
export function connectomeForm(con: Connectome, base: Blueprint, _ctx: ExpandCtx): BlueprintPatch {
  const st = con.structure;
  const topo = con.source?.topology;
  const rooms = con.zones.length;
  const sacred = topo === 'church-axial' || con.zones.some((z) => z.fn === 'worship');
  const maxStoreys = st?.maxStoreys ?? Infinity;
  const jettyMax = st?.jettyMax ?? 0;

  const parts: Record<string, { type: string; params: Record<string, number | string> }> = {};
  for (const [pid, p] of Object.entries(base.parts)) {
    if (p.type !== 'body' || !p.tags?.includes(GEN_FORM_TAG)) continue;

    // Storeys: a vertical-stack building is as tall as its stacked zones; a hall-type
    // dwelling stacks a second storey only when its FRAME bears it (a jetty-capable box
    // frame) and it has more than one room to put up there. Never out-build the frame.
    let levels: number;
    if (topo === 'vertical-stack') {
      levels = Math.max(1, ...con.zones.map((z, i) => (z.level ?? i) + 1));
    } else {
      levels = jettyMax > 0 && rooms >= 2 ? 2 : 1;
    }
    levels = Math.min(levels, maxStoreys);

    // Jetty: the box-frame oversail — only a timber frame that stacks a storey jetties; a
    // solid/cruck/stave wall (jettyMax 0) never does. Take the frame's full structural max.
    const jetty = jettyMax > 0 && levels >= 2 ? jettyMax : 0;

    const params: Record<string, number | string> = { plan: 'rect', levels, jetty };
    // A sacred hall is built tall (the lofty nave/cella); ordinary dwellings use the
    // standard storey. Only set storeyM when we mean to override the default.
    if (sacred) params.storeyM = 4.5;
    parts[pid] = { type: 'body', params };
  }
  return Object.keys(parts).length ? { parts } : {};
}
