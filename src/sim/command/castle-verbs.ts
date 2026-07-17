/**
 * castle-verbs.ts — the `found_castle` authoring verb (mortal power M4 S4).
 *
 * TIER RESOLUTION (documented per the spike): this is MORTAL power made
 * concrete — the settlement's seated LORD founds the castle; a god cannot buy
 * one with belief-power (VISION tenet 9: "mortals act first; the god is the
 * margin", and the M3 rule that a lord never enters the belief table). So the
 * verb is AUTHORING-tier, exactly like `set_lord_stance`: the sim's mortal
 * actor supplies the act, Fate/dev coaching supplies the trigger. It never
 * appears on the player's divine affordance surfaces (those derive from
 * `tier === 'divine'` only).
 *
 * Effect: choose a defensible site near the lord's settlement
 * (`chooseCastleSite` — a deterministic candidate lattice scored by
 * `siteSelect` + `DEFENSIVE_SITE_WEIGHTS`, the spike's "feed it N hilltops"),
 * found the castle through the ONE game-path creator (`foundCastle`: runtime
 * POI + ownership-tagged stamp + directory projection — fully scrub-safe), then
 * REHOME the lord and up to `GARRISON_SOLDIERS` of his soldiers there
 * (`homePoiId` = castle id — S3 proved events/seat/Fate-guard adopt them
 * automatically; movement walks them to their new home, no teleport).
 *
 * One castle per seat: provenance `foundedFromPoiId` gates a second foundation
 * from the same settlement. Rejections leave NO partial state (`foundCastle`
 * rolls back a failed siting; a null site declines before any commit).
 *
 * Deterministic: all randomness through ctx.rng; candidate lattice + garrison
 * selection are fixed deterministic orders, so replay from a snapshot rebuilds
 * the identical castle.
 */
import type { Command, ApplyCtx, CommandCtx, RejectionReason } from './types';
import { foundCastle, chooseCastleSite } from '@/world/found-castle';
import { resolveSettlementEra } from '@/core/era';
import { queryNpcs, npcProps, getNpc } from '@/world/npc-helpers';
import { findPlacement } from './editor-verbs';

/** Soldiers rehomed to the new castle alongside the lord (fewer if the
 *  settlement has fewer — an honest headcount, never spawned from nothing). */
export const GARRISON_SOLDIERS = 4;

const P = (cmd: Command): Record<string, unknown> => cmd.payload ?? {};

function poiOf(cmd: Command): string | undefined {
  return cmd.target.kind === 'settlement' ? cmd.target.poiId : undefined;
}

/** The founding settlement's directory entry (the map's worldSeed clone — the
 *  projection keeps both clones in agreement, so either is authoritative). */
function foundingPoi(poiId: string, ctx: CommandCtx) {
  return ctx.world.tiles.worldSeed?.pois?.find(p => p.id === poiId);
}

/** True when this seat already founded a castle (one castle per seat). */
function seatHasCastle(poiId: string, ctx: CommandCtx): boolean {
  const store = ctx.state?.runtimePois;
  if (!store) return false;
  return store.all().some(e => e.provenance.foundedFromPoiId === poiId);
}

export function foundCastlePrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const poiId = poiOf(cmd);
  if (!poiId) return 'invalid_target';
  if (!ctx.world.lords.get(poiId)) return 'invalid_target';   // mortal power: only a seated lord builds
  const poi = foundingPoi(poiId, ctx);
  if (!poi?.position) return 'invalid_target';                // no anchor to site from
  const name = P(cmd).name;
  if (name !== undefined && (typeof name !== 'string' || !name)) return 'invalid_payload';
  const complexTypeId = P(cmd).complexTypeId;
  if (complexTypeId !== undefined && (typeof complexTypeId !== 'string' || !complexTypeId)) return 'invalid_payload';
  // State-dependent gate — preview callers without `ctx.state` skip it; the
  // apply re-checks and declines cleanly.
  if (seatHasCastle(poiId, ctx)) return 'precondition_failed';
  return null;
}

export function foundCastleApply(cmd: Command, ctx: ApplyCtx): boolean {
  const state = ctx.state;
  if (!state) return false;                                   // executor always injects it
  const poiId = poiOf(cmd)!;                                  // validated in precondition
  const seat = ctx.world.lords.get(poiId);
  const poi = foundingPoi(poiId, ctx);
  if (!seat || !poi?.position) return false;                  // lapsed/vanished after the pre-gate
  if (seatHasCastle(poiId, ctx)) return false;                // one castle per seat

  const map = ctx.world.tiles;
  const complexTypeId = (P(cmd).complexTypeId as string | undefined) ?? 'motte_and_bailey';
  const site = chooseCastleSite(map, poi.position, {
    complexTypeId, seed: ctx.rng.nextInt(0x7fffffff),
  });
  if (!site) return false;                                    // no viable ground — clean decline

  const res = foundCastle(ctx.world, map, state, {
    centre: site,
    seed: ctx.rng.nextInt(0x7fffffff),
    era: resolveSettlementEra(poi, map.worldSeed),
    complexTypeId,
    name: P(cmd).name as string | undefined,
    cause: `lord:${seat.npcId}`,
    foundedFromPoiId: poiId,
  });
  if (!res) return false;                                     // siting rejected — foundCastle rolled back

  // Garrison: the lord + up to GARRISON_SOLDIERS resident soldiers move their
  // household to the castle (homePoiId flips — S3's proven adoption seam).
  // Sorted ids so replay rehomes the same men; movement walks them there.
  const spot = findPlacement(ctx.world, site.x, site.y) ?? site;
  const rehome = (id: string): void => {
    const e = getNpc(ctx.world, id);
    if (!e) return;
    const p = npcProps(e);
    p.homePoiId = res.poiId;
    p.homeX = spot.x; p.homeY = spot.y;
  };
  rehome(seat.npcId);
  const soldiers = queryNpcs(ctx.world)
    .filter(e => { const p = npcProps(e); return p.role === 'soldier' && p.homePoiId === poiId; })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, GARRISON_SOLDIERS);
  for (const s of soldiers) rehome(s.id);

  ctx.log.append({
    type: 'castle_founded',
    poiId: res.poiId, fromPoiId: poiId, lordNpcId: seat.npcId, name: res.poi.name ?? res.poiId,
  });
  return true;
}
