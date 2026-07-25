import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as store from '@/services/settings-store';

const OLD_KEYS = {
  musicOn: 'small-gods-music',
  voiceOn: 'small-gods-voice',
  llmProviderConfig: 'small-gods-llm-provider',
  pixellabApiKey: 'smallgods.pixellab.apiKey',
  llmSpend: 'small-gods-llm-spend',
  firstRunSeen: 'small-gods-tutorial-seen',
  dockLayout: 'small-gods-dev-layout',
} as const;
const NEW_KEY = 'small-gods-settings';

beforeEach(() => {
  localStorage.clear();
  store._resetForTests();
});

describe('settings-store — defaults + round-trip', () => {
  it('applies documented defaults with nothing persisted', () => {
    const s = store.getAll();
    expect(s).toEqual({
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
    });
  });

  it('round-trips every field through its typed getter/setter', () => {
    store.setMusicOn(false); expect(store.getMusicOn()).toBe(false);
    store.setMusicVolume(0.7); expect(store.getMusicVolume()).toBe(0.7);
    store.setSfxOn(false); expect(store.getSfxOn()).toBe(false);
    store.setSfxVolume(0.9); expect(store.getSfxVolume()).toBe(0.9);
    store.setVoiceOn(true); expect(store.getVoiceOn()).toBe(true);
    store.setHalfResWater(false); expect(store.getHalfResWater()).toBe(false);
    store.setUiScale(2); expect(store.getUiScale()).toBe(2);
    store.setLighting(0.4); expect(store.getLighting()).toBe(0.4);
    store.setLlmProviderConfig({ type: 'mock' }); expect(store.getLlmProviderConfig()).toEqual({ type: 'mock' });
    store.setPixellabApiKey('px-key'); expect(store.getPixellabApiKey()).toBe('px-key');
    store.clearPixellabApiKey(); expect(store.getPixellabApiKey()).toBeNull();
    const spend = { month: '2026-07', monthUsd: 1.2, allTimeUsd: 9.9 };
    store.setLlmSpend(spend); expect(store.getLlmSpend()).toEqual(spend);
    store.setFirstRunSeen(true); expect(store.getFirstRunSeen()).toBe(true);
    const dock = { panelA: { dock: { kind: 'left', order: 0 }, open: true } };
    store.setDockLayout(dock); expect(store.getDockLayout()).toEqual(dock);
  });

  it('persists across a fresh read of the module state (survives a "reload")', () => {
    store.setMusicVolume(0.6);
    store._resetForTests(); // drops the in-memory fallback only; localStorage itself is untouched
    expect(store.getMusicVolume()).toBe(0.6);
  });

  it('notifies subscribers on every set*', () => {
    const seen: number[] = [];
    const unsub = store.subscribe((s) => seen.push(s.musicVolume));
    store.setMusicVolume(0.11);
    store.setMusicVolume(0.22);
    unsub();
    store.setMusicVolume(0.33);
    expect(seen).toEqual([0.11, 0.22]);
  });
});

describe('settings-store — migration', () => {
  it('migrates all seven old keys on first read: read-old → write-new → delete-old', () => {
    localStorage.setItem(OLD_KEYS.musicOn, '0');
    localStorage.setItem(OLD_KEYS.voiceOn, '1');
    localStorage.setItem(OLD_KEYS.llmProviderConfig, JSON.stringify({ type: 'openrouter', openrouterApiKey: 'k' }));
    localStorage.setItem(OLD_KEYS.pixellabApiKey, 'legacy-px');
    localStorage.setItem(OLD_KEYS.llmSpend, JSON.stringify({ month: '2026-06', monthUsd: 2, allTimeUsd: 5 }));
    localStorage.setItem(OLD_KEYS.firstRunSeen, 'true');
    localStorage.setItem(OLD_KEYS.dockLayout, JSON.stringify({ a: { dock: { kind: 'right', order: 0 }, open: false } }));

    const s = store.getAll();
    expect(s.musicOn).toBe(false);
    expect(s.voiceOn).toBe(true);
    expect(s.llmProviderConfig).toEqual({ type: 'openrouter', openrouterApiKey: 'k' });
    expect(s.pixellabApiKey).toBe('legacy-px');
    expect(s.llmSpend).toEqual({ month: '2026-06', monthUsd: 2, allTimeUsd: 5 });
    expect(s.firstRunSeen).toBe(true);
    expect(s.dockLayout).toEqual({ a: { dock: { kind: 'right', order: 0 }, open: false } });

    // write-new
    expect(localStorage.getItem(NEW_KEY)).not.toBeNull();
    // delete-old
    for (const k of Object.values(OLD_KEYS)) expect(localStorage.getItem(k)).toBeNull();
  });

  it('is safe when some old keys are absent (defaults fill the gaps)', () => {
    localStorage.setItem(OLD_KEYS.musicOn, '0');
    // voice/provider/pixellab/spend/tutorial/dock all absent.
    const s = store.getAll();
    expect(s.musicOn).toBe(false);
    expect(s.voiceOn).toBe(false); // default
    expect(s.llmProviderConfig).toBeNull();
    expect(s.pixellabApiKey).toBeNull();
    expect(s.llmSpend).toBeNull();
    expect(s.firstRunSeen).toBe(false);
    expect(s.dockLayout).toEqual({});
  });

  it('is safe when NO old keys exist at all (fresh install)', () => {
    expect(() => store.getAll()).not.toThrow();
    expect(store.getAll()).toEqual(expect.objectContaining({ musicOn: true, voiceOn: false }));
  });

  it('is idempotent: reading twice does not re-run migration or change values', () => {
    localStorage.setItem(OLD_KEYS.musicOn, '0');
    const first = store.getAll();
    const secondRaw = localStorage.getItem(NEW_KEY);
    store.getAll(); // second read — old key already gone, must be a no-op pass-through
    const thirdRaw = localStorage.getItem(NEW_KEY);
    expect(thirdRaw).toBe(secondRaw);
    expect(store.getAll()).toEqual(first);
  });

  it('does NOT clobber a newer value with an older one when both keys exist', () => {
    // Simulate: settings already migrated once (musicOn:false persisted through
    // the new key), then something writes the OLD key again with a different
    // value. Once the new key exists, migration must never run again — reads
    // should keep returning the value already in the new key.
    store.setMusicOn(false); // establishes the new key
    localStorage.setItem(OLD_KEYS.musicOn, '1'); // a stale old key reappears
    expect(store.getMusicOn()).toBe(false); // new key wins, old key ignored
  });
});

describe('settings-store — degrades when localStorage throws', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never throws on get/set, and keeps working in-memory for the rest of the session', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('quota/private-mode'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota/private-mode'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('quota/private-mode'); });

    expect(() => store.getAll()).not.toThrow();
    expect(store.getMusicOn()).toBe(true); // default, since nothing could be read

    expect(() => store.setMusicVolume(0.42)).not.toThrow();
    // In-memory fallback still round-trips within the session even though every
    // localStorage call throws.
    expect(store.getMusicVolume()).toBe(0.42);
  });
});
