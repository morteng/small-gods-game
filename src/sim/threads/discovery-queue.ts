/**
 * DiscoveryQueue — a transient FIFO of "the player's attention reached X" signals.
 *
 * Like CommandQueue, this is pending *input* (NPC focus, region realization), NOT
 * sim state: it is never snapshotted. The StagingActivationSystem drains it each
 * tick to fire `discovery`-triggered beats. Discovery is inherently
 * non-deterministic player input, consistent with the full-state-snapshot model.
 */
import type { ThreadSubject } from './thread-types';

export interface DiscoverySignal {
  subject: ThreadSubject;
}

export class DiscoveryQueue {
  private pending: DiscoverySignal[] = [];

  push(signal: DiscoverySignal): void {
    this.pending.push(signal);
  }

  drain(): DiscoverySignal[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  clear(): void {
    this.pending = [];
  }

  size(): number {
    return this.pending.length;
  }
}
