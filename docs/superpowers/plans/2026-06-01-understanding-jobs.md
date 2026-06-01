# Make `understanding` Matter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `understanding` belief dimension two real gameplay jobs — gating sign-perception and prayer efficacy — beyond the power multiplier it already feeds.

**Architecture:** A single pure `signResponse(understanding)` comprehension multiplier (0.5 floor → 1.0 ceiling) scales how strongly divine signals land on an NPC, applied at three divine-action touch-points (omen, whisper, answerPrayer). Separately, the `PerceptionSystem` realization radius gains an additive understanding term via a new pure `perceptionReach(faith, understanding)` helper. No sim-state shape changes; all four touch-points are existing functions.

**Tech Stack:** TypeScript (ES modules, `@/` path alias → `src/`), Vitest. Run a single test file with `npx vitest run <path>`.

**Spec:** `docs/superpowers/specs/2026-06-01-understanding-jobs-design.md`

**Conventions observed in this codebase:**
- `clamp01(v)` is exported from `src/sim/npc-sim.ts:36`.
- Belief shape: `{ faith: number; understanding: number; devotion: number }` keyed by spirit id under `npcProps(e).beliefs[spiritId]`.
- `initNpcProps(name, role, seed)` seeds `beliefs.player = { faith: <role-based>, understanding: 0.1, devotion: 0.05 }`.
- Tests use `npx vitest run` (not pytest). Float assertions use `toBeCloseTo(value, 5)`.
- Commit trailer required on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: `signResponse` comprehension multiplier

**Files:**
- Modify: `src/sim/npc-sim.ts` (add export near `clamp01` at line 36)
- Test: `tests/unit/belief-math.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/belief-math.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signResponse, SIGN_RESPONSE_FLOOR } from '@/sim/npc-sim';

describe('signResponse', () => {
  it('floors at understanding=0', () => {
    expect(signResponse(0)).toBeCloseTo(0.5, 5);
    expect(SIGN_RESPONSE_FLOOR).toBe(0.5);
  });

  it('reaches 1.0 at understanding=1', () => {
    expect(signResponse(1)).toBeCloseTo(1.0, 5);
  });

  it('is linear in between', () => {
    expect(signResponse(0.2)).toBeCloseTo(0.6, 5);
    expect(signResponse(0.5)).toBeCloseTo(0.75, 5);
  });

  it('clamps out-of-range input', () => {
    expect(signResponse(-1)).toBeCloseTo(0.5, 5);
    expect(signResponse(2)).toBeCloseTo(1.0, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/belief-math.test.ts`
Expected: FAIL — `signResponse`/`SIGN_RESPONSE_FLOOR` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/sim/npc-sim.ts`, immediately after the `clamp01` function (line 36-38), add:

```ts
/** Fraction of a divine signal's effect an NPC absorbs, gated by understanding.
 *  understanding=0 → SIGN_RESPONSE_FLOOR; understanding=1 → 1.0. */
