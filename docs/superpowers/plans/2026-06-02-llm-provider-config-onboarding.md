# LLM Provider Config + Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player set their OpenRouter key/models from inside the game and have it take effect immediately, meet new players with a clean welcome modal, add a capable second-tier model slot (plumbing only), and stop DeepSeek delimiter tokens leaking into narration.

**Architecture:** Reuse the existing provider layer (`OpenRouterProvider`, `provider-factory.ts`, `createLLMSettings`). Add shared form/modal primitives to `tokens.css`; thread a save callback from the form/modal up to `game.ts`, which rebuilds the live `LLMClient` (no reload). A pure token-filter guards the OpenRouter response path. A first-run modal is gated by a localStorage flag.

**Tech Stack:** TypeScript ES modules, Vite, Vitest (jsdom for DOM tests), Canvas 2D. `@/` path alias → `src/`. Tests live under `tests/unit/` and `tests/dom/`.

**Spec:** `docs/superpowers/specs/2026-06-02-llm-provider-config-onboarding-design.md`

**Conventions for every commit:** end the message with the trailer:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
Run a focused test with `npx vitest run <path>`. Do NOT push to origin.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/ui/tokens.css` | shared design primitives | **add** form/modal classes |
| `src/llm/filter-provider-tokens.ts` | strip provider delimiter tokens | **new** pure fn |
| `src/llm/llm-client.ts` | providers | apply filter in `OpenRouterProvider.generate` |
| `src/llm/provider-factory.ts` | config load/save/build | add `openrouterModelCapable`, refresh defaults |
| `src/game/llm-backfill.ts` | NPC focus → LLM | add `setClient()` |
| `src/ui/llm-settings-new.ts` | settings form | refresh catalog, capable dropdown, custom-ID, Advanced, `onSave` |
| `src/ui/settings-unified.ts` | settings modal shell + tabs | retype + forward callback; migrate modal to shared classes |
| `src/game/game-ui.ts` | owns UI panels | add `onLLMConfigChange` callback; restyle `⚙ LLM` |
| `src/ui/welcome-modal.ts` | first-run modal | **new** |
| `src/game.ts` | coordinator | `applyLlmConfig`, `llmClientCapable`, mount modal, wire callback |

---

## Task 1: Shared form/modal token primitives

**Files:**
- Modify: `src/ui/tokens.css` (append a new block before the "Time chip" section, i.e. after the `.sg-img--scene` rules)

CSS has no unit behavior; this task is verified by the downstream DOM tests (Tasks 6, 9, 10) asserting these class names, plus a grep + build. Add exactly these rules.

- [ ] **Step 1: Add the primitives to `tokens.css`**

Append this block (after the generated-image `.sg-img--scene` rule, before `/* Time chip */`):

```css
/* ── Forms & dialogs ─────────────────────────────────────── */
.sg-field { display: flex; flex-direction: column; gap: var(--s-1); }
.sg-field__label { font-size: var(--t-small); color: var(--ink-2); }

.sg-input, .sg-select {
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  padding: 6px 8px;
  font: var(--t-base)/1.2 var(--f-sans);
  color: var(--ink);
  width: 100%;
}
.sg-input:focus, .sg-select:focus {
  outline: none;
  border-color: var(--you-line);
  background: var(--paper);
}
.sg-select { cursor: pointer; }

.sg-link {
  color: var(--time);
  font-size: var(--t-small);
  text-decoration: none;
  cursor: pointer;
}
.sg-link:hover { text-decoration: underline; }

.sg-form-status {
  font-size: var(--t-tiny);
  font-family: var(--f-mono);
  padding: 6px 8px;
  border-radius: var(--r-2);
}
.sg-form-status--ok   { background: var(--faith-soft); color: oklch(0.55 0.13 80); }
.sg-form-status--info { background: var(--time-soft);  color: var(--time); }
.sg-form-status--err  { background: var(--danger-soft); color: var(--danger); }

.sg-advanced { border-top: 1px solid var(--line); padding-top: var(--s-2); }
.sg-advanced > summary {
  cursor: pointer; font-size: var(--t-small); color: var(--ink-3);
  list-style: none; user-select: none;
}
.sg-advanced[open] > summary { color: var(--ink-2); }

