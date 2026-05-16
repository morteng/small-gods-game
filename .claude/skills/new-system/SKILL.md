---
name: new-system
description: Scaffold a new game system module with types and tests
disable-model-invocation: true
---

Scaffold system: $ARGUMENTS

## Steps

1. Read existing system patterns for reference:
   - `src/sim/npc-sim.ts` — tick-based sim module pattern
   - `src/sim/divine-actions.ts` — action module with constants + pure functions
   - `src/core/types.ts` — type definition patterns

2. Create `src/sim/<name>.ts`:
   - Export constants at top (costs, rates, thresholds)
   - Export pure functions that take state + return new state (or mutate + return)
   - Use `clamp01()` from `npc-sim.ts` for bounded values
   - Use typed parameters from `src/core/types.ts`

3. Add types to `src/core/types.ts`:
   - Follow existing patterns (interfaces for state, union types for enums)
   - Add to existing type groups (NPC types near NPC types, etc.)

4. Create `tests/unit/<name>.test.ts`:
   - Use `describe`/`it`/`expect` from vitest
   - Use `@/` import aliases
   - Test determinism, boundaries, and edge cases

5. Run `npm test` to verify everything compiles and passes
