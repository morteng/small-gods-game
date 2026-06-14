// src/flora/flora-registry.ts
// Lookup over the curated flora fact-DB + the runtime lazy-fill seam.
//
// The vendored core (FLORA_FACTS) is bundled, so keyless players always have the
// full set. Lazy-fill mirrors the building-art source's IDB→vendored→paid ladder:
// a miss can be filled at runtime from a `FloraFactProvider` (e.g. Wikipedia MCP +
// LLM extraction) and registered on top, where it shadows nothing and persists for
// the session. The actual Wikipedia-backed provider is wired in a later slice; the
// seam (provider hook + register) lives here so callers can already query by id and
// get derived generation params.
import { FLORA_FACTS } from './flora-facts-data';
import { deriveGenParams, type FloraSpecies, type FloraGenParams } from './flora-species';

/** Runtime source for a species missing from the curated core (lazy-fill). Returns
 *  null if it cannot author one. Implementations: Wikipedia-MCP + LLM (later slice). */
export interface FloraFactProvider {
  fetch(id: string): Promise<FloraSpecies | null>;
}

const base = new Map<string, FloraSpecies>(FLORA_FACTS.map(s => [s.id, s]));
/** Lazy-filled species registered at runtime (shadow the curated core if same id). */
const runtime = new Map<string, FloraSpecies>();
const genCache = new Map<string, FloraGenParams>();
let provider: FloraFactProvider | null = null;

/** Install the runtime lazy-fill provider (null disables lazy-fill). */
export function setFloraFactProvider(p: FloraFactProvider | null): void { provider = p; }

/** Synchronous lookup over curated core + already-registered lazy-fills. */
export function getFloraSpecies(id: string): FloraSpecies | undefined {
  return runtime.get(id) ?? base.get(id);
}

/** Every species currently known (curated + lazy-filled), curated first. */
export function allFloraSpecies(): FloraSpecies[] {
  return [...base.values(), ...[...runtime.values()].filter(s => !base.has(s.id))];
}

/** Register a lazy-filled (or test) species; clears its cached gen params. */
export function registerFloraSpecies(species: FloraSpecies): void {
  runtime.set(species.id, species);
  genCache.delete(species.id);
}

/** Resolve a species, falling through to the lazy-fill provider on a miss; the
 *  fetched species is registered so subsequent lookups are synchronous. */
export async function resolveFloraSpecies(id: string): Promise<FloraSpecies | undefined> {
  const hit = getFloraSpecies(id);
  if (hit) return hit;
  if (!provider) return undefined;
  const fetched = await provider.fetch(id);
  if (fetched) { registerFloraSpecies(fetched); return fetched; }
  return undefined;
}

/** Derived (botanical → recipe/height/trunkR or rock) generation params, memoized.
 *  Undefined for an unknown id (use resolveFloraSpecies first to lazy-fill). */
export function floraGenParams(id: string): FloraGenParams | undefined {
  const cached = genCache.get(id);
  if (cached) return cached;
  const species = getFloraSpecies(id);
  if (!species) return undefined;
  const params = deriveGenParams(species);
  genCache.set(id, params);
  return params;
}

/** TEST-ONLY: drop all runtime lazy-fills + caches + provider (curated core stays). */
export function __resetFloraRuntime(): void {
  runtime.clear();
  genCache.clear();
  provider = null;
}
