/**
 * Deterministic thread recognizers.
 *
 * Each recognizer is a pure function over (new events, sim state) that opens /
 * advances / resolves threads in the store and appends the matching lifecycle
 * events. They read ONLY what the sim already produced (npc_death, settlement
 * events, divine acts) — this is the closure of VISION §9 #5 / Track-1 "consume
 * belief events". No Math.random; any randomness flows through ctx.rng.
 *
 * `monomyth` intentionally has no recognizer — proof that a shape can exist in
 * the registry awaiting the Fate brain.
 */
import type { World } from '@/world/world';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { EventLog, AppendedEvent } from '@/core/events';
import type { Rng } from '@/core/rng';
import type { Entity, SettlementEventType } from '@/core/types';
import { queryNpcs, npcProps, lineageMembers, NPC_KIND } from '@/world/npc-helpers';
import { BELIEVER_THRESHOLD } from '@/sim/believers';
import { PlotThreadStore } from './thread-store';
import type { PlotThread, ThreadSubject } from './thread-types';
import { phaseWeight } from './shape-registry';

export interface RecognizerCtx {
  world: World;
  spirits: Map<SpiritId, Spirit>;
  store: PlotThreadStore;
  log: EventLog;
  rng: Rng;
  now: number;
}

export type Recognizer = (newEvents: AppendedEvent[], ctx: RecognizerCtx) => void;

/** Settlement event types that constitute hardship (vs. festival/caravan/blessing). */
const HARDSHIP: ReadonlySet<SettlementEventType> = new Set<SettlementEventType>([
  'drought', 'plague', 'raiders', 'dispute',
]);

/** A loss thread with no meaning given within this many ticks is abandoned. */
export const LOSS_ABANDON_TICKS = 4000;

// ── emit helpers ──────────────────────────────────────────────────────────────

function emitOpened(ctx: RecognizerCtx, t: PlotThread): void {
  ctx.log.append({ type: 'thread_opened', threadId: t.id, shapeId: t.shapeId, subject: t.subject });
}
function emitAdvanced(ctx: RecognizerCtx, t: PlotThread): void {
  ctx.log.append({ type: 'thread_advanced', threadId: t.id, phase: t.phase, weight: phaseWeight(t.shapeId, t.phase) });
}
function emitResolved(ctx: RecognizerCtx, id: number, status: 'resolved' | 'abandoned'): void {
  ctx.log.append({ type: 'thread_resolved', threadId: id, status });
}

function maxFaith(e: Entity): number {
  const beliefs = npcProps(e).beliefs;
  let m = 0;
  for (const k of Object.keys(beliefs)) {
    const f = beliefs[k]?.faith ?? 0;
    if (f > m) m = f;
  }
  return m;
}

/** First living NPC tied to the deceased by relationship or shared lineage. */
function findBereaved(world: World, deceased: Entity): Entity | undefined {
  for (const e of queryNpcs(world)) {
    const rels = npcProps(e).relationships ?? [];
    if (rels.some(r => r.npcId === deceased.id && (r.type === 'family' || r.type === 'lover' || r.type === 'friend'))) {
      return e;
    }
  }
  const lineageId = npcProps(deceased).lineageId;
  if (lineageId) {
    const kin = lineageMembers(world, lineageId).filter(e => e.kind === NPC_KIND && e.id !== deceased.id);
    if (kin.length) return kin[0];
  }
  return undefined;
}

function activeOfShape(store: PlotThreadStore, subject: ThreadSubject, shapeId: string): PlotThread | undefined {
  return store.bySubject(subject).find(t => t.shapeId === shapeId && t.status === 'active');
}

// ── loss-given-meaning ─────────────────────────────────────────────────────────

export const recognizeLossGivenMeaning: Recognizer = (newEvents, ctx) => {
  for (const { event } of newEvents) {
    if (event.type === 'npc_death') {
      const deceased = ctx.world.registry.get(event.npcId);
      if (!deceased) continue;
      const bereaved = findBereaved(ctx.world, deceased);
      if (!bereaved) continue;
      // Belief-relevant only: the deceased or the bereaved must hold real faith.
      if (maxFaith(deceased) < BELIEVER_THRESHOLD && maxFaith(bereaved) < BELIEVER_THRESHOLD) continue;
      const subject: ThreadSubject = { kind: 'npc', npcId: bereaved.id };
      if (activeOfShape(ctx.store, subject, 'loss-given-meaning')) continue; // already grieving
      const t = ctx.store.open('loss-given-meaning', subject, ctx.now);
      emitOpened(ctx, t);
    } else if (event.type === 'answer_prayer' || event.type === 'dream') {
      // A god gives the loss meaning → climax, then the thread resolves.
      const subject: ThreadSubject = { kind: 'npc', npcId: event.npcId };
      const t = activeOfShape(ctx.store, subject, 'loss-given-meaning');
      if (!t) continue;
      ctx.store.advance(t.id, 'meaning', 0, ctx.now);
      emitAdvanced(ctx, ctx.store.get(t.id)!);
      ctx.store.resolve(t.id, 'resolved', ctx.now);
      emitResolved(ctx, t.id, 'resolved');
    }
  }

  // Timeout sweep (runs every tick, event-independent): unanswered grief lapses.
  for (const t of ctx.store.active()) {
    if (t.shapeId === 'loss-given-meaning' && ctx.now - t.openedTick > LOSS_ABANDON_TICKS) {
      ctx.store.resolve(t.id, 'abandoned', ctx.now);
      emitResolved(ctx, t.id, 'abandoned');
    }
  }
};

// ── trial (settlement) ─────────────────────────────────────────────────────────

export const recognizeTrial: Recognizer = (newEvents, ctx) => {
  for (const { event } of newEvents) {
    if (event.type === 'settlement_begin') {
      const subject: ThreadSubject = { kind: 'settlement', poiId: event.poiId };
      const existing = activeOfShape(ctx.store, subject, 'trial');
      if (HARDSHIP.has(event.eventType)) {
        if (!existing) {
          const t = ctx.store.open('trial', subject, ctx.now);
          t.vars.peakSeverity = event.severity;
          emitOpened(ctx, t);
        } else if (event.severity > (existing.vars.peakSeverity ?? 0) && existing.phase === 'onset') {
          existing.vars.peakSeverity = event.severity;
          ctx.store.advance(existing.id, 'hardship', 0, ctx.now);
          emitAdvanced(ctx, ctx.store.get(existing.id)!);
        }
      }
    } else if (event.type === 'miracle') {
      // A miracle on the stricken settlement is the turning point.
      const subject: ThreadSubject = { kind: 'settlement', poiId: event.poiId };
      const t = activeOfShape(ctx.store, subject, 'trial');
      if (t && (t.phase === 'onset' || t.phase === 'hardship')) {
        ctx.store.advance(t.id, 'turning', 0, ctx.now);
        emitAdvanced(ctx, ctx.store.get(t.id)!);
      }
    } else if (event.type === 'settlement_end') {
      const subject: ThreadSubject = { kind: 'settlement', poiId: event.poiId };
      const t = activeOfShape(ctx.store, subject, 'trial');
      if (t) {
        ctx.store.advance(t.id, 'aftermath', 0, ctx.now);
        emitAdvanced(ctx, ctx.store.get(t.id)!);
        ctx.store.resolve(t.id, 'resolved', ctx.now);
        emitResolved(ctx, t.id, 'resolved');
      }
    }
  }
};

export const RECOGNIZERS: Recognizer[] = [recognizeLossGivenMeaning, recognizeTrial];
