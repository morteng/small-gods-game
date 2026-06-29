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
 * SCOPE (L2a): derived the VERTICAL massing (plan/levels/jetty/storeyM) and KEPT the
 * authored footprint + roof, so placement stayed fixed (ART-recipe change only).
 *
 * L2b (this slice): the body's PLAN LENGTH now varies per instance too — the "infinite
 * variety" half. A program's `sizeBays` range is a real architectural fact (a cottage is
 * 1–2 bays, a tavern 2–3); we pick a bay count from the seed and size the body's run to it,
 * CLAMPED to the authored footprint so the lot — and therefore placement — is unchanged.
 * So two cottages on a street now read as a short single-bay cot and a longer two-bay one,
 * not clones, while the settlement layout stays byte-stable. (The generative catalogue→
 * geometry bridge, `from-building-type.ts`, already grows the FOOTPRINT itself from the same
 * bay pick for unpinned types; here we vary the body WITHIN a pinned lot.) Depth/frontage
 * and roof stay authored. Per-instance variety only appears once the placer threads a
 * per-instance seed (building-placer.ts) — with a name-derived seed every instance still
 * matches, so goldens move once, deterministically.
 */
import type { Blueprint, BlueprintPatch } from '../types';
import type { Connectome, ExpandCtx } from './types';
import type { BuildingTypeFields } from '@/catalogue/types';

/** The part tag a preset sets to opt a body into graph-derived massing. */
export const GEN_FORM_TAG = 'gen-form';

/**
 * The body's plan length (tiles) the program's bay range implies for this seed, or
 * `undefined` to keep the authored size. A bay is one structural module; we pick a count in
 * `[lo, hi]` from the seed and map it to `bays + 1` tiles, clamped to the authored footprint
 * width (so the LOT is unchanged) with a floor of 2. Only linear/hall ranges vary — a
 * vertical-stack tower keeps its compact authored plan (its variety is in the storeys), and
 * a type with no bay range (`hi <= lo`) or no catalogue entry is left as authored.
 */
function deriveBodyLength(con: Connectome, base: Blueprint, ctx: ExpandCtx): number | undefined {
  if (con.source?.topology === 'vertical-stack') return undefined;
  const type = con.source?.type;
  if (!type) return undefined;
  const bt = ctx.registry.get<BuildingTypeFields>('buildingType', type)?.fields;
  if (!bt?.sizeBays) return undefined;
  const [lo, hi] = bt.sizeBays;
  if (hi <= lo) return undefined; // no range → no variety
  const bays = lo + (ctx.seed % (hi - lo + 1)); // deterministic pick in [lo, hi]
  return Math.min(base.footprint.w, Math.max(2, bays + 1));
}

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

  const bodyLen = deriveBodyLength(con, base, _ctx);

  const parts: Record<string, {
    type: string; params: Record<string, number | string>; size?: { w: number; h: number };
  }> = {};
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

    // L2b: size the body's plan run to the seeded bay count, keeping the authored depth
    // (so frontage + the door's facing row are preserved) and never exceeding the lot.
    if (bodyLen !== undefined && bodyLen !== p.size?.w) {
      parts[pid] = {
        type: 'body', params,
        size: { w: bodyLen, h: p.size?.h ?? base.footprint.h },
      };
    } else {
      parts[pid] = { type: 'body', params };
    }
  }
  return Object.keys(parts).length ? { parts } : {};
}
