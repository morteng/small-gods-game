/**
 * StagingBuffer — the set of armed (dormant) beats.
 *
 * Pure sim state: serialized INSIDE the snapshot (the *fact* a beat is armed, and
 * its hard commands, persist). IDs from a serialized integer counter. A
 * subject-key index makes "what is staged for this NPC/settlement?" cheap.
 */
import type { StagedBeat, BeatId } from './staging-types';
import type { ThreadSubject } from './thread-types';
import { subjectKey } from './thread-types';

export class StagingBuffer {
  private beats = new Map<BeatId, StagedBeat>();
  private nextId = 1;

  arm(beat: Omit<StagedBeat, 'id' | 'status'>): StagedBeat {
    const full: StagedBeat = { ...structuredClone(beat), id: this.nextId++, status: 'armed' };
    this.beats.set(full.id, full);
    return full;
  }

  get(id: BeatId): StagedBeat | undefined {
    return this.beats.get(id);
  }

  /** Armed beats whose subject matches. */
  armedFor(subject: ThreadSubject): StagedBeat[] {
    const key = subjectKey(subject);
    return [...this.beats.values()].filter(b => b.status === 'armed' && subjectKey(b.subject) === key);
  }

  /** All armed beats whose trigger is of a given kind. */
  armedByTrigger(kind: StagedBeat['trigger']['kind']): StagedBeat[] {
    return [...this.beats.values()].filter(b => b.status === 'armed' && b.trigger.kind === kind);
  }

  /** Armed beats carrying a given arc linkage (F5: a folded arc's beats expire). */
  armedForArc(arcId: number): StagedBeat[] {
    return [...this.beats.values()].filter(b => b.status === 'armed' && b.arcId === arcId);
  }

  markFired(id: BeatId): void {
    const b = this.beats.get(id);
    if (b) b.status = 'fired';
  }

  markExpired(id: BeatId): void {
    const b = this.beats.get(id);
    if (b) b.status = 'expired';
  }

  serialize(): StagedBeat[] {
    return structuredClone([...this.beats.values()]);
  }

  hydrate(beats: StagedBeat[]): void {
    this.beats.clear();
    let max = 0;
    for (const b of beats) {
      const copy = structuredClone(b);
      this.beats.set(copy.id, copy);
      if (copy.id > max) max = copy.id;
    }
    this.nextId = max + 1;
  }
}
