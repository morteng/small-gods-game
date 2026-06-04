/**
 * PlotThreadStore — the authoritative set of plot threads.
 *
 * Pure sim state: serialized INSIDE the snapshot (see snapshot.ts), so timeline
 * scrub and SaveFile persistence both handle it through one integration point.
 * IDs come from a serialized integer counter (no Math.random, no Date). The
 * `eventId → threadId` reverse index is DERIVED (rebuilt on hydrate), never
 * serialized.
 */
import type { PlotThread, ThreadId, ShapeId, ThreadSubject, ThreadStatus } from './thread-types';
import { subjectKey } from './thread-types';
import { getShape } from './shape-registry';

export class PlotThreadStore {
  private threads = new Map<ThreadId, PlotThread>();
  private nextId = 1;
  private eventIndex = new Map<number, ThreadId>();

  /** Open a new thread at its shape's first phase, status 'active'. */
  open(shapeId: ShapeId, subject: ThreadSubject, tick: number): PlotThread {
    const shape = getShape(shapeId);
    const thread: PlotThread = {
      id: this.nextId++,
      shapeId,
      subject,
      phase: shape.phases[0].id,
      status: 'active',
      openedTick: tick,
      updatedTick: tick,
      contributingEvents: [],
      vars: {},
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  /** Move a thread to a new phase, recording the event that drove it. */
  advance(id: ThreadId, toPhase: string, eventId: number, tick: number): void {
    const t = this.threads.get(id);
    if (!t) return;
    t.phase = toPhase;
    t.updatedTick = tick;
    t.contributingEvents.push({ eventId, phase: toPhase, tick });
    this.eventIndex.set(eventId, id);
  }

  resolve(id: ThreadId, status: 'resolved' | 'abandoned', tick: number): void {
    const t = this.threads.get(id);
    if (!t) return;
    t.status = status;
    t.updatedTick = tick;
  }

  get(id: ThreadId): PlotThread | undefined {
    return this.threads.get(id);
  }

  active(): PlotThread[] {
    return [...this.threads.values()].filter(t => t.status === 'active');
  }

  /** All threads (any status) whose subject matches. */
  bySubject(subject: ThreadSubject): PlotThread[] {
    const key = subjectKey(subject);
    return [...this.threads.values()].filter(t => subjectKey(t.subject) === key);
  }

  threadOfEvent(eventId: number): ThreadId | undefined {
    return this.eventIndex.get(eventId);
  }

  serialize(): PlotThread[] {
    return structuredClone([...this.threads.values()]);
  }

  hydrate(threads: PlotThread[]): void {
    this.threads.clear();
    this.eventIndex.clear();
    let max = 0;
    for (const t of threads) {
      const copy = structuredClone(t);
      this.threads.set(copy.id, copy);
      if (copy.id > max) max = copy.id;
      for (const ce of copy.contributingEvents) this.eventIndex.set(ce.eventId, copy.id);
    }
    this.nextId = max + 1;
  }
}

export type { ThreadStatus };