export const SIGN_RESPONSE_FLOOR = 0.5;
export function signResponse(understanding: number): number {
  const u = clamp01(understanding);
  return SIGN_RESPONSE_FLOOR + (1 - SIGN_RESPONSE_FLOOR) * u;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/belief-math.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/npc-sim.ts tests/unit/belief-math.test.ts
git commit -m "feat(belief): signResponse comprehension multiplier (0.5 floor)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Perception reach gains an understanding term

**Files:**
- Modify: `src/world/perception-system.ts:6-7` (constants), `:29-34` (reach computation)
- Test: `tests/unit/perception-system.test.ts` (add cases to existing file)

- [ ] **Step 1: Write the failing test**

Add to the top of `tests/unit/perception-system.test.ts` (after the existing imports, add `perceptionReach` to the import from `@/world/perception-system`):

Change the existing import line
```ts
import { PerceptionSystem } from '@/world/perception-system';
```
to
```ts
import { PerceptionSystem, perceptionReach } from '@/world/perception-system';
```

Then add this describe block at the end of the file:

```ts
describe('perceptionReach', () => {
  it('opens a base bubble even at zero faith and understanding', () => {
    expect(perceptionReach(0, 0)).toBe(3);
  });

  it('faith is the primary driver (+4 at full faith)', () => {
    expect(perceptionReach(1, 0)).toBe(7);
  });

  it('understanding extends reach secondarily (+2 at full understanding)', () => {
    expect(perceptionReach(0, 1)).toBe(5);
    expect(perceptionReach(1, 1)).toBe(9);
  });

  it('combines both, flooring the sum', () => {
    expect(perceptionReach(0.5, 0.5)).toBe(6); // 3 + floor(2 + 1)
  });
});

describe('PerceptionSystem understanding reach', () => {
  it('realizes more tiles when the dominant belief has higher understanding', () => {
    // setup() adds the entity to the world by reference, so mutating .beliefs
    // in place updates the same object the world holds — do NOT reassign .properties.
    const lowU = setup(0.5);
    (lowU.e.properties as any).beliefs = { player: { faith: 0.5, understanding: 0.0, devotion: 0 } };
    const highU = setup(0.5);
    (highU.e.properties as any).beliefs = { player: { faith: 0.5, understanding: 1.0, devotion: 0 } };

    const sysLow = new PerceptionSystem(identityOracle, () => lowU.map);
    const sysHigh = new PerceptionSystem(identityOracle, () => highU.map);
    sysLow.tick({ world: lowU.world, log: lowU.log, clock: new SimClock(), spirits: new Map(), rng: createRng(0), dt: 500, now: 1 });
    sysHigh.tick({ world: highU.world, log: highU.log, clock: new SimClock(), spirits: new Map(), rng: createRng(0), dt: 500, now: 1 });

    const countLow = lowU.map.tiles.flat().filter(t => t.state === 'realized').length;
    const countHigh = highU.map.tiles.flat().filter(t => t.state === 'realized').length;
    expect(countHigh).toBeGreaterThan(countLow);
  });
});
```

Note: the existing `setup()` helper builds the NPC via `initNpcProps` and adds it to `world` before returning, so overwriting `beliefs` on the returned `e.properties` after `setup()` mutates the same object the world holds (entities are stored by reference). No re-add needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/perception-system.test.ts`
Expected: FAIL — `perceptionReach` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/world/perception-system.ts`, replace the two module constants (lines 6-7):

```ts
const BASE_RADIUS = 3;
const MAX_FAITH_BONUS = 4;
```

with:

```ts
export const BASE_RADIUS = 3;
export const FAITH_BONUS = 4;
export const UNDERSTANDING_BONUS = 2;

/** Tile-realization radius for a believer. Faith is primary (+4), understanding
 *  secondary (+2); BASE_RADIUS guarantees the cradle opens at understanding≈0. */
export function perceptionReach(faith: number, understanding: number): number {
  return BASE_RADIUS + Math.floor(faith * FAITH_BONUS + understanding * UNDERSTANDING_BONUS);
}
```

Then replace the reach computation in `tick` (currently lines 29-34):

```ts
      let bestFaith = 0;
      for (const b of Object.values(p.beliefs)) {
        if (b.faith > bestFaith) bestFaith = b.faith;
      }
      const r = BASE_RADIUS + Math.floor(bestFaith * MAX_FAITH_BONUS);
```

with (dominant belief = the per-spirit entry with the highest faith; read its own understanding):

```ts
      let domFaith = 0;
      let domUnderstanding = 0;
      for (const b of Object.values(p.beliefs)) {
        if (b.faith > domFaith) {
          domFaith = b.faith;
          domUnderstanding = b.understanding;
        }
      }
      const r = perceptionReach(domFaith, domUnderstanding);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/perception-system.test.ts`
Expected: PASS (existing cases + 5 new). The existing "bubble radius grows with faith" case still holds (both NPCs share understanding=0.1, so faith alone differentiates them).

- [ ] **Step 5: Commit**

```bash
git add src/world/perception-system.ts tests/unit/perception-system.test.ts
git commit -m "feat(perception): understanding extends realization reach (+2 at full)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Omen faith boost scales with each witness's understanding

**Files:**
- Modify: `src/sim/divine-actions.ts:4` (import), `:73-81` (omen loop)
- Test: `tests/unit/dilemma-divine-actions.test.ts` (add omen describe block + imports)

- [ ] **Step 1: Write the failing test**

In `tests/unit/dilemma-divine-actions.test.ts`, extend the imports:

Change
```ts
import { answerPrayer, dream } from '@/sim/divine-actions';
```
to
```ts
import { answerPrayer, dream, whisper, omen } from '@/sim/divine-actions';
import { World } from '@/world/world';
import type { GameMap } from '@/core/types';
```

Add a minimal map factory + this describe block at the end of the file:

```ts
function tinyMap(): GameMap {
  const tiles = [] as GameMap['tiles'];
  for (let y = 0; y < 3; y++) {
    const row = [];
    for (let x = 0; x < 3; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' as const });
    tiles.push(row);
  }
  return { tiles, width: 3, height: 3, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function worldNpc(id: string, poiId: string, belief: { faith: number; understanding: number; devotion: number }): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.homePoiId = poiId;
  p.beliefs['player'] = belief;
  return { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
}

describe('Omen', () => {
  it('boosts faith proportional to each witness understanding', () => {
    const world = new World(tinyMap());
    const dull = worldNpc('dull', 'poi1', { faith: 0.3, understanding: 0.0, devotion: 0 });
    const wise = worldNpc('wise', 'poi1', { faith: 0.3, understanding: 1.0, devotion: 0 });
    world.addEntity(dull);
    world.addEntity(wise);

    omen(spirit(), 'poi1', world, log());

    // OMEN_FAITH_BOOST=0.08; signResponse(0)=0.5 → +0.04; signResponse(1)=1.0 → +0.08
    expect(P(dull).beliefs['player'].faith).toBeCloseTo(0.34, 5);
    expect(P(wise).beliefs['player'].faith).toBeCloseTo(0.38, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dilemma-divine-actions.test.ts`
Expected: FAIL — `wise` faith comes back 0.38 only after the change; before it, both gain a flat 0.08 (dull → 0.38, mismatching the expected 0.34).

- [ ] **Step 3: Write minimal implementation**

In `src/sim/divine-actions.ts`, extend the import on line 5:

Change
```ts
import { clamp01 } from '@/sim/npc-sim';
```
to
```ts
import { clamp01, signResponse } from '@/sim/npc-sim';
```

Then in `omen()`, replace the per-witness boost (currently line 78):

```ts
      existing.faith = clamp01(existing.faith + OMEN_FAITH_BOOST);
```

with:

```ts
      existing.faith = clamp01(existing.faith + OMEN_FAITH_BOOST * signResponse(existing.understanding));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/dilemma-divine-actions.test.ts`
Expected: PASS (Omen block + existing Answer/Deepen blocks unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/sim/divine-actions.ts tests/unit/dilemma-divine-actions.test.ts
git commit -m "feat(omen): faith boost scales with witness understanding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Whisper faith gain scales with understanding (understanding gain stays flat)

**Files:**
- Modify: `src/sim/divine-actions.ts:46-56` (whisper belief update)
- Test: `tests/unit/dilemma-divine-actions.test.ts` (add Whisper describe block)

- [ ] **Step 1: Write the failing test**

Add this describe block at the end of `tests/unit/dilemma-divine-actions.test.ts` (imports for `whisper` were added in Task 3):

```ts
describe('Whisper', () => {
  it('scales faith gain by understanding but raises understanding flatly', () => {
    const e = npc((p) => {
      p.whisperCooldown = 0;
      p.beliefs['player'] = { faith: 0.3, understanding: 0.2, devotion: 0.1 };
    });
    whisper(spirit(), e, log());
    // WHISPER_FAITH_BOOST=0.15; signResponse(0.2)=0.6 → +0.09 → 0.39
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.39, 5);
    // WHISPER_UNDERSTANDING_BOOST=0.03, ungated → 0.23
    expect(P(e).beliefs['player'].understanding).toBeCloseTo(0.23, 5);
  });

  it('bootstraps a new believer at the floor response', () => {
    const e = npc((p) => {
      p.whisperCooldown = 0;
      delete (p.beliefs as Record<string, unknown>)['player'];
    });
    whisper(spirit(), e, log());
    // new believer: faith = 0.15 * signResponse(0) = 0.075; understanding = 0.03
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.075, 5);
    expect(P(e).beliefs['player'].understanding).toBeCloseTo(0.03, 5);
    expect(P(e).beliefs['player'].devotion).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dilemma-divine-actions.test.ts`
Expected: FAIL — current whisper adds a flat 0.15 (existing → 0.45, new → 0.15), mismatching 0.39 / 0.075.

- [ ] **Step 3: Write minimal implementation**

In `src/sim/divine-actions.ts`, replace the whisper belief update (currently lines 46-56):

```ts
  const existing = p.beliefs[spirit.id];
  if (existing) {
    existing.faith = clamp01(existing.faith + WHISPER_FAITH_BOOST);
    existing.understanding = clamp01(existing.understanding + WHISPER_UNDERSTANDING_BOOST);
  } else {
    p.beliefs[spirit.id] = {
      faith: WHISPER_FAITH_BOOST,
      understanding: WHISPER_UNDERSTANDING_BOOST,
      devotion: 0,
    };
  }
```

with (faith scaled by understanding *before* the understanding increment; new believer uses `signResponse(0)`):

```ts
  const existing = p.beliefs[spirit.id];
  if (existing) {
    existing.faith = clamp01(existing.faith + WHISPER_FAITH_BOOST * signResponse(existing.understanding));
    existing.understanding = clamp01(existing.understanding + WHISPER_UNDERSTANDING_BOOST);
  } else {
    p.beliefs[spirit.id] = {
      faith: WHISPER_FAITH_BOOST * signResponse(0),
      understanding: WHISPER_UNDERSTANDING_BOOST,
      devotion: 0,
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/dilemma-divine-actions.test.ts`
Expected: PASS (Whisper block + all prior blocks).

- [ ] **Step 5: Commit**

```bash
git add src/sim/divine-actions.ts tests/unit/dilemma-divine-actions.test.ts
git commit -m "feat(whisper): faith gain scales with understanding; teaching stays flat

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Answer Prayer — faith gain scales with understanding + a successful answer nudges understanding

**Files:**
- Modify: `src/sim/divine-actions.ts:33-35` (add constant), `:213-226` (answerPrayer belief update)
- Test: `tests/unit/dilemma-divine-actions.test.ts` (update the two existing Answer assertions)

- [ ] **Step 1: Update the failing tests**

In `tests/unit/dilemma-divine-actions.test.ts`, update the existing `describe('Answer', ...)` block's first two cases to the new scaled expectations.

In the first case (`restores meaning, raises faith, and exits worship`), replace:
```ts
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.5, 5);
    expect(P(e).beliefs['player'].devotion).toBeCloseTo(0.2, 5); // unchanged — Deepen owns devotion
```
with:
```ts
    // ANSWER_PRAYER_FAITH_BOOST=0.2; signResponse(0.2)=0.6 → +0.12 → 0.42
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.42, 5);
    // a successful answer nudges understanding up by 0.04 → 0.24
    expect(P(e).beliefs['player'].understanding).toBeCloseTo(0.24, 5);
    expect(P(e).beliefs['player'].devotion).toBeCloseTo(0.2, 5); // unchanged — Deepen owns devotion
```
(`needs.meaning` still asserts `0.4` — unchanged. Leave that line as-is.)

In the second case (`recruits a non-believer who is praying`), replace:
```ts
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.2, 5);
    expect(P(e).beliefs['player'].devotion).toBe(0);
```
with:
```ts
    // recruit: faith = 0.2 * signResponse(0) = 0.1; understanding seeded at 0.04
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.1, 5);
    expect(P(e).beliefs['player'].understanding).toBeCloseTo(0.04, 5);
    expect(P(e).beliefs['player'].devotion).toBe(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dilemma-divine-actions.test.ts`
Expected: FAIL — current answerPrayer adds a flat 0.2 faith (→0.5 / →0.2) and never touches understanding.

- [ ] **Step 3: Write minimal implementation**

In `src/sim/divine-actions.ts`, add a constant beside the other Answer-Prayer magnitudes (after line 35, `ANSWER_PRAYER_MEANING_BOOST`):

```ts
const ANSWER_UNDERSTANDING_BOOST = 0.04; // a heard prayer teaches a little of your form
```

Then replace the belief update in `answerPrayer()` (currently lines 214-223):

```ts
  const existing = p.beliefs[spirit.id];
  if (existing) {
    existing.faith = clamp01(existing.faith + ANSWER_PRAYER_FAITH_BOOST);
  } else {
    p.beliefs[spirit.id] = {
      faith: ANSWER_PRAYER_FAITH_BOOST,
      understanding: 0,
      devotion: 0,
    };
  }
```

with:

```ts
  const existing = p.beliefs[spirit.id];
  if (existing) {
    existing.faith = clamp01(existing.faith + ANSWER_PRAYER_FAITH_BOOST * signResponse(existing.understanding));
    existing.understanding = clamp01(existing.understanding + ANSWER_UNDERSTANDING_BOOST);
  } else {
    p.beliefs[spirit.id] = {
      faith: ANSWER_PRAYER_FAITH_BOOST * signResponse(0),
      understanding: ANSWER_UNDERSTANDING_BOOST,
      devotion: 0,
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/dilemma-divine-actions.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: All tests pass (~825+, including the 4 new belief-math + perception + divine-action additions). If any other test asserted the old flat whisper/omen/answer deltas, update it to the scaled value per the formulas above.

- [ ] **Step 6: Commit**

```bash
git add src/sim/divine-actions.ts tests/unit/dilemma-divine-actions.test.ts
git commit -m "feat(answer): faith gain scales with understanding; answer nudges understanding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run `npx vitest run` — full suite green.
- [ ] Run `npm run build` — TypeScript check passes (no unused-import or type errors from the rename `MAX_FAITH_BONUS`→`FAITH_BONUS`; grep first: `git grep -n MAX_FAITH_BONUS` should return nothing).
- [ ] Spot-check VISION alignment: understanding now gates sign-perception (omen/whisper/realization reach) and prayer efficacy (answerPrayer), matching VISION §3 line 118. The third job (pass-on-accurate / misattribution) remains deferred to Tracks 2–3 — confirm `belief-propagation-system.ts` was NOT touched.
