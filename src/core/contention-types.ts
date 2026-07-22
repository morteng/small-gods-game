// The rival-contention ladder's one shared type — a settlement's escalation
// state as two gods contest its congregation. Deliberately dependency-free so
// BOTH the core event union (`@/core/events`) and the sim escalation model
// (`@/sim/rival-contention`) can import it type-only without a core→sim edge.
//
// Ladder order (calm < tension < schism < holy_war): a settlement climbs one
// rung at a time as two near-even, populous cults heat up, and eases back the
// same way. See `@/sim/rival-contention` for the heat integration + hysteresis.
export type ContentionState = 'calm' | 'tension' | 'schism' | 'holy_war';
