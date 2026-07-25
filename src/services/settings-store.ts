/**
 * settings-store — ONE typed settings object under ONE localStorage key,
 * replacing seven scattered keys (design doc §6): `small-gods-music`,
 * `small-gods-voice`, `small-gods-llm-provider`, the PixelLab api-key key,
 * the LLM spend totals, `small-gods-tutorial-seen`, and the dev dock layout.
 *
 * Migration (read-old → write-new → delete-old, exactly once): the FIRST read
 * ever performed against this module, if the new key is absent, gathers
 * whatever of the seven old keys exist (skipping any that are absent —
 * migration must be safe with a partial set), writes them into the new
 * blob, and deletes the old keys. Every later read/write goes through the new
 * key only, so a stale old key left behind by some other code path can never
 * clobber a newer value — once the new key exists, the old ones are never
 * consulted again. Idempotent: run this on an already-migrated store and it's
 * a plain read (no-op on the old keys, since they're already gone).
 *
 * Deliberately uncached (no module-level parsed-object cache on the happy
 * path): callers/tests routinely poke `localStorage` directly (see
 * tests/unit/cost-tracker.test.ts, pixellab.test.ts — both `localStorage
 * .clear()` between cases), and a stale in-memory cache would silently
 * desync from that. Settings reads are cold/low-frequency, so re-parsing a
 * small JSON blob per call is cheap. The ONE thing cached is a "storage is
 * broken" capability flag (see degradation below) — that's a capability, not
 * data, so caching it can't go stale mid-session.
 *
 * Degradation: every localStorage call is wrapped — a throw (private-mode
 * quota errors, a strict-CSP embed host) trips `storageBroken` and every
 * subsequent get/set falls back to an in-memory copy for the rest of the
 * session (never crashes the caller, never retries a call already known to
 * throw).
 */

const SETTINGS_KEY = 'small-gods-settings';

const OLD_KEYS = {
  musicOn: 'small-gods-music',
  voiceOn: 'small-gods-voice',
  llmProviderConfig: 'small-gods-llm-provider',
  pixellabApiKey: 'smallgods.pixellab.apiKey',
  llmSpend: 'small-gods-llm-spend',
  firstRunSeen: 'small-gods-tutorial-seen',
  dockLayout: 'small-gods-dev-layout',
} as const;

export interface LlmSpend {
  month: string;
  monthUsd: number;
  allTimeUsd: number;
}

export interface Settings {
  // Audio (§6.1)
  musicOn: boolean;
  musicVolume: number;
  sfxOn: boolean;
  sfxVolume: number;
  voiceOn: boolean;
  // Video (schema only here — wiring is a later slice)
  halfResWater: boolean;
  uiScale: number;
  lighting: number;
  // Gameplay / LLM (opaque — this module doesn't know their shapes)
  llmProviderConfig: unknown | null;
  pixellabApiKey: string | null;
  llmSpend: LlmSpend | null;
  // Misc
  firstRunSeen: boolean;
  dockLayout: Record<string, unknown>;
}

const DEFAULTS: Settings = {
  musicOn: true,
  musicVolume: 0.35,
  sfxOn: true,
  sfxVolume: 0.6,
  voiceOn: false,
  halfResWater: true,
  uiScale: 1,
  lighting: 1,
  llmProviderConfig: null,
  pixellabApiKey: null,
  llmSpend: null,
  firstRunSeen: false,
  dockLayout: {},
};

// — storage seam (never let a settings read/write take the boot down) ————————

let storageBroken = false;
let memCache: Settings = { ...DEFAULTS };

function tryGetItem(key: string): string | null {
  if (storageBroken) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    storageBroken = true;
    return null;
  }
}

function trySetItem(key: string, value: string): void {
  if (storageBroken) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    storageBroken = true;
  }
}

function tryRemoveItem(key: string): void {
  if (storageBroken) return;
  try {
    localStorage.removeItem(key);
  } catch {
    storageBroken = true;
  }
}

// — read/write/migrate ————————————————————————————————————————————————————

