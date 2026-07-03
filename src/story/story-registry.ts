/**
 * StoryRegistry — the loaded-pack catalogue the running game plays from.
 *
 * A `StagedBeat` references a storylet by *id* (`beat.storylet`); the registry is
 * the lookup that turns that id into the owning `StoryPack` so the game can build
 * a `StorySession` over it. It is the load gate too: `register()` runs the same
 * `validatePack` the UGC ingest path uses, so a malformed or out-of-sandbox pack
 * never enters the playable set (it returns the errors instead of indexing).
 *
 * Pure data + Maps — no bus, no DOM, Node-testable. The bus/allowlist coupling
 * lives at the call site (pass `{ allowedVerbs: busAllowedVerbs(bus) }`).
 */
import type { StoryPack } from './story-ir';
import { validatePack } from './validate';
import type { ValidateOptions } from './validate';

export class StoryRegistry {
  private readonly byPackId = new Map<string, StoryPack>();
  /** storylet id → owning pack (storylet ids are expected globally unique). */
  private readonly byStoryletId = new Map<string, StoryPack>();

  /** Validate + index a pack. Returns validation errors ([] = accepted). */
  register(pack: StoryPack, opts?: ValidateOptions): string[] {
    const errors = validatePack(pack, opts);
    if (errors.length) return errors;
    this.byPackId.set(pack.id, pack);
    for (const s of pack.storylets) this.byStoryletId.set(s.id, pack);
    return [];
  }

  /** The pack that owns a given storylet id, or null. */
  findByStorylet(storyletId: string): StoryPack | null {
    return this.byStoryletId.get(storyletId) ?? null;
  }

  /** A registered pack by its id, or null. */
  get(packId: string): StoryPack | null {
    return this.byPackId.get(packId) ?? null;
  }

  /** Whether a storylet id is playable (registered in some pack). */
  has(storyletId: string): boolean {
    return this.byStoryletId.has(storyletId);
  }

  /** All registered storylet ids — the drift-guard set producers/Fate validate refs against. */
  storyletIds(): Set<string> {
    return new Set(this.byStoryletId.keys());
  }

  /** All registered packs (e.g. for the reservoir / a pack picker). */
  all(): StoryPack[] {
    return [...this.byPackId.values()];
  }

  get size(): number {
    return this.byPackId.size;
  }
}
