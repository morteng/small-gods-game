import type { GeneratedDecoration } from '@/core/types';

/** Per-world-seed decoration placements. Keyed by `WorldSeed.name`.
 *  Survives reload as long as the same world seed file is loaded. */

const LS_PREFIX = 'smallgods.decorations.';
const SCHEMA_VERSION = 1;

interface StoredPayload {
  schemaVersion: 1;
  items: GeneratedDecoration[];
}

function storageKey(worldSeedName: string): string {
  return `${LS_PREFIX}${worldSeedName}`;
}

/** Validate a single item shape coming back from localStorage. */
function isValidDecoration(v: unknown): v is GeneratedDecoration {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.tileX === 'number' &&
    typeof o.tileY === 'number' &&
    typeof o.assetId === 'string' &&
    o.assetId.length > 0
  );
}

export function loadDecorations(worldSeedName: string): GeneratedDecoration[] {
  if (!worldSeedName) return [];
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey(worldSeedName));
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const payload = parsed as Partial<StoredPayload>;
  if (payload.schemaVersion !== SCHEMA_VERSION) return [];
  if (!Array.isArray(payload.items)) return [];
  return payload.items.filter(isValidDecoration);
}

export function saveDecorations(worldSeedName: string, items: GeneratedDecoration[]): void {
  if (!worldSeedName) return;
  const payload: StoredPayload = { schemaVersion: SCHEMA_VERSION, items };
  try {
    localStorage.setItem(storageKey(worldSeedName), JSON.stringify(payload));
  } catch {
    // localStorage unavailable or quota exceeded — silently drop. Decorations
    // remain in-memory for the session.
  }
}

export function clearDecorations(worldSeedName: string): void {
  if (!worldSeedName) return;
  try {
    localStorage.removeItem(storageKey(worldSeedName));
  } catch { /* ignore */ }
}
