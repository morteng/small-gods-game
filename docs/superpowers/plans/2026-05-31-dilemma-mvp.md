# Dilemma MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the secularization dilemma real and playable — answering prayers grows fickle faith but breeds comfort-decay, while Deepening builds decay-resistant devotion; neglect makes believers abandon you and leave.

**Architecture:** Pure-sim, single-god vertical slice on the existing Scheduler. Retune two existing divine actions (`answerPrayer`→Answer, `dream`→Deepen), wire three new faith forces into the 1 Hz `NpcSimSystem` path, add self-agency to `NpcActivitySystem`, add an `AbandonmentSystem` that removes faith-zero believers, seed a band of ~6 NPCs, and surface state through the existing NPC panel + HUD. A headless three-policy harness proves the dilemma.

**Tech Stack:** TypeScript (ES modules, `@/` path alias → `src/`), Vite, Vitest. Tests live under `tests/unit/` and `tests/integration/`. Run a single test file with `npx vitest run <path>`.

**Spec:** `docs/superpowers/specs/2026-05-31-dilemma-mvp-design.md`

---

## File structure

**Modify:**
- `src/sim/spirit-system.ts` — power formula `faith × (1+2u) × (1+2d)`
- `src/sim/npc-sim.ts` — comfort decay, abandonment decay, devotion resistance, faster `meaning` decay
- `src/sim/divine-actions.ts` — retune `answerPrayer` (Answer) + `dream` (Deepen)
- `src/sim/systems/npc-activity-system.ts` — self-agency: restore need on activity completion
- `src/core/events.ts` — add `believer_lost` event
- `src/core/state.ts` — starting power 3 → 10
- `src/world/seed-world.ts` — seed a band of ~6 NPCs
- `src/game.ts` — register `AbandonmentSystem`
- `src/ui/npc-info-panel.ts` — status-hint line
- `src/render/sim-overlay.ts` — 🙏 prayer markers over worshipping NPCs
- `src/ui/spirit-hud.ts` — believer / durable / goal readout
- `src/game/frame-renderer.ts` — wire markers, HUD counts, immediate panel refresh after an act

**Create:**
- `src/sim/believers.ts` — `isDurable`, `countPlayerBelievers`, `countDurableBelievers`, `npcStatusHint`
- `src/sim/systems/abandonment-system.ts` — removes faith-zero ex-believers
- `tests/unit/dilemma-power-formula.test.ts`
- `tests/unit/dilemma-faith-decay.test.ts`
- `tests/unit/dilemma-divine-actions.test.ts`
- `tests/unit/dilemma-self-agency.test.ts`
- `tests/unit/believers.test.ts`
- `tests/unit/abandonment-system.test.ts`
- `tests/unit/seed-band.test.ts`
- `tests/integration/dilemma-harness.test.ts`

**Shared test helpers** (repeated in each test file — these tests are read out of order):

```typescript
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import type { GameMap, Entity, NpcProperties, NpcRole } from '@/core/types';

function emptyMap(): GameMap {
  return {
    tiles: [], width: 32, height: 32, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
}

function makeWorld(): World {
  return new World(emptyMap());
}

function addNpc(
  world: World, id: string, role: NpcRole, seed: number,
  belief: { faith: number; understanding: number; devotion: number },
): Entity {
  const props = initNpcProps(id, role, seed);
  props.beliefs['player'] = { ...belief };
  const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function props(e: Entity): NpcProperties {
  return e.properties as unknown as NpcProperties;
}
```

---

## Task 1: Power formula — `faith × (1+2u) × (1+2d)`

**Files:**
- Modify: `src/sim/spirit-system.ts`
- Test: `tests/unit/dilemma-power-formula.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dilemma-power-formula.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SpiritSystem } from '@/sim/spirit-system';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import type { GameMap, Entity, NpcProperties, NpcRole } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function addNpc(world: World, id: string, role: NpcRole, b: { faith: number; understanding: number; devotion: number }): Entity {
  const p = initNpcProps(id, role, 7);
  p.beliefs['player'] = { ...b };
  const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function makeSpirit(): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 0, manifestation: null };
}
function ctx(world: World, spirits: Map<SpiritId, Spirit>) {
  const clock = new SimClock();
  return { world, spirits, log: new EventLog(clock), clock, rng: createRng(0), dt: 1000, now: 0 };
}

describe('SpiritSystem power formula', () => {
  it('a fully-deepened believer contributes 9× a pure-faith believer', () => {
    const world = new World(emptyMap());
    addNpc(world, 'fearful', 'farmer', { faith: 0.5, understanding: 0, devotion: 0 });
    const spirits = new Map<SpiritId, Spirit>([['player', makeSpirit()]]);
    new SpiritSystem().tick(ctx(world, spirits));
    const fearfulPower = spirits.get('player')!.power;

    const world2 = new World(emptyMap());
    addNpc(world2, 'devoted', 'farmer', { faith: 0.5, understanding: 1, devotion: 1 });
    const spirits2 = new Map<SpiritId, Spirit>([['player', makeSpirit()]]);
    new SpiritSystem().tick(ctx(world2, spirits2));
    const devotedPower = spirits2.get('player')!.power;

    expect(devotedPower).toBeCloseTo(fearfulPower * 9, 5);
  });

  it('pure faith (u=d=0) regens faith × POWER_REGEN_RATE', () => {
    const world = new World(emptyMap());
    addNpc(world, 'a', 'farmer', { faith: 0.5, understanding: 0, devotion: 0 });
    const spirits = new Map<SpiritId, Spirit>([['player', makeSpirit()]]);
    new SpiritSystem().tick(ctx(world, spirits));
    expect(spirits.get('player')!.power).toBeCloseTo(0.5 * 0.02, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dilemma-power-formula.test.ts`
Expected: FAIL — the 9× test fails because current code sums `faith` only (devoted contributes the same as fearful).

- [ ] **Step 3: Implement the formula**

In `src/sim/spirit-system.ts`, add coefficients and replace the faith-only sum. Replace the whole file body with:

