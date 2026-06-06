/**
 * CostTracker — accumulates real USD spend reported by the LLM provider.
 *
 * Three buckets: session (in-memory, resets on reload), month (persisted,
 * auto-rolls when the calendar month changes), and all-time (persisted). Cache
 * hits cost nothing and are counted separately. UI telemetry only — this is NOT
 * sim code, so wall-clock `new Date()` is fine here (the determinism rules apply
 * to src/sim/ alone). The `now` seam exists purely for deterministic tests.
 */

export interface SpendSnapshot {
  sessionUsd: number;
  monthUsd: number;
  allTimeUsd: number;
  calls: number;
  cacheHits: number;
  month: string; // 'YYYY-MM'
}

const SPEND_KEY = 'small-gods-llm-spend';
interface Persisted { month: string; monthUsd: number; allTimeUsd: number }

export class CostTracker {
  private sessionUsd = 0;
  private calls = 0;
  private cacheHits = 0;
  private monthUsd = 0;
  private allTimeUsd = 0;
  private month: string;
  private subs = new Set<(s: SpendSnapshot) => void>();

  constructor(private now: () => Date = () => new Date()) {
    const p = this.load();
    const m = this.monthKey(this.now());
    this.month = m;
    if (p) {
      this.allTimeUsd = p.allTimeUsd;
      this.monthUsd = p.month === m ? p.monthUsd : 0;
      if (p.month !== m) this.persist(); // rebaseline the rolled-over month
    }
  }

  record(r: { cost?: number; cacheStatus?: 'HIT' | 'MISS' }): void {
    this.rollover();
    if (r.cacheStatus === 'HIT') { this.cacheHits++; this.notify(); return; }
    this.calls++;
    const cost = r.cost ?? 0;
    if (cost > 0) {
      this.sessionUsd += cost;
      this.monthUsd += cost;
      this.allTimeUsd += cost;
      this.persist();
    }
    this.notify();
  }

  snapshot(): SpendSnapshot {
    return {
      sessionUsd: this.sessionUsd,
      monthUsd: this.monthUsd,
      allTimeUsd: this.allTimeUsd,
      calls: this.calls,
      cacheHits: this.cacheHits,
      month: this.month,
    };
  }

  subscribe(fn: (s: SpendSnapshot) => void): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }

  private rollover(): void {
    const m = this.monthKey(this.now());
    if (m !== this.month) { this.month = m; this.monthUsd = 0; this.persist(); }
  }

  private monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private notify(): void {
    const s = this.snapshot();
    this.subs.forEach((fn) => fn(s));
  }

  private load(): Persisted | null {
    try {
      const raw = localStorage.getItem(SPEND_KEY);
      return raw ? (JSON.parse(raw) as Persisted) : null;
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(SPEND_KEY, JSON.stringify({ month: this.month, monthUsd: this.monthUsd, allTimeUsd: this.allTimeUsd }));
    } catch {
      // ignore unavailable/quota-exceeded storage
    }
  }
}
