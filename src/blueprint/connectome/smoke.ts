/**
 * Hearth → smoke-egress derivation — THE Slice-1 payoff. A hearth fixture emits the
 * 'smoke-egress' requirement; this picks the period-and-wealth-correct egress from
 * the `smokeSystem` catalogue and attaches it to the hearth's zone. Because the
 * smokeSystem entries carry the historical era/wealth gates, the headline rule —
 * early-medieval commoners get a louver, NEVER a chimney — falls out of the DATA,
 * not hard-coded logic. (No content fixture ids appear here; the egress id is read
 * from the chosen smokeSystem. The only string is the structural topology id
 * 'vertical-stack', shared engine vocabulary like the grammar interpreters.)
 */
import type { Era, FrameTypeFields, FixtureTypeFields, SmokeSystemFields } from '@/catalogue/types';
import type { Connectome, ExpandCtx, Fixture } from './types';

const WEALTH_RANK: Record<string, number> = {
  destitute: 0, poor: 1, modest: 2, comfortable: 3, rich: 4, opulent: 5,
};

/** True if the smokeSystem's era/wealth gates admit (era, wealth). */
function admits(f: SmokeSystemFields, era: Era, wealth: string | undefined): boolean {
  if (!f.eras.includes(era)) return false;
  if (f.wealth && f.wealth.length) {
    if (!wealth) return false;
    return f.wealth.includes(wealth);
  }
  return true;
}

/** The egress fixture's placement ('wall' ⇒ a masonry flue; 'ridge' ⇒ a smokehole/louver). */
function egressPlacement(ctx: ExpandCtx, egressFixture: string): string | undefined {
  return ctx.registry.get<FixtureTypeFields>('fixtureType', egressFixture)?.fields.placement;
}

/**
 * Pick the most-advanced smokeSystem (last in catalogue order) whose gates admit the
 * context. Falls back to era-only, then to the most basic, so a hearth ALWAYS vents.
 * A masonry vertical-stack (keep/tower) is treated as at least 'rich' — that is where
 * the wall-chimney was actually born.
 *
 * STRUCTURE gates fabric (Layer 3): a wall-placement egress IS a masonry flue, so a
 * frame that cannot carry one (`flue:false` — cruck, stave) drops those candidates and
 * keeps the most-advanced ridge vent however late/rich the build. A light peasant frame
 * never grows a stone stack.
 */
function selectEgress(ctx: ExpandCtx, topology: string | undefined, flueCapable: boolean): string | undefined {
  const systems = ctx.registry.all<SmokeSystemFields>('smokeSystem');
  if (!systems.length) return undefined;

  let wealth = ctx.wealth;
  if (topology === 'vertical-stack') {
    const r = Math.max(WEALTH_RANK[wealth ?? ''] ?? 0, WEALTH_RANK.rich);
    wealth = Object.keys(WEALTH_RANK).find((w) => WEALTH_RANK[w] === r) ?? wealth;
  }

  const byGate = systems.filter((s) => admits(s.fields, ctx.era, wealth));
  const byEra = byGate.length ? byGate : systems.filter((s) => s.fields.eras.includes(ctx.era));
  let pool = byEra.length ? byEra : systems;
  // A non-flue frame cannot host a wall chimney — drop wall-placement egresses.
  if (!flueCapable) {
    const ridge = pool.filter((s) => egressPlacement(ctx, s.fields.egressFixture) !== 'wall');
    if (ridge.length) pool = ridge;
  }
  return pool[pool.length - 1]?.fields.egressFixture; // last = most advanced
}

/** Does the connectome's chosen frame carry a masonry flue? Unknown frame ⇒ yes (no constraint). */
function frameFlue(con: Connectome, ctx: ExpandCtx): boolean {
  const frame = con.structure?.frame;
  if (!frame) return true;
  return ctx.registry.get<FrameTypeFields>('frameType', frame)?.fields.flue ?? true;
}

/**
 * Returns a NEW connectome with an egress fixture attached over each hearth zone.
 * Pure + deterministic (the connectome already encodes all randomness).
 */
export function deriveSmokeEgress(con: Connectome, ctx: ExpandCtx): Connectome {
  const hearths = con.fixtures.filter((f) => f.requires?.includes('smoke-egress'));
  if (!hearths.length) return con;

  const flueCapable = frameFlue(con, ctx);
  const added: Fixture[] = [];
  hearths.forEach((hearth, i) => {
    const egressId = selectEgress(ctx, con.source?.topology, flueCapable);
    if (!egressId) return;
    const ft = ctx.registry.get<FixtureTypeFields>('fixtureType', egressId);
    added.push({
      id: `fx-egress${i}`,
      type: egressId,
      zoneId: hearth.zoneId,
      satisfies: ft?.fields.satisfies ?? ['smoke-egress'],
      ...(ft?.fields.placement ? { attrs: { placement: ft.fields.placement } } : {}),
    });
  });

  return { ...con, fixtures: [...con.fixtures, ...added] };
}