```typescript
import type { System, SystemContext } from '@/core/scheduler';
import type { SpiritId } from '@/core/spirit';
import { forEachNpc, npcProps } from '@/world/npc-helpers';

export const POWER_REGEN_RATE = 0.02;
/** Understanding & devotion are multipliers on a believer's faith contribution.
 *  contribution = faith × (1 + U·understanding) × (1 + D·devotion). */
export const POWER_UNDERSTANDING_COEFF = 2;
export const POWER_DEVOTION_COEFF = 2;

export class SpiritSystem implements System {
  readonly name = 'spirits';
  readonly tickHz = 1;
  private depletedAlready = new Set<SpiritId>();

  tick(ctx: SystemContext): void {
    const totals = new Map<SpiritId, number>();
    forEachNpc(ctx.world, (e) => {
      const p = npcProps(e);
      for (const [sid, b] of Object.entries(p.beliefs)) {
        const contribution =
          b.faith *
          (1 + POWER_UNDERSTANDING_COEFF * b.understanding) *
          (1 + POWER_DEVOTION_COEFF * b.devotion);
        totals.set(sid, (totals.get(sid) ?? 0) + contribution);
      }
    });

    for (const [sid, spirit] of ctx.spirits) {
      const total = totals.get(sid) ?? 0;
      spirit.power += total * POWER_REGEN_RATE;

      if (spirit.power <= 0) {
        if (!this.depletedAlready.has(sid)) {
          ctx.log.append({ type: 'power_depleted', spiritId: sid });
          this.depletedAlready.add(sid);
        }
      } else {
        this.depletedAlready.delete(sid);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/dilemma-power-formula.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npx vitest run`
Expected: any pre-existing test asserting `power += Σ faith × 0.02` may now fail. If `tests/unit/spirit-system*.test.ts` fails on a power value, update its expected value to the new formula (a believer with the default `initNpcProps` belief `{faith, understanding: 0.1, devotion: 0.05}` now contributes `faith × 1.2 × 1.1`). Fix those expectations; do not weaken the new test.

- [ ] **Step 6: Commit**

```bash
git add src/sim/spirit-system.ts tests/unit/dilemma-power-formula.test.ts
git commit -m "feat(belief): power = Σ faith×(1+2u)×(1+2d) — quantity ≠ power"
```

---

## Task 2: Faith decays — comfort, abandonment, devotion-resistance, faster meaning decay

**Files:**
- Modify: `src/sim/npc-sim.ts`
- Test: `tests/unit/dilemma-faith-decay.test.ts`

Background: `tickNpcEntity(e)` runs once per NPC per `NpcSimSystem` tick. It has the entity, so `npcProps(e).activity` and `.needs` are available. `computeMood(needs)` returns the 0–1 average of the four needs.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dilemma-faith-decay.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { tickNpcEntity } from '@/sim/npc-sim';
import { initNpcProps } from '@/world/npc-helpers';
import type { Entity, NpcProperties } from '@/core/types';

function npc(overrides: Partial<NpcProperties> = {}): Entity {
  const p = initNpcProps('t', 'farmer', 7);
  p.personality.skepticism = 0; // isolate the new decays from baseline decay
  Object.assign(p, overrides);
  return { id: 't', kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
}
function P(e: Entity): NpcProperties { return e.properties as unknown as NpcProperties; }

describe('comfort decay', () => {
  it('high needs erode faith when devotion is 0', () => {
    const e = npc();
    P(e).activity = 'idle';
    P(e).needs = { safety: 0.9, prosperity: 0.9, community: 0.9, meaning: 0.9 };
    P(e).beliefs['player'] = { faith: 0.8, understanding: 0, devotion: 0 };
    tickNpcEntity(e);
    expect(P(e).beliefs['player'].faith).toBeLessThan(0.8);
  });

  it('devotion resists comfort decay', () => {
    const e = npc();
    P(e).activity = 'idle';
    P(e).needs = { safety: 0.9, prosperity: 0.9, community: 0.9, meaning: 0.9 };
    P(e).beliefs['player'] = { faith: 0.8, understanding: 0, devotion: 1 };
    tickNpcEntity(e);
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.8, 5); // (1−devotion)=0 ⇒ no comfort decay
  });
});

describe('abandonment decay', () => {
  it('an unanswered worshipper loses faith', () => {
    const e = npc();
    P(e).activity = 'worship';
    // mid needs so neither comfort decay nor desperation boost dominate
    P(e).needs = { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 };
    P(e).beliefs['player'] = { faith: 0.5, understanding: 0, devotion: 0 };
    tickNpcEntity(e);
    expect(P(e).beliefs['player'].faith).toBeLessThan(0.5);
  });

  it('devotion resists abandonment decay', () => {
    const e = npc();
    P(e).activity = 'worship';
    P(e).needs = { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 };
    P(e).beliefs['player'] = { faith: 0.5, understanding: 0, devotion: 1 };
    tickNpcEntity(e);
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.5, 5);
  });
});