/* Modal: dimmed overlay + centered card. One pattern for all dialogs. */
.sg-modal-overlay {
  position: absolute; inset: 0;
  background: oklch(0.20 0.02 60 / 0.45);
  z-index: 40;
  display: flex; align-items: center; justify-content: center;
  animation: sg-fade-in 200ms ease-out;
}
@keyframes sg-fade-in { from { opacity: 0; } to { opacity: 1; } }
.sg-modal {
  width: 380px; max-width: calc(100vw - 32px);
  max-height: calc(100vh - 40px); overflow-y: auto;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--r-4);
  box-shadow: var(--lift-2);
  padding: var(--s-5);
  animation: sg-scale-in 200ms ease-out;
}
@keyframes sg-scale-in {
  from { opacity: 0; transform: scale(0.97) translateY(4px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
.sg-modal__title { font-size: var(--t-xl); font-weight: 700; margin: 0 0 var(--s-2); color: var(--ink); }
.sg-modal__body  { font-size: var(--t-base); color: var(--ink-2); margin: 0 0 var(--s-4); }
.sg-modal__actions { display: flex; gap: var(--s-2); justify-content: flex-end; margin-top: var(--s-4); }
.sg-modal__fields { display: flex; flex-direction: column; gap: var(--s-3); }
```

- [ ] **Step 2: Verify the classes exist and the build is clean**

Run: `grep -c "sg-modal-overlay\|sg-field\|sg-input\|sg-select\|sg-link\|sg-form-status\|sg-advanced" src/ui/tokens.css`
Expected: a count ≥ 7.

Run: `npm run build`
Expected: build succeeds (tsc clean — CSS is not type-checked but the build must not break).

- [ ] **Step 3: Commit**

```bash
git add src/ui/tokens.css
git commit -m "feat(ui): shared form/modal token primitives (.sg-field/.sg-input/.sg-modal/…)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Provider delimiter-token filter

**Files:**
- Create: `src/llm/filter-provider-tokens.ts`
- Create: `tests/unit/filter-provider-tokens.test.ts`
- Modify: `src/llm/llm-client.ts` (the `OpenRouterProvider.generate` content extraction only — NOT `OpenAIProvider`)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/filter-provider-tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterProviderTokens } from '@/llm/filter-provider-tokens';

describe('filterProviderTokens', () => {
  it('strips the bare ｜DSML｜tool_calls> leak (the exact prod shape)', () => {
    expect(filterProviderTokens('｜DSML｜tool_calls>Hei Morten!')).toBe('Hei Morten!');
  });
  it('strips the fullwidth-pipe-closed ｜DSML｜tool_calls｜ variant', () => {
    expect(filterProviderTokens('før｜DSML｜tool_calls｜etter')).toBe('føretter');
  });
  it('strips the bracketed Kimi <|tool_calls_begin|> form', () => {
    expect(filterProviderTokens('<|tool_calls_begin|>hello')).toBe('hello');
  });
  it('strips ASCII-rewritten _tool_calls> delimiters', () => {
    expect(filterProviderTokens('text_tool_calls>more')).toBe('textmore');
  });
  it('leaves a lone decorative ｜word｜ untouched', () => {
    expect(filterProviderTokens('the ｜word｜ stays')).toBe('the ｜word｜ stays');
  });
  it('leaves ordinary prose and JSON untouched', () => {
    expect(filterProviderTokens('{"faith": 0.2}')).toBe('{"faith": 0.2}');
  });
  it('returns empty string for empty input', () => {
    expect(filterProviderTokens('')).toBe('');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/filter-provider-tokens.test.ts`
Expected: FAIL — `Cannot find module '@/llm/filter-provider-tokens'`.

- [ ] **Step 3: Create the filter (ported from pikkolo-cms-mvp `pikkolo-tools.js`)**

Create `src/llm/filter-provider-tokens.ts`:

```ts
/**
 * Strip provider tool-call delimiter tokens that leak into the visible text
 * stream. DeepSeek V4 Flash emits fullwidth-pipe `｜DSML｜tool_calls>`; Kimi
 * emits ASCII `<|tool_calls_begin|>`; OpenRouter/DeepInfra sometimes rewrite
 * `｜`/`▁` to ASCII, leaving a bare `_tool_calls>`. A lone decorative `｜word｜`
 * is intentionally preserved.
 *
 * Ported verbatim from pikkolo-cms-mvp dashboard/static/js/pikkolo-tools.js
 * (and mirrored there + in api/.../streaming.py). Keep in sync if pikkolo's
 * copy changes. Observed prod 2026-05-21 (Drammen) and 2026-06-01.
 */
export function filterProviderTokens(text: string): string {
  if (!text) return '';
  // Bracketed forms: <｜...｜> (DeepSeek), <|...|> (Kimi), </｜...> close-tag.
  text = text.replace(/<\s*｜[^\n>]*?｜\s*[>～]/g, '');
  text = text.replace(/<\s*\|[^\n>]*?\|\s*>/g, '');
  text = text.replace(/<\/\s*｜[A-Za-z][A-Za-z0-9_]{0,30}(?:｜[A-Za-z0-9_]*){1,3}\s*[>～]/g, '');
  // Bare `>`-closed leaks where the wrapping bracket was dropped.
  text = text.replace(/｜[A-Za-z][A-Za-z0-9_]{1,30}(?:｜[A-Za-z0-9_]*){1,3}\s*[>～]/g, '');
  text = text.replace(/\|[A-Za-z][A-Za-z0-9_]{1,30}(?:\|[A-Za-z0-9_]*){1,3}\s*>/g, '');
  // Fullwidth-pipe-closed variants: ｜tool▁sep｜ (▁ is the tell) and the
  // ｜DSML｜...｜ marker run. A lone decorative ｜word｜ survives.
  text = text.replace(/｜[A-Za-z0-9_]*▁[A-Za-z0-9_▁]*[｜>～]/g, '');
  text = text.replace(/<?\/?｜DSML｜[A-Za-z0-9_]*[｜>～]/g, '');
  // ASCII-rewritten DeepSeek delimiters (bare `_tool_calls>`).
  text = text.replace(/<?\/?_?tool_(?:calls?|sep|outputs?)(?:_(?:begin|end|sep))?>/g, '');
  return text;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/filter-provider-tokens.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Apply the filter in `OpenRouterProvider.generate`**

In `src/llm/llm-client.ts`, add the import at the top (after the existing imports/interfaces, near the top of the file):

```ts
import { filterProviderTokens } from './filter-provider-tokens';
```

Then, inside **`OpenRouterProvider.generate`** (the class whose `name()` returns `OpenRouter(...)`), find:

```ts
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content ?? '';
```

Replace the second line with:

```ts
        const content = filterProviderTokens(data.choices?.[0]?.message?.content ?? '');
```

Leave `OpenAIProvider` unchanged.

- [ ] **Step 6: Run the full LLM test set + build**

Run: `npx vitest run tests/unit/filter-provider-tokens.test.ts && npm run build`
Expected: tests PASS, build clean.

- [ ] **Step 7: Commit**

```bash
git add src/llm/filter-provider-tokens.ts tests/unit/filter-provider-tokens.test.ts src/llm/llm-client.ts
git commit -m "feat(llm): strip provider delimiter tokens in OpenRouter responses

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add the capable-model config field

**Files:**
- Modify: `src/llm/provider-factory.ts` (the `ProviderConfig` interface, `loadProviderConfig`, and the `openrouter` case of `createProvider`)
- Create: `tests/unit/provider-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/provider-config.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadProviderConfig, saveProviderConfig, type ProviderConfig } from '@/llm/provider-factory';

describe('provider config — capable-tier field', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips openrouterModelCapable through save/load', () => {
    const config: ProviderConfig = {
      type: 'openrouter',
      openrouterApiKey: 'sk-or-test',
      openrouterModel: 'google/gemini-2.5-flash-lite',
      openrouterModelCapable: 'anthropic/claude-sonnet-4.6',
    };
    saveProviderConfig(config);
    const loaded = loadProviderConfig();
    expect(loaded.openrouterModelCapable).toBe('anthropic/claude-sonnet-4.6');
    expect(loaded.openrouterModel).toBe('google/gemini-2.5-flash-lite');
  });

  it('defaults the fast model to gemini-2.5-flash-lite when no config saved', () => {
    const loaded = loadProviderConfig();
    expect(loaded.openrouterModel).toBe('google/gemini-2.5-flash-lite');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/provider-config.test.ts`
Expected: FAIL — second test fails (default is still `openai/gpt-4o-mini`); first passes only if the field survives JSON (it does, but the type lacks the field).

- [ ] **Step 3: Add the field + refresh the default**

In `src/llm/provider-factory.ts`, in `interface ProviderConfig`, after `openrouterModel?: string;` add:

```ts
  openrouterModelCapable?: string;
```

In `loadProviderConfig()`, change the fallback return's `openrouterModel` and add the capable default:

```ts
  return {
    type: envKey ? 'openrouter' : 'mock',
    openrouterApiKey: envKey,
    openrouterModel: 'google/gemini-2.5-flash-lite',
    openrouterModelCapable: 'anthropic/claude-sonnet-4.6',
    maxTokens: 200,
    temperature: 0.7,
  };
```

In `createProvider`, the `openrouter` case, change the default model:

```ts
      const orConfig: OpenRouterConfig = {
        apiKey: config.openrouterApiKey,
        model: config.openrouterModel ?? 'google/gemini-2.5-flash-lite',
        siteUrl: config.openrouterSiteUrl,
        siteName: config.openrouterSiteName ?? 'Small Gods Game',
      };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/provider-config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/provider-factory.ts tests/unit/provider-config.test.ts
git commit -m "feat(llm): add openrouterModelCapable config field; refresh default model

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `LlmBackfillService.setClient()`

**Files:**
- Modify: `src/game/llm-backfill.ts` (the `LlmBackfillService` class)
- Create: `tests/unit/llm-backfill-setclient.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/llm-backfill-setclient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LlmBackfillService } from '@/game/llm-backfill';
import { LLMClient, MockLLMProvider } from '@/llm/llm-client';
import { createState } from '@/core/state';

function fakeDisplay() {
  return { showBoth() {}, showDialogue() {}, showNarration() {}, hide() {} } as any;
}

describe('LlmBackfillService.setClient', () => {
  it('swaps the active client', () => {
    const svc = new LlmBackfillService({ state: createState(), llmDisplay: fakeDisplay() });
    const next = new LLMClient(new MockLLMProvider(1));
    svc.setClient(next);
    // @ts-expect-error — reach into private for the assertion
    expect(svc.client).toBe(next);
  });
});
```

> Note: if `createState` needs args, call it as the codebase's other tests do — check `tests/` for an existing `createState(` usage and mirror it. The assertion is only about `setClient`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/llm-backfill-setclient.test.ts`
Expected: FAIL — `svc.setClient is not a function`.

- [ ] **Step 3: Add the method**

In `src/game/llm-backfill.ts`, inside `class LlmBackfillService`, after the constructor add:

```ts
  setClient(client: LLMClient): void {
    this.client = client;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/llm-backfill-setclient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/llm-backfill.ts tests/unit/llm-backfill-setclient.test.ts
git commit -m "feat(game): LlmBackfillService.setClient for live provider swap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Settings form — refresh catalog, capable dropdown, `onSave` callback

**Files:**
- Modify: `src/ui/llm-settings-new.ts`
- Create: `tests/dom/llm-settings.test.ts`

This task: (a) replace the stale `OPENROUTER_MODELS` with the curated fast list + a new capable list, (b) add a "Capable model" dropdown bound to `openrouterModelCapable`, (c) accept an `opts.onSave` and call it after `saveProviderConfig`.

- [ ] **Step 1: Write the failing test**

Create `tests/dom/llm-settings.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLLMSettings } from '@/ui/llm-settings-new';

beforeEach(() => localStorage.clear());

function selectProvider(el: HTMLElement, value: string) {
  const sel = el.querySelector('select') as HTMLSelectElement;
  sel.value = value;
  sel.dispatchEvent(new Event('change'));
}

describe('createLLMSettings', () => {
  it('fires onSave with the chosen OpenRouter config when Save is clicked', () => {
    const onSave = vi.fn();
    const handle = createLLMSettings({ onSave });
    document.body.appendChild(handle.element);

    selectProvider(handle.element, 'openrouter');
    const key = handle.element.querySelector('input[type="password"]') as HTMLInputElement;
    key.value = 'sk-or-xyz';

    const saveBtn = [...handle.element.querySelectorAll('button')]
      .find(b => b.textContent === 'Save') as HTMLButtonElement;
    saveBtn.click();

    expect(onSave).toHaveBeenCalledTimes(1);
    const cfg = onSave.mock.calls[0][0];
    expect(cfg.type).toBe('openrouter');
    expect(cfg.openrouterApiKey).toBe('sk-or-xyz');
    expect(cfg.openrouterModelCapable).toBeTruthy();
    handle.destroy();
  });

  it('persists openrouterModelCapable to localStorage on Save', () => {
    const handle = createLLMSettings();
    document.body.appendChild(handle.element);
    selectProvider(handle.element, 'openrouter');
    (handle.element.querySelector('input[type="password"]') as HTMLInputElement).value = 'sk-or-1';
    ([...handle.element.querySelectorAll('button')].find(b => b.textContent === 'Save') as HTMLButtonElement).click();
    const saved = JSON.parse(localStorage.getItem('small-gods-llm-provider')!);
    expect(saved.openrouterModelCapable).toBeTruthy();
    handle.destroy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dom/llm-settings.test.ts`
Expected: FAIL — `createLLMSettings` ignores `onSave` / capable field absent.

- [ ] **Step 3: Refresh the catalog + add capable list**

In `src/ui/llm-settings-new.ts`, replace the `OPENROUTER_MODELS` const with:

```ts
const OPENROUTER_MODELS = [
  { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite (Recommended)' },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash (cheapest)' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
];

const OPENROUTER_CAPABLE_MODELS = [
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6 (Recommended)' },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro (cheap)' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro (large context)' },
];
```

- [ ] **Step 4: Add the `onSave` parameter + capable dropdown**

Change the function signature:

```ts
export function createLLMSettings(
  opts: { onSave?: (config: ProviderConfig) => void } = {},
): LLMSettingsHandle {
```

Add the import for the type at the top (extend the existing import):

```ts
import type { ProviderType, ProviderConfig } from '@/llm/provider-factory';
```

After the existing model row (`container.appendChild(modelRow);`), add a capable-model row (mirrors the model row, using `.sg-field`/`.sg-select`):

```ts
  // ─── Capable Model Select (for OpenRouter, key moments) ───
  const capableRow = document.createElement('div');
  capableRow.id = 'sg-llm-capable-row';
  capableRow.className = 'sg-field';

  const capableLabel = document.createElement('div');
  capableLabel.className = 'sg-field__label';
  capableLabel.textContent = 'Capable model (key moments)';
  capableRow.appendChild(capableLabel);

  const capableSelect = document.createElement('select');
  capableSelect.id = 'sg-llm-capable-select';
  capableSelect.className = 'sg-select';
  for (const m of OPENROUTER_CAPABLE_MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    if (m.id === saved.openrouterModelCapable) opt.selected = true;
    capableSelect.appendChild(opt);
  }
  capableRow.appendChild(capableSelect);
  container.appendChild(capableRow);
```

In `updateVisibility()`, show/hide the capable row with the model row:

```ts
    (capableRow as HTMLElement).style.display = showModel ? '' : 'none';
```

In the Save handler, add the capable field to the config and call `onSave`. Replace the `openrouter` branch and the trailing status update:

```ts
    } else if (type === 'openrouter') {
      config.openrouterApiKey = keyInput.value;
      config.openrouterModel = modelSelect.value;
      config.openrouterModelCapable = capableSelect.value;
    }

    saveProviderConfig(config as ProviderConfig);
    opts.onSave?.(config as ProviderConfig);
    status.textContent = 'Settings saved!';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/dom/llm-settings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/ui/llm-settings-new.ts tests/dom/llm-settings.test.ts
git commit -m "feat(ui): refresh model catalog, capable-tier dropdown, onSave callback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Settings form — custom model ID + Advanced disclosure

**Files:**
- Modify: `src/ui/llm-settings-new.ts`
- Modify: `tests/dom/llm-settings.test.ts` (add cases)

- [ ] **Step 1: Add the failing tests**

Append to `tests/dom/llm-settings.test.ts`:

```ts
describe('createLLMSettings — custom model + advanced', () => {
  it('reveals a custom-model input when "Custom model ID…" is chosen, and saves its value', () => {
    const onSave = vi.fn();
    const handle = createLLMSettings({ onSave });
    document.body.appendChild(handle.element);
    selectProvider(handle.element, 'openrouter');
    (handle.element.querySelector('input[type="password"]') as HTMLInputElement).value = 'sk-or-2';

    const modelSel = handle.element.querySelector('#sg-llm-model-select') as HTMLSelectElement;
    modelSel.value = '__custom__';
    modelSel.dispatchEvent(new Event('change'));

    const custom = handle.element.querySelector('#sg-llm-model-custom') as HTMLInputElement;
    expect(custom.style.display).not.toBe('none');
    custom.value = 'meta-llama/llama-4-scout';

    ([...handle.element.querySelectorAll('button')].find(b => b.textContent === 'Save') as HTMLButtonElement).click();
    expect(onSave.mock.calls[0][0].openrouterModel).toBe('meta-llama/llama-4-scout');
    handle.destroy();
  });

  it('renders max-tokens and temperature inside a closed Advanced disclosure', () => {
    const handle = createLLMSettings();
    document.body.appendChild(handle.element);
    const adv = handle.element.querySelector('details.sg-advanced') as HTMLDetailsElement;
    expect(adv).toBeTruthy();
    expect(adv.open).toBe(false);
    expect(adv.querySelector('input[type="number"]')).toBeTruthy();
    handle.destroy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dom/llm-settings.test.ts`
Expected: FAIL — no `__custom__` option, no `details.sg-advanced`.

- [ ] **Step 3: Add the custom-ID option + input for the model select**

In `src/ui/llm-settings-new.ts`, after the loop that fills `modelSelect`, append a custom option and a hidden input. Insert right before `modelRow.appendChild(modelSelect);`:

```ts
  const customModelOpt = document.createElement('option');
  customModelOpt.value = '__custom__';
  customModelOpt.textContent = 'Custom model ID…';
  modelSelect.appendChild(customModelOpt);
```

After `container.appendChild(modelRow);` (and before the capable row from Task 5), add the custom input:

```ts
  const modelCustom = document.createElement('input');
  modelCustom.id = 'sg-llm-model-custom';
  modelCustom.type = 'text';
  modelCustom.placeholder = 'provider/model-id';
  modelCustom.className = 'sg-input';
  modelCustom.style.display = 'none';
  // Pre-fill custom if the saved model isn't in the curated list.
  if (saved.openrouterModel && !OPENROUTER_MODELS.some(m => m.id === saved.openrouterModel)) {
    modelSelect.value = '__custom__';
    modelCustom.value = saved.openrouterModel;
    modelCustom.style.display = '';
  }
  modelSelect.addEventListener('change', () => {
    modelCustom.style.display = modelSelect.value === '__custom__' ? '' : 'none';
  });
  modelRow.appendChild(modelCustom);
```

In the Save handler, make the model value honor the custom field. Change the `openrouter` branch's model assignment:

```ts
      config.openrouterModel = modelSelect.value === '__custom__'
        ? (modelCustom.value.trim() || OPENROUTER_MODELS[0].id)
        : modelSelect.value;
```

- [ ] **Step 4: Move max-tokens & temperature into an Advanced disclosure**

Replace the construction of `tokensRow` and `tempRow` so both controls live inside a `<details class="sg-advanced">`. Where the current code builds `tokensRow`/`tempRow` and appends them to `container`, wrap them:

```ts
  const advanced = document.createElement('details');
  advanced.className = 'sg-advanced';
  const advSummary = document.createElement('summary');
  advSummary.textContent = 'Advanced';
  advanced.appendChild(advSummary);
  // (build tokensRow and tempRow exactly as before, but append to `advanced`)
  advanced.appendChild(tokensRow);
  advanced.appendChild(tempRow);
  container.appendChild(advanced);
```

Apply `.sg-field`/`.sg-field__label`/`.sg-input` classes to `tokensRow`/`tempRow` and their inputs (replacing their inline `cssText` with the class) so they match the rest. Keep `tokensInput`/`tempInput` ids/values/min/max as-is.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/dom/llm-settings.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 6: Commit**

```bash
git add src/ui/llm-settings-new.ts tests/dom/llm-settings.test.ts
git commit -m "feat(ui): custom model-ID field + Advanced disclosure for token/temp

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire the save callback through settings-unified

**Files:**
- Modify: `src/ui/settings-unified.ts` (import, `SettingsOptions` type, the `createLLMSettings()` call; migrate the overlay/modal classNames to the shared primitives)
- Create: `tests/dom/settings-unified-onsave.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dom/settings-unified-onsave.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSettingsPanel } from '@/ui/settings-unified';

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

describe('settings-unified forwards LLM save', () => {
  it('calls onLLMConfigChange when the LLM tab saves', () => {
    const onLLMConfigChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = createSettingsPanel(container, { onLLMConfigChange });
    panel.show();

    // Switch the embedded LLM form to OpenRouter, set a key, Save.
    const sel = container.querySelector('.sg-llm-settings select') as HTMLSelectElement;
    sel.value = 'openrouter';
    sel.dispatchEvent(new Event('change'));
    (container.querySelector('.sg-llm-settings input[type="password"]') as HTMLInputElement).value = 'sk-or-z';
    ([...container.querySelectorAll('.sg-llm-settings button')]
      .find(b => b.textContent === 'Save') as HTMLButtonElement).click();

    expect(onLLMConfigChange).toHaveBeenCalledTimes(1);
    expect(onLLMConfigChange.mock.calls[0][0].type).toBe('openrouter');
    panel.destroy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dom/settings-unified-onsave.test.ts`
Expected: FAIL — `createLLMSettings()` is called with no `onSave`, so the spy never fires.

- [ ] **Step 3: Retype the option + forward it**

In `src/ui/settings-unified.ts`:

Change the import on line 6 from `OpenAIConfig` to `ProviderConfig`:

```ts
import type { ProviderConfig } from '@/llm/provider-factory';
```

In `interface SettingsOptions`, retype:

```ts
  onLLMConfigChange?: (config: ProviderConfig) => void;
```

Also retype `updateLLMConfig` in `SettingsHandle` and any `createGameSettings`/`createPixelLabSettings` signatures that referenced `OpenAIConfig` for the LLM path — replace `OpenAIConfig` with `ProviderConfig` wherever it typed the LLM config. (If `OpenAIConfig` is still used for PixelLab, leave that import; otherwise remove it.)

Change the `createLLMSettings()` call (~line 220) to:

```ts
  const llmSettings = createLLMSettings({ onSave: (c) => opts.onLLMConfigChange?.(c) });
```

- [ ] **Step 4: Migrate the modal overlay/panel to shared classes**

In the `STYLE` string and DOM construction, the overlay (`overlay.className = 'sg-settings-overlay'`) and modal (`modal.className = 'sg-settings-modal'`) keep their existing classNames for their tab-specific layout, but ADD the shared classes so the dim/animation come from `tokens.css`:

```ts
  overlay.className = 'sg-settings-overlay sg-modal-overlay';
  modal.className = 'sg-settings-modal sg-modal';
```

Leave the existing `.sg-settings-*` rules intact (they layer width/tabs on top). This is additive — no behavior change beyond consistent dim/animation.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/dom/settings-unified-onsave.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/settings-unified.ts tests/dom/settings-unified-onsave.test.ts
git commit -m "feat(ui): forward LLM save through settings-unified; share modal primitives

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: game-ui — add the `onLLMConfigChange` callback + restyle the button

**Files:**
- Modify: `src/game/game-ui.ts` (`GameUiCallbacks`, the `createUnifiedSettings` call, the `⚙ LLM` button)

No new test — this is callback plumbing verified by Task 10's wiring and the full suite. Keep it mechanical.

- [ ] **Step 1: Add the callback to the bag**

In `interface GameUiCallbacks`, add (import the type at top: `import type { ProviderConfig } from '@/llm/provider-factory';`):

```ts
  onLLMConfigChange: (config: ProviderConfig) => void;
```

- [ ] **Step 2: Forward it in the `createUnifiedSettings` call**

Replace the placeholder handler (lines ~95-98):

```ts
      onLLMConfigChange: (config) => cb.onLLMConfigChange(config),
```

- [ ] **Step 3: Restyle the `⚙ LLM` button with the design system**

Replace the inline `cssText` (lines ~145-149) so it uses `.sg-btn--ghost` and positions via a small inline style:

```ts
    this.llmSettingsBtn.className = 'sg-btn sg-btn--ghost';
    this.llmSettingsBtn.style.cssText = 'position:absolute;bottom:8px;left:8px;z-index:10;';
```

- [ ] **Step 4: Build to verify types**

Run: `npm run build`
Expected: build FAILS only at `game.ts` (it doesn't yet pass `onLLMConfigChange` into `new GameUi(...)`). That's expected — Task 10 supplies it. If any OTHER file errors, fix it here.

> Because `GameUiCallbacks` now requires `onLLMConfigChange`, `game.ts` won't compile until Task 10. Do not commit a broken build alone — **commit Task 8 together with Task 10** (see Task 10 Step 7). Mark this task done but leave it uncommitted.

---

## Task 9: Welcome modal

**Files:**
- Create: `src/ui/welcome-modal.ts`
- Create: `tests/dom/welcome-modal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dom/welcome-modal.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWelcomeModal, ONBOARDED_KEY } from '@/ui/welcome-modal';

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

function getBtn(root: HTMLElement, label: string) {
  return [...root.querySelectorAll('button')].find(b => b.textContent === label) as HTMLButtonElement;
}

describe('welcome modal', () => {
  it('renders a key field, a model select, and two buttons', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    createWelcomeModal(c, { onComplete: () => {} });
    expect(c.querySelector('input[type="password"]')).toBeTruthy();
    expect(c.querySelector('select')).toBeTruthy();
    expect(getBtn(c, 'Begin')).toBeTruthy();
    expect(getBtn(c, 'Skip — no AI')).toBeTruthy();
  });

  it('Skip persists mock + onboarded flag and calls onComplete', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    const onComplete = vi.fn();
    createWelcomeModal(c, { onComplete });
    getBtn(c, 'Skip — no AI').click();
    expect(JSON.parse(localStorage.getItem('small-gods-llm-provider')!).type).toBe('mock');
    expect(localStorage.getItem(ONBOARDED_KEY)).toBe('true');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].type).toBe('mock');
  });

  it('Begin with a key persists openrouter + the key and calls onComplete', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    const onComplete = vi.fn();
    createWelcomeModal(c, { onComplete });
    (c.querySelector('input[type="password"]') as HTMLInputElement).value = 'sk-or-begin';
    getBtn(c, 'Begin').click();
    const saved = JSON.parse(localStorage.getItem('small-gods-llm-provider')!);
    expect(saved.type).toBe('openrouter');
    expect(saved.openrouterApiKey).toBe('sk-or-begin');
    expect(localStorage.getItem(ONBOARDED_KEY)).toBe('true');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('Begin with a blank key does not save or complete', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    const onComplete = vi.fn();
    createWelcomeModal(c, { onComplete });
    getBtn(c, 'Begin').click();
    expect(localStorage.getItem('small-gods-llm-provider')).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dom/welcome-modal.test.ts`
Expected: FAIL — `Cannot find module '@/ui/welcome-modal'`.

- [ ] **Step 3: Create the modal**

Create `src/ui/welcome-modal.ts`:

```ts
import { saveProviderConfig, type ProviderConfig } from '@/llm/provider-factory';

export const ONBOARDED_KEY = 'small-gods-llm-onboarded';

const FAST_MODELS = [
  { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite (recommended)' },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash (cheapest)' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
];
const DEFAULT_CAPABLE = 'anthropic/claude-sonnet-4.6';

export interface WelcomeModalDeps {
  onComplete: (config: ProviderConfig) => void;
}

export interface WelcomeModalHandle {
  destroy(): void;
}

export function createWelcomeModal(container: HTMLElement, deps: WelcomeModalDeps): WelcomeModalHandle {
  const overlay = document.createElement('div');
  overlay.className = 'sg-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'sg-modal';
  overlay.appendChild(modal);

  const title = document.createElement('h2');
  title.className = 'sg-modal__title';
  title.textContent = 'Welcome, small god';
  modal.appendChild(title);

  const body = document.createElement('p');
  body.className = 'sg-modal__body';
  body.textContent = 'Add an OpenRouter key to bring your world to life with living narration — or skip and play with placeholder text.';
  modal.appendChild(body);

  const fields = document.createElement('div');
  fields.className = 'sg-modal__fields';
  modal.appendChild(fields);

  // Key field + "Get a key" link
  const keyField = document.createElement('div');
  keyField.className = 'sg-field';
  const keyLabel = document.createElement('div');
  keyLabel.className = 'sg-field__label';
  keyLabel.textContent = 'OpenRouter API key';
  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.placeholder = 'sk-or-...';
  keyInput.className = 'sg-input';
  const getKey = document.createElement('a');
  getKey.className = 'sg-link';
  getKey.textContent = 'Get a key ↗';
  getKey.href = 'https://openrouter.ai/keys';
  getKey.target = '_blank';
  getKey.rel = 'noopener';
  keyField.append(keyLabel, keyInput, getKey);
  fields.appendChild(keyField);

  // Model select
  const modelField = document.createElement('div');
  modelField.className = 'sg-field';
  const modelLabel = document.createElement('div');
  modelLabel.className = 'sg-field__label';
  modelLabel.textContent = 'Model';
  const modelSelect = document.createElement('select');
  modelSelect.className = 'sg-select';
  for (const m of FAST_MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id; opt.textContent = m.name;
    modelSelect.appendChild(opt);
  }
  modelField.append(modelLabel, modelSelect);
  fields.appendChild(modelField);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'sg-modal__actions';
  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'sg-btn sg-btn--ghost';
  skipBtn.textContent = 'Skip — no AI';
  const beginBtn = document.createElement('button');
  beginBtn.type = 'button';
  beginBtn.className = 'sg-btn sg-btn--primary';
  beginBtn.textContent = 'Begin';
  actions.append(skipBtn, beginBtn);
  modal.appendChild(actions);

  function finish(config: ProviderConfig) {
    saveProviderConfig(config);
    localStorage.setItem(ONBOARDED_KEY, 'true');
    deps.onComplete(config);
    destroy();
  }

  skipBtn.addEventListener('click', () => finish({ type: 'mock' }));
  beginBtn.addEventListener('click', () => {
    const key = keyInput.value.trim();
    if (!key) { keyInput.style.borderColor = 'var(--danger)'; keyInput.focus(); return; }
    finish({
      type: 'openrouter',
      openrouterApiKey: key,
      openrouterModel: modelSelect.value,
      openrouterModelCapable: DEFAULT_CAPABLE,
      maxTokens: 200,
      temperature: 0.7,
    });
  });

  function destroy() { overlay.remove(); }

  container.appendChild(overlay);
  return { destroy };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/dom/welcome-modal.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/welcome-modal.ts tests/dom/welcome-modal.test.ts
git commit -m "feat(ui): first-run welcome modal (key + model, Begin / Skip)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: game.ts — live-apply, capable client, mount the modal

**Files:**
- Modify: `src/game.ts`
- (Commit together with Task 8's uncommitted `game-ui.ts` changes.)

No isolated unit test (constructing `Game` needs a container/canvas/world). Verified by `npm run build` + the full suite + the welcome/settings DOM tests. Manual smoke check noted at the end.

- [ ] **Step 1: Add imports + the capable client field**

In `src/game.ts`, extend the provider-factory import (line 9) to include `ProviderConfig`, and add the welcome-modal import:

```ts
import { createProvider, loadProviderConfig, type ProviderConfig } from '@/llm/provider-factory';
import { createWelcomeModal, type WelcomeModalHandle, ONBOARDED_KEY } from '@/ui/welcome-modal';
```

Add fields near `private llmClient!: LLMClient;` (line ~64):

```ts
  private llmClientCapable: LLMClient | null = null;   // Tier-2 "key moments" — built, not yet called (Track 4 / Fate)
  private welcomeModal: WelcomeModalHandle | null = null;
```

- [ ] **Step 2: Add the `applyLlmConfig` method**

Add this private method to the `Game` class (place it near the other private helpers, e.g. after the constructor):

```ts
  private applyLlmConfig(config: ProviderConfig): void {
    try {
      this.llmClient = new LLMClient(createProvider(config));
      this.llmBackfill.setClient(this.llmClient);
      this.llmClientCapable = config.openrouterModelCapable
        ? new LLMClient(createProvider({ ...config, openrouterModel: config.openrouterModelCapable }))
        : null;
    } catch (err) {
      // Bad/missing key: keep the previous working client so the game never breaks.
      console.warn('[llm] config not applied:', err);
    }
  }
```

- [ ] **Step 3: Pass `onLLMConfigChange` into `new GameUi(...)`**

In the `new GameUi(this.container, { ... })` callbacks bag (around line 184, alongside `onGameSettingChange`), add:

```ts
      onLLMConfigChange: (config) => this.applyLlmConfig(config),
```

- [ ] **Step 4: Mount the welcome modal on first run**

After the UI and `llmBackfill` are constructed (after the `this.llmBackfill = new LlmBackfillService({...})` block, ~line 183), add:

```ts
    if (!localStorage.getItem(ONBOARDED_KEY)) {
      this.welcomeModal = createWelcomeModal(this.container, {
        onComplete: (config) => { this.applyLlmConfig(config); this.welcomeModal = null; },
      });
    }
```

- [ ] **Step 5: Dispose the modal in teardown**

Find the `Game` teardown/`destroy` path (where `this.ui.destroy()` / `this.cleanup*` run) and add:

```ts
    this.welcomeModal?.destroy();
```

- [ ] **Step 6: Build + full suite**

Run: `npm run build`
Expected: build clean (Task 8's `game-ui.ts` requirement is now satisfied).

Run: `npm test`
Expected: all tests pass (prior 880 + the new filter/config/backfill/llm-settings/settings-unified/welcome tests). No regressions.

- [ ] **Step 7: Commit (game-ui.ts + game.ts together)**

```bash
git add src/game/game-ui.ts src/game.ts
git commit -m "feat(game): live-apply LLM config, capable client seam, mount welcome modal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Manual smoke check (note for the human)**

`npm run dev`, open the game in a fresh profile (or clear localStorage): the welcome modal appears. **Skip** dismisses it and play continues (mock). Reload: modal does not reappear. Open `⚙ LLM`, paste a key, pick DeepSeek V4 Flash, Save — narration should work without `｜DSML｜` artifacts and without a reload.

---

## Task 11: CLAUDE.md note (already done — verify only)

The stale "LLM backfill is stubbed" gotcha was corrected earlier this session (commit `9dc075a`). 

- [ ] **Step 1: Verify the correction is present**

Run: `grep -n "uses the configured provider" CLAUDE.md`
Expected: a match (the corrected gotcha). If absent, re-apply the correction per the spec's "Documentation" section. No commit needed if already present.

---

## Self-Review notes (for the executor)

- **Spec coverage:** §0 dialog UX → Tasks 5/6/9 (clean fields, Advanced disclosure, minimal modal); §0.5 primitives → Task 1; §1 config → Task 3; §2 catalog/dropdowns/custom → Tasks 5/6; §3 live-apply → Tasks 4/8/10; §4 filter → Task 2; §5 welcome modal → Task 9; §6 tests → Tasks 2/3/5/6/7/9; docs → Task 11.
- **Type consistency:** `ProviderConfig` is the single config type threaded through `createLLMSettings({onSave})` → `SettingsOptions.onLLMConfigChange` → `GameUiCallbacks.onLLMConfigChange` → `Game.applyLlmConfig`. `ONBOARDED_KEY` is exported from `welcome-modal.ts` and imported by `game.ts`. `setClient` matches between Task 4 and Task 10.
- **Cross-task build gap:** Task 8 intentionally leaves the build red (GameUiCallbacks gains a required field) until Task 10 supplies it; they commit together (Task 10 Step 7). The two-stage review for Task 8 should review code without requiring a green standalone build; the green build is verified at Task 10 Step 6.
```
