/**
 * Layer 1 — STRUCTURE. The construction axis of the layered connectome: a building's
 * load system (frameType) selected from its wall material + era/region, annotated onto
 * the graph, then GATING the form. Content-free — it reads catalogue frameType facts and
 * generic blueprint geometry (part params, wall material); it names no frame/material id.
 *
 * Two halves, mirroring the connectome→blueprint precedent (smoke.ts / openings.ts):
 *   • selectFrame / annotateStructure — pure graph annotation (which frame, what limits);
 *   • connectomeStructure — projects the frame's limits DOWN onto the body parts as a
 *     BlueprintPatch (cap the jetty — a timber-frame trick a solid wall can't do — and the
 *     storeys the frame bears).
 *
 * "Load-bearing" only becomes a real, queryable concept once the frame is annotated here;
 * the structure-gated hearth (a wall-chimney needs a mass wall), cellars (`level:-1`
 * zones) and bay-aware door/partition placement all read off this annotation downstream.
 *
 * Deterministic: (wall material, era, region, explicit hint) → a fixed frame.
 */
import type { BuildingTypeFields, FrameTypeFields } from '@/catalogue/types';
import { appliesTo } from '@/catalogue/registry';
import type { Blueprint, BlueprintPatch } from '../types';
import type { Connectome, ExpandCtx } from './types';

/** The frame an annotated connectome carries — the structure subsystem's output. */
export interface ConnectomeStructure {
  frame: string; // chosen frameType id
  maxStoreys?: number;
  jettyMax?: number;
  bayModule?: number;
  fenestration?: { maxPerFace?: number; spacing?: number };
}

/**
 * Choose a frameType. An explicit hint (the buildingType's `frame`, or a culture override)
 * wins when it resolves; else the frame is DERIVED — score every applicable frame by wall-
 * material affinity (dominant) + a region nudge, with a deterministic tie-break (shortest
 * id, then alphabetical). Returns '' when the pack declares no frame.
 */
export function selectFrame(
  wallMaterial: string | undefined,
  ctx: Pick<ExpandCtx, 'era' | 'region' | 'wealth' | 'registry'>,
  explicit?: string,
): string {
  const reg = ctx.registry;
  if (explicit && reg.get<FrameTypeFields>('frameType', explicit)) return explicit;
  const frames = reg.all<FrameTypeFields>('frameType').filter((fr) => appliesTo(fr, ctx));
  if (!frames.length) return '';
  const score = (fr: { fields: FrameTypeFields }): number => {
    let s = 0;
    if (wallMaterial && fr.fields.wallAffinity?.includes(wallMaterial)) s += 4;
    if (ctx.region && fr.fields.regionAffinity?.includes(ctx.region)) s += 2;
    return s;
  };
  return [...frames].sort(
    (a, b) => score(b) - score(a) || a.id.length - b.id.length || a.id.localeCompare(b.id),
  )[0].id;
}

/**
 * Annotate the building connectome with its structure: read the buildingType's frame hint
 * (if any), select a frame from the blueprint's wall material, and copy the frame's load
 * limits onto `con.structure`. Pure — returns a new connectome (unchanged if no frame
 * resolves).
 */
export function annotateStructure(con: Connectome, base: Blueprint, ctx: ExpandCtx): Connectome {
  const bt = con.source?.type
    ? ctx.registry.get<BuildingTypeFields>('buildingType', con.source.type)
    : undefined;
  const frameId = selectFrame(base.materials?.walls, ctx, bt?.fields.frame);
  const frame = frameId ? ctx.registry.get<FrameTypeFields>('frameType', frameId) : undefined;
  if (!frame) return con;
  const structure: ConnectomeStructure = {
    frame: frameId,
    ...(frame.fields.maxStoreys !== undefined ? { maxStoreys: frame.fields.maxStoreys } : {}),
    ...(frame.fields.jettyMax !== undefined ? { jettyMax: frame.fields.jettyMax } : {}),
    ...(frame.fields.bayModule !== undefined ? { bayModule: frame.fields.bayModule } : {}),
    ...(frame.fields.fenestration ? { fenestration: frame.fields.fenestration } : {}),
  };
  return { ...con, structure };
}

/**
 * Project the annotated structure DOWN onto the body parts: a frame caps how far the upper
 * storeys jetty (0 for a solid/cruck/stave wall — a timber-frame trick only) and how many
 * storeys it bears. Emits a BlueprintPatch lowering ONLY the parts that exceed the frame's
 * limits, so a building already within its frame stays byte-identical. `{}` when nothing is
 * capped (or no structure is annotated).
 */
export function connectomeStructure(con: Connectome, base: Blueprint): BlueprintPatch {
  const st = con.structure;
  if (!st) return {};
  const jettyMax = st.jettyMax ?? Infinity;
  const maxStoreys = st.maxStoreys ?? Infinity;
  const parts: Record<string, { type: string; params: Record<string, number> }> = {};
  for (const [pid, p] of Object.entries(base.parts)) {
    if (p.type !== 'body' && p.type !== 'wing') continue;
    const params: Record<string, number> = {};
    const jetty = (p.params?.jetty as number) ?? 0;
    if (jetty > jettyMax) params.jetty = jettyMax;
    const levels = (p.params?.levels as number) ?? 1;
    if (levels > maxStoreys) params.levels = maxStoreys;
    if (Object.keys(params).length) parts[pid] = { type: p.type, params };
  }
  return Object.keys(parts).length ? { parts } : {};
}
