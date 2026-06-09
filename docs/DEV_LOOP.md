# Dev Loop — driving & debugging the running game

Tools for closing the loop on the *live* game (worldgen, building geometry, LLM
narration), not just unit tests. A canvas game needs to be looked at.

## 1. `window.__debug` — stable debug surface

`main.ts` exposes `window.__debug` (a `DebugApi`, see `src/dev/debug-api.ts`).
Prefer it over poking `__game`'s private internals — it survives refactors.

```js
__debug.inventory()              // { world, map, buildings, byKind, npcs, vegetation }
__debug.query({ kind: 'tavern' })// raw World.query passthrough
__debug.focusKind('cottage', 4)  // center + zoom the camera on the first cottage
__debug.focusXY(40, 30, 3)       // center + zoom on a tile
__debug.fitMap()                 // fit the whole map
__debug.grab()                   // → PNG data URL of the current frame
```

The fastest visual check is `__debug.focusKind('yurt'); __debug.grab()`.

## 2. Scripted captures — `scripts/e2e-smoke.mjs`

```bash
npm run dev                         # terminal 1 (port 3000)
node scripts/e2e-smoke.mjs          # headless; PNGs → tmp/e2e/
HEADED=1 node scripts/e2e-smoke.mjs # watch it
KINDS=cottage,tavern node scripts/e2e-smoke.mjs
```

**Capture via `__game.canvas.toDataURL()` (what `__debug.grab()` does), NOT
Playwright `page.screenshot()`** — the latter *stalls* on the continuous-rAF
canvas in headed mode. To force a fresh world, the script deletes IndexedDB then
reloads (the autosave restores the prior world otherwise).

## 3. Interactive — Playwright MCP

`.mcp.json` registers `@playwright/mcp`. **Restart the session** to load it. Then
the assistant can drive a headed browser live (navigate / click / evaluate),
calling `__debug` verbs via `browser_evaluate`. Capture with
`browser_evaluate(() => window.__debug.grab())` — again, avoid the MCP's own
screenshot on this canvas.

## 4. LLM narration in dev — same-origin proxy

The browser cannot call `https://openrouter.ai` directly (CORS / `net::ERR_FAILED`).
The dev-only Vite plugin `vite-plugins/llm-proxy.ts` mounts `/api/llm/openrouter`
and forwards server-side. In dev, `provider-factory` points the OpenRouter client
at this proxy automatically; the proxy injects `OPENROUTER_API_KEY` from `.env`
when the browser sends none — so narration **just works locally** without a
browser-configured key. Trigger it: `await __game.llmBackfill.trigger(npc)`.

Production is unaffected (`apply: 'serve'`); there the client calls OpenRouter
directly with the player's BYOK key.