describe('meaning decay', () => {
  it('meaning falls by MEANING_DECAY per tick', () => {
    const e = npc();
    P(e).needs = { safety: 0.8, prosperity: 0.8, community: 0.8, meaning: 0.8 };
    tickNpcEntity(e);
    expect(P(e).needs.meaning).toBeCloseTo(0.8 - 0.004, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dilemma-faith-decay.test.ts`
Expected: FAIL — comfort/abandonment decay don't exist yet; meaning decays by 0.0005 not 0.004.

- [ ] **Step 3: Implement the decays**

In `src/sim/npc-sim.ts`, add constants near the top (after the existing `NEED_FAITH_BOOST`):

```typescript
const COMFORT_THRESHOLD = 0.6;   // avg needs above this → secularization pressure
const COMFORT_DECAY = 0.004;     // max extra faith decay from comfort, per tick
const ABANDON_DECAY = 0.006;     // extra faith decay while praying unanswered, per tick
const MEANING_DECAY = 0.004;     // the divine need decays fast enough to drive prayers
```

Replace the body of `tickNpcEntity` (the faith-decay loop and the needs-decay block) with:

```typescript
export function tickNpcEntity(e: Entity): void {
  const p = npcProps(e);

  if (p.whisperCooldown > 0) p.whisperCooldown -= 1;

  const avgNeeds = computeMood(p.needs);
  const inWorship = p.activity === 'worship';

  for (const belief of Object.values(p.beliefs)) {
    let decay = FAITH_DECAY_BASE * p.personality.skepticism;
    // Comfort decay: met needs erode faith (secularization). Resisted by devotion.
    if (avgNeeds > COMFORT_THRESHOLD) {
      decay += COMFORT_DECAY * ((avgNeeds - COMFORT_THRESHOLD) / (1 - COMFORT_THRESHOLD)) * (1 - belief.devotion);
    }
    // Abandonment decay: an unanswered standing plea bleeds faith. Resisted by devotion.
    if (inWorship) {
      decay += ABANDON_DECAY * (1 - belief.devotion);
    }
    belief.faith = clamp01(belief.faith - decay);
  }

  // Desperation boost: low needs make existing believers cling harder (fear breeds belief).
  if (avgNeeds < 0.4) {
    const desperation = (0.4 - avgNeeds) / 0.4;
    const boost = NEED_FAITH_BOOST * desperation * p.personality.piety;
    for (const belief of Object.values(p.beliefs)) {
      belief.faith = clamp01(belief.faith + boost);
    }
  }

  p.needs.safety     = clamp01(p.needs.safety     - 0.001);
  p.needs.prosperity = clamp01(p.needs.prosperity - 0.001);
  p.needs.community  = clamp01(p.needs.community  - 0.0005);
  p.needs.meaning    = clamp01(p.needs.meaning    - MEANING_DECAY);

  p.mood = computeMood(p.needs);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/dilemma-faith-decay.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add src/sim/npc-sim.ts tests/unit/dilemma-faith-decay.test.ts
git commit -m "feat(belief): comfort + abandonment decay (devotion-resisted); faster meaning decay"
```

---

## Task 3: Retune the verbs — Answer (recruit + restore meaning + exit worship) and Deepen

**Files:**
- Modify: `src/sim/divine-actions.ts`
- Test: `tests/unit/dilemma-divine-actions.test.ts`

`answerPrayer(spirit, npc, log)` and `dream(spirit, npc, log)` already exist. We:
- **Answer:** restore **`meaning`** specifically (`+0.3`), flip `activity` out of `worship` and zero `activityDuration`, keep `faith += 0.2`, set `understanding`/`devotion` boosts to 0 (Deepen owns those). Recruitment already works (it creates the belief entry if absent).
- **Deepen:** retune `dream` boosts to `understanding +0.12`, `devotion +0.12`, `faith +0.05`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dilemma-divine-actions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { answerPrayer, dream } from '@/sim/divine-actions';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import type { Entity, NpcProperties } from '@/core/types';
import type { Spirit } from '@/core/spirit';

function spirit(power = 100): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power, manifestation: null };
}
function npc(setup: (p: NpcProperties) => void): Entity {
  const p = initNpcProps('t', 'farmer', 7);
  setup(p);
  return { id: 't', kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
}
function P(e: Entity): NpcProperties { return e.properties as unknown as NpcProperties; }
const log = () => new EventLog(new SimClock());

describe('Answer', () => {
  it('restores meaning, raises faith, and exits worship', () => {
    const e = npc((p) => {
      p.activity = 'worship';
      p.activityDuration = 5;
      p.needs.meaning = 0.1;
      p.beliefs['player'] = { faith: 0.3, understanding: 0.2, devotion: 0.2 };
    });
    const ok = answerPrayer(spirit(), e, log());
    expect(ok).toBe(true);
    expect(P(e).needs.meaning).toBeCloseTo(0.4, 5);
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.5, 5);
    expect(P(e).beliefs['player'].devotion).toBeCloseTo(0.2, 5); // unchanged — Deepen owns devotion
    expect(P(e).activity).not.toBe('worship');
    expect(P(e).activityDuration).toBe(0);
  });

  it('recruits a non-believer who is praying', () => {
    const e = npc((p) => {
      p.activity = 'worship';
      p.needs.meaning = 0.1;
      delete (p.beliefs as Record<string, unknown>)['player'];
    });
    answerPrayer(spirit(), e, log());
    expect(P(e).beliefs['player'].faith).toBeGreaterThan(0);
  });

  it('refuses when the NPC is not praying', () => {
    const e = npc((p) => { p.activity = 'idle'; });
    expect(answerPrayer(spirit(), e, log())).toBe(false);
  });
});

describe('Deepen (dream)', () => {
  it('raises understanding and devotion, barely touches faith, leaves needs alone', () => {
    const e = npc((p) => {
      p.needs.meaning = 0.2;
      p.beliefs['player'] = { faith: 0.3, understanding: 0.1, devotion: 0.1 };
    });
    const meaningBefore = P(e).needs.meaning;
    dream(spirit(), e, log());
    expect(P(e).beliefs['player'].understanding).toBeCloseTo(0.22, 5);
    expect(P(e).beliefs['player'].devotion).toBeCloseTo(0.22, 5);
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.35, 5);
    expect(P(e).needs.meaning).toBeCloseTo(meaningBefore, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dilemma-divine-actions.test.ts`
Expected: FAIL — Answer currently boosts the lowest need by 0.15 (not meaning by 0.3), doesn't flip activity, and writes devotion; Deepen uses old boosts (faith 0.25 / understanding 0.10 / devotion 0.08).

- [ ] **Step 3: Implement the retune**

In `src/sim/divine-actions.ts`:

Replace the Deepen constants block:

```typescript
const DREAM_FAITH_BOOST = 0.05;
const DREAM_UNDERSTANDING_BOOST = 0.12;
const DREAM_DEVOTION_BOOST = 0.12;
const DREAM_PERSONALITY_DRIFT = 0.05; // small personality shift (unchanged)
```

Replace the Answer constants block:

```typescript
const ANSWER_PRAYER_FAITH_BOOST = 0.2;
const ANSWER_PRAYER_MEANING_BOOST = 0.3; // Answer restores the divine need specifically
```

Replace the whole `answerPrayer` function with:

```typescript
export function answerPrayer(spirit: Spirit, npc: Entity, log: EventLog): boolean {
  if (spirit.power < ANSWER_PRAYER_COST) return false;
  const p = npcProps(npc);

  // Can only answer a standing plea.
  if (p.activity !== 'worship') return false;

  spirit.power -= ANSWER_PRAYER_COST;

  // Recruitment: creates the belief entry if this is a non-believer praying.
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

  // Restore the divine need and clear the worship state so the 🙏 lifts.
  p.needs.meaning = clamp01(p.needs.meaning + ANSWER_PRAYER_MEANING_BOOST);
  p.activity = 'idle';
  p.activityDuration = 0;

  const appended = log.append({ type: 'answer_prayer', spiritId: spirit.id, npcId: npc.id });
  p.recentEventIds.push(appended.id);
  if (p.recentEventIds.length > 8) p.recentEventIds.shift();

  return true;
}
```

(Leave `dream`'s body as-is — it already reads the retuned constants and restores no needs.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/dilemma-divine-actions.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Check for regressions**

Run: `npx vitest run`
Expected: a pre-existing `divine-actions` test may assert the old Answer/Dream magnitudes. Update those expectations to the new constants (Answer: faith +0.2, meaning +0.3, no understanding/devotion, exits worship; Dream: faith +0.05, understanding/devotion +0.12). Do not weaken the new tests.

- [ ] **Step 6: Commit**

```bash
git add src/sim/divine-actions.ts tests/unit/dilemma-divine-actions.test.ts
git commit -m "feat(actions): Answer restores meaning+exits worship+recruits; Deepen owns understanding/devotion"
```

---

## Task 4: Self-agency — activities restore their need

**Files:**
- Modify: `src/sim/systems/npc-activity-system.ts`
- Test: `tests/unit/dilemma-self-agency.test.ts`

The activity system decrements `activityDuration` each tick and, when it hits 0, picks a new activity. The completion moment is exactly when we re-evaluate: restore the need for the activity that *just finished* (`props.activity` before reassignment). `worship` restores nothing here — meaning is the god's to grant.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dilemma-self-agency.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import type { GameMap, Entity, NpcProperties } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function ctx(world: World) {
  const clock = new SimClock();
  return { world, spirits: new Map(), log: new EventLog(clock), clock, rng: createRng(0), dt: 1000, now: 10 };
}

describe('self-agency', () => {
  it('completing work restores prosperity', () => {
    const world = new World(emptyMap());
    const p = initNpcProps('w', 'farmer', 7);
    p.activity = 'work';
    p.activityDuration = 0;          // expired → re-evaluate this tick
    p.needs.prosperity = 0.2;
    const e: Entity = { id: 'w', kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);

    new NpcActivitySystem().tick(ctx(world));

    expect((e.properties as unknown as NpcProperties).needs.prosperity).toBeCloseTo(0.5, 5);
  });

  it('completing worship does NOT restore meaning (the god grants it)', () => {
    const world = new World(emptyMap());
    const p = initNpcProps('p', 'priest', 7);
    p.activity = 'worship';
    p.activityDuration = 0;
    p.needs.meaning = 0.2;
    const e: Entity = { id: 'p', kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);

    new NpcActivitySystem().tick(ctx(world));

    expect((e.properties as unknown as NpcProperties).needs.meaning).toBeLessThanOrEqual(0.2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dilemma-self-agency.test.ts`
Expected: FAIL — `prosperity` stays 0.2 (no restore implemented).

- [ ] **Step 3: Implement self-agency**

In `src/sim/systems/npc-activity-system.ts`, add a constant near the other thresholds:

```typescript
/** Need restored when an NPC completes a self-serviced activity. */
const SELF_AGENCY_RESTORE = 0.3;
```

Add a `clamp01` import at the top (it's exported from `npc-sim`):

```typescript
import { clamp01 } from '@/sim/npc-sim';
```

In `tickNpcActivity`, the branch that runs when the activity has expired begins right after:

```typescript
    // If the current activity hasn't expired yet, don't re-evaluate
    if (props.activityDuration > 0) {
      props.activityDuration--;
      return;
    }
```

Immediately after that block, insert the self-agency restore for the activity that just finished:

```typescript
    // Self-agency: the finished activity restores its own need (the god is the margin).
    // `worship` is excluded — meaning is restored only when a god Answers.
    switch (props.activity) {
      case 'work':      props.needs.prosperity = clamp01(props.needs.prosperity + SELF_AGENCY_RESTORE); break;
      case 'socialize': props.needs.community  = clamp01(props.needs.community  + SELF_AGENCY_RESTORE); break;
      case 'sleep':     props.needs.safety     = clamp01(props.needs.safety     + SELF_AGENCY_RESTORE); break;
      default: break; // idle, wander, worship → no self-restore
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/dilemma-self-agency.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/sim/systems/npc-activity-system.ts tests/unit/dilemma-self-agency.test.ts
git commit -m "feat(sim): self-agency — work/socialize/sleep restore their need; worship excluded"
```

---

## Task 5: Believer accounting + status hint (`believers.ts`)

**Files:**
- Create: `src/sim/believers.ts`
- Test: `tests/unit/believers.test.ts`

Pure helpers used by the HUD, the NPC panel, the abandonment system, and the harness.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/believers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isDurable, countPlayerBelievers, countDurableBelievers, npcStatusHint } from '@/sim/believers';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Entity, NpcNeeds, SpiritBelief } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function add(world: World, id: string, b: SpiritBelief) {
  const p = initNpcProps(id, 'farmer', 7);
  p.beliefs['player'] = b;
  world.addEntity({ id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> });
}
const needs = (meaning: number): NpcNeeds => ({ safety: 0.5, prosperity: 0.5, community: 0.5, meaning });

describe('believer accounting', () => {
  it('isDurable requires faith>0.3 and devotion>0.4', () => {
    expect(isDurable({ faith: 0.5, understanding: 0, devotion: 0.5 })).toBe(true);
    expect(isDurable({ faith: 0.5, understanding: 0, devotion: 0.3 })).toBe(false);
    expect(isDurable({ faith: 0.2, understanding: 0, devotion: 0.5 })).toBe(false);
    expect(isDurable(undefined)).toBe(false);
  });

  it('counts believers (faith>0) and durable believers separately', () => {
    const world = new World(emptyMap());
    add(world, 'a', { faith: 0.5, understanding: 0, devotion: 0.5 }); // durable
    add(world, 'b', { faith: 0.5, understanding: 0, devotion: 0.0 }); // believer, not durable
    add(world, 'c', { faith: 0.0, understanding: 0, devotion: 0.0 }); // not a believer
    expect(countPlayerBelievers(world)).toBe(2);
    expect(countDurableBelievers(world)).toBe(1);
  });
});

describe('npcStatusHint', () => {
  it('flags about-to-abandon first', () => {
    expect(npcStatusHint({ faith: 0.1, understanding: 0, devotion: 0 }, needs(0.5), 'idle'))
      .toBe('about to abandon you');
  });
  it('flags praying', () => {
    expect(npcStatusHint({ faith: 0.5, understanding: 0, devotion: 0 }, needs(0.1), 'worship'))
      .toBe('praying — needs you now');
  });
  it('flags comfortable drifters', () => {
    expect(npcStatusHint({ faith: 0.5, understanding: 0, devotion: 0.1 }, needs(0.8), 'idle'))
      .toBe('comfortable — drifting away');
  });
  it('flags devoted and ripe-to-deepen', () => {
    expect(npcStatusHint({ faith: 0.5, understanding: 0, devotion: 0.6 }, needs(0.5), 'idle')).toBe('devoted');
    expect(npcStatusHint({ faith: 0.5, understanding: 0, devotion: 0.1 }, needs(0.5), 'idle')).toBe('ripe to deepen');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/believers.test.ts`
Expected: FAIL — module `@/sim/believers` does not exist.

- [ ] **Step 3: Implement `believers.ts`**

Create `src/sim/believers.ts`:

```typescript
import type { World } from '@/world/world';
import type { SpiritBelief, NpcNeeds, NpcActivity } from '@/core/types';
import { forEachNpc, npcProps } from '@/world/npc-helpers';

export const PLAYER_SPIRIT_ID = 'player';

/** A durable believer: faith and devotion both high enough to resist decay. */
export function isDurable(b: SpiritBelief | undefined): boolean {
  return !!b && b.faith > 0.3 && b.devotion > 0.4;
}

/** NPCs with any faith (>0) in the player. */
export function countPlayerBelievers(world: World): number {
  let n = 0;
  forEachNpc(world, (e) => {
    const b = npcProps(e).beliefs[PLAYER_SPIRIT_ID];
    if (b && b.faith > 0) n++;
  });
  return n;
}

/** NPCs who are durable believers in the player. */
export function countDurableBelievers(world: World): number {
  let n = 0;
  forEachNpc(world, (e) => {
    if (isDurable(npcProps(e).beliefs[PLAYER_SPIRIT_ID])) n++;
  });
  return n;
}

/** One-line, player-facing read of where a believer stands. Order matters. */
export function npcStatusHint(
  b: SpiritBelief | undefined,
  needs: NpcNeeds,
  activity: NpcActivity,
): string {
  const faith = b?.faith ?? 0;
  const devotion = b?.devotion ?? 0;
  if (faith < 0.15) return 'about to abandon you';
  if (activity === 'worship') return 'praying — needs you now';
  if (needs.meaning > 0.6 && devotion < 0.4) return 'comfortable — drifting away';
  if (faith > 0.3 && devotion > 0.4) return 'devoted';
  if (faith > 0.3 && devotion < 0.4) return 'ripe to deepen';
  return 'wavering';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/believers.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/sim/believers.ts tests/unit/believers.test.ts
git commit -m "feat(belief): believer accounting + status-hint helpers"
```

---

## Task 6: `believer_lost` event + AbandonmentSystem

**Files:**
- Modify: `src/core/events.ts`
- Create: `src/sim/systems/abandonment-system.ts`
- Test: `tests/unit/abandonment-system.test.ts`

A faith-zero ex-believer leaves the world after a short grace. Only NPCs who *were* believers (faith ever ≥ 0.15) are eligible — never-believers don't "abandon." On removal, scrub other NPCs' relationships that point at the departed.

- [ ] **Step 1: Add the event type**

In `src/core/events.ts`, add to the `SimEvent` union (after the `answer_prayer` line):

```typescript
  | { type: 'believer_lost';      npcId: EntityId }
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/abandonment-system.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import type { GameMap, Entity, NpcProperties } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function add(world: World, id: string, faith: number, rels: NpcProperties['relationships'] = []): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.beliefs['player'].faith = faith;
  p.relationships = rels;
  const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function makeCtx(world: World) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const events: string[] = [];
  log.subscribe((a) => { if (a.event.type === 'believer_lost') events.push((a.event as { npcId: string }).npcId); });
  return { ctx: { world, spirits: new Map(), log, clock, rng: createRng(0), dt: 1000, now: 0 }, events };
}

describe('AbandonmentSystem', () => {
  it('removes an ex-believer whose faith reaches 0, after the grace period', () => {
    const world = new World(emptyMap());
    add(world, 'gone', 0.5);                  // was a believer
    const { ctx, events } = makeCtx(world);
    const sys = new AbandonmentSystem();

    // It believes (faith 0.5) → drop to 0 and tick through the grace window.
    (world.registry.get('gone')!.properties as unknown as NpcProperties).beliefs['player'].faith = 0;
    for (let i = 0; i < 12; i++) sys.tick({ ...ctx, now: i });

    expect(world.registry.get('gone')).toBeUndefined();
    expect(events).toContain('gone');
  });

  it('never removes an NPC who was never a believer', () => {
    const world = new World(emptyMap());
    add(world, 'pagan', 0); // faith 0 from the start, never ≥0.15
    const { ctx } = makeCtx(world);
    const sys = new AbandonmentSystem();
    for (let i = 0; i < 30; i++) sys.tick({ ...ctx, now: i });
    expect(world.registry.get('pagan')).toBeDefined();
  });

  it('scrubs relationships pointing at the departed', () => {
    const world = new World(emptyMap());
    add(world, 'gone', 0.5);
    add(world, 'friend', 0.5, [{ npcId: 'gone', type: 'friend', trust: 0.8 }]);
    const { ctx } = makeCtx(world);
    const sys = new AbandonmentSystem();
    (world.registry.get('gone')!.properties as unknown as NpcProperties).beliefs['player'].faith = 0;
    for (let i = 0; i < 12; i++) sys.tick({ ...ctx, now: i });
    const friend = world.registry.get('friend')!.properties as unknown as NpcProperties;
    expect(friend.relationships.find((r) => r.npcId === 'gone')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/abandonment-system.test.ts`
Expected: FAIL — module `@/sim/systems/abandonment-system` does not exist.

- [ ] **Step 4: Implement the system**

Create `src/sim/systems/abandonment-system.ts`:

```typescript
import type { System, SystemContext } from '@/core/scheduler';
import type { Entity } from '@/core/types';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';

const BELIEVER_THRESHOLD = 0.15; // faith at/above this once → counts as "was a believer"
const ABANDON_FLOOR = 0.02;      // faith at/below this → lapsing
const GRACE_TICKS = 10;          // consecutive lapsed ticks before departure

/** Removes ex-believers whose faith in the player has collapsed to ~0. They stop
 *  believing and leave the world; their belief no longer feeds the god's power. */
export class AbandonmentSystem implements System {
  readonly name = 'abandonment';
  readonly tickHz = 1;
  private everBelieved = new Set<string>();
  private lapsed = new Map<string, number>();

  tick(ctx: SystemContext): void {
    const toRemove: Entity[] = [];

    forEachNpc(ctx.world, (e) => {
      const b = npcProps(e).beliefs[PLAYER_SPIRIT_ID];
      const faith = b?.faith ?? 0;
      if (faith >= BELIEVER_THRESHOLD) this.everBelieved.add(e.id);
      if (!this.everBelieved.has(e.id)) return;

      if (faith <= ABANDON_FLOOR) {
        const n = (this.lapsed.get(e.id) ?? 0) + 1;
        this.lapsed.set(e.id, n);
        if (n >= GRACE_TICKS) toRemove.push(e);
      } else {
        this.lapsed.delete(e.id);
      }
    });

    for (const e of toRemove) {
      // Scrub relationships pointing at the departed so nothing dangles.
      forEachNpc(ctx.world, (other) => {
        const op = npcProps(other);
        if (op.relationships.length > 0) {
          op.relationships = op.relationships.filter((r) => r.npcId !== e.id);
        }
      });
      ctx.world.removeEntity(e.id);
      this.everBelieved.delete(e.id);
      this.lapsed.delete(e.id);
      ctx.log.append({ type: 'believer_lost', npcId: e.id });
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/abandonment-system.test.ts`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add src/core/events.ts src/sim/systems/abandonment-system.ts tests/unit/abandonment-system.test.ts
git commit -m "feat(sim): AbandonmentSystem — faith-zero ex-believers leave; believer_lost event"
```

---

## Task 7: Register AbandonmentSystem + starting power stipend

**Files:**
- Modify: `src/game.ts` (system registration, around lines 82–91)
- Modify: `src/core/state.ts` (player power, line ~45)

- [ ] **Step 1: Register the system**

In `src/game.ts`, add the import alongside the other system imports:

```typescript
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
```

In the registration block, add `AbandonmentSystem` immediately after `NpcSimSystem` (so faith has been updated for this tick before we check for departures):

```typescript
    this.scheduler.register(new SettlementEventSystem());
    this.scheduler.register(new NpcSimSystem());
    this.scheduler.register(new AbandonmentSystem());
    this.scheduler.register(new NpcActivitySystem());
    this.scheduler.register(new BeliefPropagationSystem());
    this.scheduler.register(new SpiritSystem());
```

- [ ] **Step 2: Bump starting power**

In `src/core/state.ts`, change the player spirit's initial power from `3` to `10`:

```typescript
  spirits.set('player', {
    // ...existing fields...
    power: 10,
```

(Spec §2: a Slice-1 scaffold so the player can act before believers generate power; Slice 2 replaces it with the drift bootstrap.)

- [ ] **Step 3: Build to verify wiring compiles**

Run: `npm run build`
Expected: TypeScript passes, no unused-import or type errors.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS. If a snapshot/state test asserts `power: 3`, update it to `10`.

- [ ] **Step 5: Commit**

```bash
git add src/game.ts src/core/state.ts
git commit -m "feat(game): register AbandonmentSystem; starting power stipend 3→10"
```

---

## Task 8: Seed a band of ~6 NPCs

**Files:**
- Modify: `src/world/seed-world.ts`
- Test: `tests/unit/seed-band.test.ts`

Today `seedWorld` spawns one NPC at `faith 0.2`. Seed a fixed band of 6 with varied roles (varied `skepticism`/`piety`), each a near-non-believer (`faith ≈ 0.1`, `understanding = devotion = 0`), positioned at small offsets around the seed POI so they fall inside the realized bubble.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/seed-band.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { seedWorld } from '@/world/seed-world';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { identityOracle } from '@/world/oracle';
import type { GameMap, WorldSeed } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function map(): GameMap {
  const tiles = Array.from({ length: 32 }, (_, y) =>
    Array.from({ length: 32 }, (_, x) => ({ x, y, type: 'grass', state: 'void' } as unknown)));
  return { tiles, width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function seed(): WorldSeed {
  return {
    name: 'test', pois: [
      { id: 'cradle', type: 'village', name: 'Cradle', position: { x: 16, y: 16 },
        size: 'small', description: '', npcs: [{ name: 'First', role: 'farmer' }] },
    ],
  } as unknown as WorldSeed;
}

describe('seedWorld band', () => {
  it('spawns ~6 NPCs, each a near-non-believer (faith≈0.1, u=d=0)', () => {
    const m = map();
    const world = new World(m);
    const clock = new SimClock();
    const log = new EventLog(clock);
    const spirits = new Map<SpiritId, Spirit>([['player',
      { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 10, manifestation: null }]]);

    seedWorld({ world, log, clock, spirits, rng: createRng(0), worldSeed: seed(), map: m, oracle: identityOracle });

    const npcs = queryNpcs(world);
    expect(npcs.length).toBe(6);
    for (const e of npcs) {
      const b = npcProps(e).beliefs['player'];
      expect(b.faith).toBeLessThanOrEqual(0.2);
      expect(b.faith).toBeGreaterThan(0);
      expect(b.understanding).toBe(0);
      expect(b.devotion).toBe(0);
    }
  });

  it('places the band inside the map bounds', () => {
    const m = map();
    const world = new World(m);
    const clock = new SimClock();
    const log = new EventLog(clock);
    const spirits = new Map<SpiritId, Spirit>([['player',
      { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 10, manifestation: null }]]);
    seedWorld({ world, log, clock, spirits, rng: createRng(0), worldSeed: seed(), map: m, oracle: identityOracle });
    for (const e of queryNpcs(world)) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThan(32);
      expect(e.y).toBeLessThan(32);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/seed-band.test.ts`
Expected: FAIL — `npcs.length` is 1, not 6.

- [ ] **Step 3: Implement the band**

In `src/world/seed-world.ts`, replace step 3 ("Spawn the seed NPC") — the block that spawns a single NPC and appends one `npc_spawn` — with a band loop. Keep steps 1, 2, 4, 5, 6 unchanged.

```typescript
  // 3. Spawn a band of ~6 NPCs around the seed POI. Varied roles → varied
  //    skepticism/piety so they decay and convert at different rates. Each starts
  //    as a near-non-believer: faith ≈ 0.1, understanding = devotion = 0.
  const BAND: { name: string; role: NpcRole; dx: number; dy: number }[] = [
    { name: 'Tola',  role: 'farmer',   dx: 0,  dy: 0 },
    { name: 'Bram',  role: 'elder',    dx: 1,  dy: 0 },
    { name: 'Sefa',  role: 'child',    dx: -1, dy: 1 },
    { name: 'Doran', role: 'beggar',   dx: 2,  dy: 1 },
    { name: 'Mira',  role: 'merchant', dx: 0,  dy: 2 },
    { name: 'Garr',  role: 'soldier',  dx: -2, dy: 0 },
  ];
  const ox = seedPoi.position.x;
  const oy = seedPoi.position.y;
  const mapW = map.width;
  const mapH = map.height;

  BAND.forEach((member, i) => {
    const x = Math.max(0, Math.min(mapW - 1, ox + member.dx));
    const y = Math.max(0, Math.min(mapH - 1, oy + member.dy));
    const id = `${seedPoi.id}-npc-${i}`;
    const seed = hashId(id);
    const p = initNpcProps(member.name, member.role, seed);
    p.homePoiId = seedPoi.id;
    p.homeX = x;
    p.homeY = y;
    // Near-non-believer start (override initNpcProps' role-scaled belief).
    p.beliefs['player'] = { faith: 0.1, understanding: 0, devotion: 0 };
    world.addEntity({
      id, kind: 'npc', x, y,
      properties: p as unknown as Record<string, unknown>,
    });
    log.append({ type: 'npc_spawn', npcId: id, role: member.role, poiId: seedPoi.id });
  });
```

Note: the existing code referenced `seedPoi.npcs![0]`; the band no longer needs it, but step 2's guard (`p.npcs && p.npcs.length > 0 && p.position`) still requires the seed POI to declare at least one NPC — leave that guard as-is.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/seed-band.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Check for regressions**

Run: `npx vitest run`
Expected: a test asserting the cradle has exactly one NPC will now fail. Update it to expect 6 (the cradle is now a band — spec §2.1). If a test relied on the single id `cradle-npc-0`, that id still exists (index 0).

- [ ] **Step 6: Commit**

```bash
git add src/world/seed-world.ts tests/unit/seed-band.test.ts
git commit -m "feat(world): seed a band of 6 near-non-believers (triage substrate for the dilemma)"
```

---

## Task 9: The headless dilemma harness (the key proof)

**Files:**
- Create: `tests/integration/dilemma-harness.test.ts`

Runs the belief-relevant systems over many ticks under three scripted policies and asserts the strategies separate cleanly. Movement is excluded (it uses `Math.random`), so the run is deterministic. The crisp, tuning-robust invariant: **Answer grants zero devotion, so answer-everything can never produce a durable believer; only Deepen can.**

- [ ] **Step 1: Write the harness test**

Create `tests/integration/dilemma-harness.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps } from '@/world/npc-helpers';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { answerPrayer, dream } from '@/sim/divine-actions';
import { countPlayerBelievers, countDurableBelievers } from '@/sim/believers';
import type { GameMap, Entity, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

type Policy = 'ignore' | 'answerAll' | 'balanced';

function run(policy: Policy, ticks: number) {
  const world = new World(emptyMap());
  for (let i = 0; i < 6; i++) {
    const p = initNpcProps(`n${i}`, 'farmer', 100 + i);
    p.personality.skepticism = 0.5;
    p.beliefs['player'] = { faith: 0.3, understanding: 0, devotion: 0 };
    p.needs = { safety: 0.6, prosperity: 0.6, community: 0.6, meaning: 0.5 };
    world.addEntity({ id: `n${i}`, kind: 'npc', x: i, y: 0, properties: p as unknown as Record<string, unknown> });
  }

  const player: Spirit = { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 1000, manifestation: null };
  const spirits = new Map<SpiritId, Spirit>([['player', player]]);
  const clock = new SimClock();
  const log = new EventLog(clock);
  const rng = createRng(1);

  const sim = new NpcSimSystem();
  const activity = new NpcActivitySystem();
  const abandon = new AbandonmentSystem();
  const spiritSys = new SpiritSystem();

  for (let t = 0; t < ticks; t++) {
    const ctx = { world, spirits, log, clock, rng, dt: 1000, now: t };
    sim.tick(ctx);
    abandon.tick(ctx);
    activity.tick(ctx);
    spiritSys.tick(ctx);

    // Policy acts AFTER systems, with effectively unlimited power (we test
    // strategy shape, not the power economy).
    player.power = 1000;
    const npcs: Entity[] = [];
    forEachNpc(world, (e) => npcs.push(e));
    for (const e of npcs) {
      const p = npcProps(e);
      const b = p.beliefs['player'];
      if (!b) continue;
      if (policy === 'ignore') continue;
      if (policy === 'answerAll') {
        if (p.activity === 'worship') answerPrayer(player, e, log);
      } else { // balanced: answer the praying, deepen the secure
        if (p.activity === 'worship') answerPrayer(player, e, log);
        else if (b.faith > 0.4 && b.devotion < 0.5) dream(player, e, log);
      }
    }
  }
  return { believers: countPlayerBelievers(world), durable: countDurableBelievers(world) };
}

describe('the dilemma (headless proof)', () => {
  it('ignore-everything → believers abandon you', () => {
    const r = run('ignore', 800);
    expect(r.believers).toBeLessThan(6);   // some left
    expect(r.durable).toBe(0);
  });

  it('answer-everything → can never build durable believers (Answer gives no devotion)', () => {
    const r = run('answerAll', 800);
    expect(r.durable).toBe(0);
  });

  it('balanced (answer + deepen) → grows durable believers', () => {
    const r = run('balanced', 800);
    expect(r.durable).toBeGreaterThan(0);
  });

  it('balanced retains more believers than ignore', () => {
    expect(run('balanced', 800).believers).toBeGreaterThan(run('ignore', 800).believers);
  });
});
```

- [ ] **Step 2: Run the harness**

Run: `npx vitest run tests/integration/dilemma-harness.test.ts`
Expected: PASS. If `balanced.durable` is 0, the Deepen boosts are too small to cross `devotion > 0.4` within 800 ticks given decay — increase the run length to 1500 first; if still 0, that's a real tuning signal (raise `DREAM_DEVOTION_BOOST` in Task 3 or lower the durable devotion threshold in Task 5) — fix the constant, not the test. This harness is the tuning instrument (spec §8).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/dilemma-harness.test.ts
git commit -m "test(belief): headless dilemma harness — answer-only can't build durables; balanced can"
```

---

## Task 10: Surface the dilemma — status hint, prayer markers, HUD counts, instant feedback

**Files:**
- Modify: `src/ui/npc-info-panel.ts` (status-hint line)
- Modify: `src/render/sim-overlay.ts` (🙏 markers)
- Modify: `src/ui/spirit-hud.ts` (believer/durable/goal readout)
- Modify: `src/game/frame-renderer.ts` (call markers + HUD counts + instant panel refresh after an act)

These are player-facing rendering changes; verified visually + by build. The pure logic (`npcStatusHint`, counts) is already unit-tested in Task 5.

- [ ] **Step 1: Status hint in the NPC panel**

In `src/ui/npc-info-panel.ts`, import the helper at the top:

```typescript
import { npcStatusHint } from '@/sim/believers';
```

`renderNpcInfoPanel(panel, sim, opts)` receives `sim: NpcSimState`, which has `beliefs`, `needs`, and `activity`. Just before the "faith in you" section is rendered, compute and inject the hint as a prominent line:

```typescript
  const hint = npcStatusHint(sim.beliefs['player'], sim.needs, sim.activity);
  // Render `hint` as a styled line at the top of the belief section, e.g.:
  //   <div class="sg-status-hint">${hint}</div>
  // Match the panel's existing DOM-building style (the file builds innerHTML/elements
  // the same way for the needs and faith sections — follow that pattern exactly).
```

Follow the file's existing rendering idiom (it already builds labelled bars for needs and for faith/understanding/devotion — add the hint line in the same construction style; do not introduce a new framework).

- [ ] **Step 2: 🙏 markers over worshippers**

In `src/render/sim-overlay.ts`, add a new exported function (it mirrors how `drawNpcOverlay` projects a tile to screen via `worldToScreen` and `TILE_SIZE`, already imported in this file):

```typescript
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import type { World } from '@/world/world';
import type { Camera } from '@/render/camera';

/** Draw a 🙏 over every NPC currently in `worship`, so the player can see who
 *  needs them at a glance. Independent of selection. */
export function drawPrayerMarkers(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
): void {
  ctx.save();
  ctx.font = '16px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const e of queryNpcs(world)) {
    if (npcProps(e).activity !== 'worship') continue;
    const { sx, sy } = worldToScreen(camera, e.x, e.y, TILE_SIZE);
    ctx.fillText('🙏', sx + TILE_SIZE / 2, sy - 2);
  }
  ctx.restore();
}
```

(If `worldToScreen` returns a different shape than `{ sx, sy }`, match the destructuring used by `drawNpcOverlay` at the top of this file.)

- [ ] **Step 3: Believer/durable/goal readout in the HUD**

In `src/ui/spirit-hud.ts`, add a method to the `SpiritHudHandle` interface:

```typescript
  setBelieverStats(total: number, durable: number, goal: number): void;
```

In `createSpiritHud`, build a small DOM line (follow the existing stat-row construction used for Power/Followers) showing e.g. `Believers 4 · Durable 2/4`, and implement `setBelieverStats` to update its text. Return it on the handle object alongside `update/show/hide/destroy`.

- [ ] **Step 4: Wire markers, counts, and instant feedback in the frame renderer**

In `src/game/frame-renderer.ts`:

Import the helpers:

```typescript
import { drawPrayerMarkers } from '@/render/sim-overlay';
import { countPlayerBelievers, countDurableBelievers } from '@/sim/believers';
```

After NPCs are drawn each frame and where `this.deps.state.world` is in scope, draw the markers:

```typescript
    if (this.deps.state.world) {
      drawPrayerMarkers(this.deps.ctx, this.deps.state.world, this.deps.state.camera);
    }
```

Where the HUD is updated each frame (the `spiritHud` handle from `game-ui.ts`), push the counts (goal = 4 per spec §6/§8):

```typescript
    if (this.deps.state.world) {
      const total = countPlayerBelievers(this.deps.state.world);
      const durable = countDurableBelievers(this.deps.state.world);
      this.deps.ui.spiritHud.setBelieverStats(total, durable, 4);
    }
```

(If `spiritHud` isn't already on `frame-renderer`'s deps, add it to the deps interface and pass it from `game-ui.ts`/`game.ts` where the HUD is created — follow the existing wiring of `npcInfoPanel`.)

Fix the now-stale regen readout: `frame-renderer.ts` (~lines 170–177) and `spirit-hud.ts` (~line 343) still compute the HUD "+/s" regen by summing raw `faith` and showing the flat `POWER_REGEN_RATE`. After Task 1, true regen is `Σ faith × (1+2u) × (1+2d) × POWER_REGEN_RATE`. Update the `totalFaith` accumulation in `frame-renderer.ts` to sum the full contribution (import `POWER_UNDERSTANDING_COEFF`, `POWER_DEVOTION_COEFF` from `@/sim/spirit-system` and apply `faith × (1+2u) × (1+2d)` per believer), and pass that through so the HUD badge reflects the real rate rather than under-reporting.

Make acts land instantly: the panel currently refreshes at most every 500 ms. In the `onAnswerPrayer` and `onDream` callbacks (around lines 148–149), force an immediate refresh by resetting the throttle after the act:

```typescript
            onDream: () => { this.deps.divine.dream(entity); this.lastInfoRefresh = 0; },
            onAnswerPrayer: () => { this.deps.divine.answerPrayer(entity); this.lastInfoRefresh = 0; },
```

- [ ] **Step 5: Build and smoke-test**

Run: `npm run build`
Expected: TypeScript passes.

Run: `npm run dev`, open the game. Verify:
- ~6 NPCs in the cradle; HUD shows `Believers N · Durable 0/4`.
- Within ~1 minute some NPCs show 🙏 (meaning decayed → worship).
- Selecting an NPC shows a status hint ("praying — needs you now", etc.).
- Clicking **Answer Prayer** on a praying NPC lifts the 🙏, raises faith, and the panel updates immediately.
- Clicking **Dream** (Deepen) raises understanding/devotion; repeated Deepen pushes the NPC toward `Durable`, and the HUD durable count rises.

- [ ] **Step 6: Commit**

```bash
git add src/ui/npc-info-panel.ts src/render/sim-overlay.ts src/ui/spirit-hud.ts src/game/frame-renderer.ts
git commit -m "feat(ui): status hints, 🙏 prayer markers, believer/durable HUD readout, instant act feedback"
```

---

## Task 11: Final pass

- [ ] **Step 1: Full suite + build**

Run: `npx vitest run && npm run build`
Expected: all tests pass, build clean.

- [ ] **Step 2: Manual dilemma check (the actual point)**

With `npm run dev`, play ~5 minutes and confirm the three felt outcomes:
- Answer everyone constantly → believers go comfortable, faith visibly erodes, durable count stays 0.
- Ignore everyone → 🙏 pile up, faith bleeds, `believer_lost` fires, the band shrinks.
- Triage + Deepen the faithful → durable count climbs toward the goal of 4.

If the middle band is the only path that grows durables, the dilemma is proven. If any outcome feels flat or mistuned, adjust the constants in Tasks 2–3 (decay rates, boosts) — the harness in Task 9 is the safety net for re-tuning.

- [ ] **Step 3: Commit any tuning**

```bash
git add -A
git commit -m "chore(belief): tune dilemma constants from playtest"
```

---

## Self-review notes (coverage vs spec)

- Spec §3.1 faith forces → Task 2. §3.2 power formula → Task 1.
- §4 verbs (Answer recruit + exit worship; Deepen) → Task 3.
- §5 one-need + self-agency → Tasks 2 (meaning decay) + 4 (self-agency).
- §6 abandonment/goal/lose → Tasks 6 (removal+event), 10 (HUD goal), 5 (durable/counts).
- §7 UI (panel hint, 🙏, HUD, instant feedback, time controls reused) → Task 10.
- §8 constants → Tasks 1–4, 7, 8 (each constant lands in the cited file).
- §9 tests + harness + determinism caveat → Tasks 1–9 (harness Task 9 excludes movement).
- §10 caveats: propagation stays on (left registered, Task 7 untouched), removal hygiene (Task 6 scrub), canned text (no LLM), harness determinism (Task 9).
- Out of scope (rival/Fate/LLM/drift opening) → not built. Slice 2 (§12) untouched.
