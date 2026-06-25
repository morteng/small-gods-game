/**
 * Runtime loader for Composer-produced cues committed under
 * public/asset-library/cues/. Keyless players get this baked library for free
 * (no LLM, no paid generation) — it EXTENDS the hand-authored base set, ids
 * colliding → the loaded cue wins (so the Composer can refine a base cue).
 *
 * Degrades silently: a missing file / bad JSON / no `fetch` (Node) yields [] and
 * the game runs on the TS base set. Never throws into the frame loop.
 */
import type { MusicCue } from '../cue-types';
import { validateCuePack } from '../cue-schema';

/** Default location of the committed cue pack, relative to the app base URL. */
const CUE_PACK_PATH = 'asset-library/cues/base.json';

export interface LoadCuesOptions {
  /** Base URL (defaults to Vite's BASE_URL, else '/'). */
  baseUrl?: string;
  /** Injectable for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

export async function loadComposedCues(opts: LoadCuesOptions = {}): Promise<MusicCue[]> {
  const f = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!f) return []; // Node / no fetch → base set only
  const base = opts.baseUrl ?? viteBase();
  const url = joinUrl(base, CUE_PACK_PATH);
  try {
    const res = await f(url);
    if (!res.ok) return [];
    const json = await res.json();
    return validateCuePack(json);
  } catch {
    return []; // network/parse failure → degrade to the base set
  }
}

function viteBase(): string {
  try {
    // import.meta.env is defined under Vite/vitest; guard for plain Node.
    const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
    return env?.BASE_URL ?? '/';
  } catch {
    return '/';
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
