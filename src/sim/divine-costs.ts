/**
 * Belief-power costs for the divine actions — a LEAF module: it imports nothing,
 * and nothing it exports has behaviour.
 *
 * Why these live apart from `divine-actions.ts`, which is where you would look
 * for them: they were the load-bearing edge of an import cycle.
 *
 *     sim/lord ──> sim/rival-claims ──> sim/divine-actions ──> sim/lord
 *
 * `rival-claims` wanted exactly one thing from `divine-actions` — the number
 * `ANSWER_PRAYER_COST`, to price a rival's claim on an unanswered prayer at the
 * same rate the player pays. `divine-actions` in turn needs the lord/peace
 * helpers, and `lord` needs `prayerAge` from `rival-claims`. The loop closed.
 *
 * ESM tolerates that as long as every cyclic binding is read INSIDE a function
 * (it was), but it is a trap: the day someone reads one at module scope, they
 * get a TDZ error whose stack points nowhere near the cycle. Pulling the pure
 * numbers down here cuts the edge instead of documenting the hazard.
 *
 * `divine-actions.ts` re-exports all seven, so `from '@/sim/divine-actions'`
 * still works and no call site had to move.
 *
 * A god's belief-power is belief × understanding × devotion, so these are prices
 * in accumulated faith — the ladder from a whisper (cheap, private, deniable) to
 * a storm (ruinous, public, unmistakable) IS the progression curve. Retuning
 * them is a balance change; see docs/VISION.md.
 */

export const WHISPER_COST = 1;
export const OMEN_COST = 3;
export const DREAM_COST = 4;
export const MIRACLE_COST = 10;
export const ANSWER_PRAYER_COST = 2;
export const SMITE_COST = 8;
export const SUMMON_STORM_COST = 12;