function tryParse<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Gather the seven old keys (skipping absent ones) into a fresh Settings. */
function migrate(): Settings {
  const s: Settings = { ...DEFAULTS };

  const music = tryGetItem(OLD_KEYS.musicOn);
  if (music !== null) s.musicOn = music === '1';

  const voice = tryGetItem(OLD_KEYS.voiceOn);
  if (voice !== null) s.voiceOn = voice === '1';

  const provider = tryParse<unknown>(tryGetItem(OLD_KEYS.llmProviderConfig));
  if (provider !== null) s.llmProviderConfig = provider;

  const pxKey = tryGetItem(OLD_KEYS.pixellabApiKey);
  if (pxKey !== null) s.pixellabApiKey = pxKey;

  const spend = tryParse<LlmSpend>(tryGetItem(OLD_KEYS.llmSpend));
  if (spend !== null) s.llmSpend = spend;

  const tutorial = tryGetItem(OLD_KEYS.firstRunSeen);
  if (tutorial !== null) s.firstRunSeen = tutorial === 'true';

  const dock = tryParse<Record<string, unknown>>(tryGetItem(OLD_KEYS.dockLayout));
  if (dock !== null) s.dockLayout = dock;

  writeAll(s);
  // Delete-old, exactly once — readAll() never looks at these again once
  // SETTINGS_KEY exists, but leaving them behind would confuse a reader that
  // still hits the raw key directly (there shouldn't be one after this slice,
  // but deleting is cheap insurance and matches the spec's "read-old → write-
  // new → delete-old" contract literally).
  for (const k of Object.values(OLD_KEYS)) tryRemoveItem(k);
  return s;
}

function readAll(): Settings {
  if (storageBroken) return memCache;
  const raw = tryGetItem(SETTINGS_KEY);
  if (storageBroken) return memCache; // the getItem call itself just tripped the flag
  if (raw !== null) {
    const parsed = tryParse<Partial<Settings>>(raw);
    return { ...DEFAULTS, ...parsed };
  }
  // New key absent — either truly fresh, or pre-migration. Either way this is
  // safe and idempotent (see migrate()'s doc comment).
  return migrate();
}

function writeAll(s: Settings): void {
  memCache = s;
  trySetItem(SETTINGS_KEY, JSON.stringify(s));
}

function update(patch: Partial<Settings>): Settings {
  const next = { ...readAll(), ...patch };
  writeAll(next);
  notify(next);
  return next;
}

// — subscribe ————————————————————————————————————————————————————————————

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

function notify(s: Settings): void {
  for (const fn of listeners) fn(s);
}

/** Notified after every set* call (in-tab only; no cross-tab storage events). */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// — whole-object access ——————————————————————————————————————————————————

export function getAll(): Settings {
  return { ...readAll() };
}

// — typed getters/setters ————————————————————————————————————————————————

export function getMusicOn(): boolean { return readAll().musicOn; }
export function setMusicOn(v: boolean): void { update({ musicOn: v }); }

export function getMusicVolume(): number { return readAll().musicVolume; }
export function setMusicVolume(v: number): void { update({ musicVolume: v }); }

export function getSfxOn(): boolean { return readAll().sfxOn; }
export function setSfxOn(v: boolean): void { update({ sfxOn: v }); }

export function getSfxVolume(): number { return readAll().sfxVolume; }
export function setSfxVolume(v: number): void { update({ sfxVolume: v }); }

export function getVoiceOn(): boolean { return readAll().voiceOn; }
export function setVoiceOn(v: boolean): void { update({ voiceOn: v }); }

export function getHalfResWater(): boolean { return readAll().halfResWater; }
export function setHalfResWater(v: boolean): void { update({ halfResWater: v }); }

export function getUiScale(): number { return readAll().uiScale; }
export function setUiScale(v: number): void { update({ uiScale: v }); }

export function getLighting(): number { return readAll().lighting; }
export function setLighting(v: number): void { update({ lighting: v }); }

export function getLlmProviderConfig(): unknown | null { return readAll().llmProviderConfig; }
export function setLlmProviderConfig(v: unknown): void { update({ llmProviderConfig: v }); }

export function getPixellabApiKey(): string | null { return readAll().pixellabApiKey; }
export function setPixellabApiKey(v: string): void { update({ pixellabApiKey: v }); }
export function clearPixellabApiKey(): void { update({ pixellabApiKey: null }); }

export function getLlmSpend(): LlmSpend | null { return readAll().llmSpend; }
export function setLlmSpend(v: LlmSpend): void { update({ llmSpend: v }); }

export function getFirstRunSeen(): boolean { return readAll().firstRunSeen; }
export function setFirstRunSeen(v: boolean): void { update({ firstRunSeen: v }); }

export function getDockLayout(): Record<string, unknown> { return readAll().dockLayout; }
export function setDockLayout(v: Record<string, unknown>): void { update({ dockLayout: v }); }

/** Test-only escape hatch: forget the "storage is broken" latch + memory
 *  fallback between test cases that stub/unstub localStorage. Harmless to
 *  call in production (just re-derives from a clean localStorage read). */
export function _resetForTests(): void {
  storageBroken = false;
  memCache = { ...DEFAULTS };
}
