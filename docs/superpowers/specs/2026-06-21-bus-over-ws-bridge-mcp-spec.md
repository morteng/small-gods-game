# Bus-over-WebSocket Bridge + MCP Server — Spec

**Status**: Shipped (Layer 1 + 2a + 2b)
**Date**: 2026-06-21
**Epic**: [[project-webgpu-ui-mcp-integration]] — the "MCP-into-running-game" slice

## Problem

`GameBus` (the S0 command/query seam — `src/game/game-bus.ts`) was built as "the one
seam both the WebGPU UI and the future MCP bridge consume," but it lives in the
**browser tab's JS heap**. An out-of-process consumer (a CLI, an MCP server, an
MCP-UI host, an agent) had no way to reach it — only `playwright + window.__bus`
eval, which is screen-scrape-flavored and Playwright-specific.

## Decision: transport-first, one wire, two heads

The keystone is getting `GameBus` **out of the heap over a neutral wire**. Build
that once; the dev-CLI case and the MCP-product case are thin adapters on top. We
do **not** build an MCP server that drives the browser via CDP (that just
re-implements Playwright). We publish the bus over WebSocket and wrap it.

```
 browser tab                         Vite dev server (Node)            consumers
 ┌───────────────────┐   ws /__bus   ┌───────────────────┐
 │ GameBus (__bus)   │◄─────────────►│ broker (1 game,    │◄── bus-cli.ts (Layer 2a)
 │ bus-bridge-client │   game peer   │  N clients; relay) │◄── mcp-server.ts (Layer 2b)
 └───────────────────┘               └───────────────────┘◄── any MCP client / MCP-UI host
```

**Hard rule:** this is a DEV observability + control channel. Fate and the WebGPU
UI still call `GameBus` **in-process** and must never round-trip through here.

## Wire protocol (`src/dev/bus-bridge-protocol.ts`)

JSON frames over one WebSocket. `hello` declares role; the broker is a dumb relay
keyed by role (it never parses payloads). The **game peer** does all dispatch.

| Frame | Direction | Shape |
|-------|-----------|-------|
| `hello`  | peer → broker  | `{ t:'hello', role:'game'\|'client' }` |
| `req`    | client → game  | `{ t:'req', id, method, params? }` |
| `res`    | game → client  | `{ t:'res', id, ok, result\|error }` |
| `event`  | game → clients | `{ t:'event', event }` (broadcast; from `bus.subscribe`) |
| `status` | broker → client| `{ t:'status', gameConnected }` |

**Methods** (pure dispatcher `dispatchBus`, unit-tested against a mock bus):
`ping`, `capabilities`, `query` (`{fn,args}` → `bus.query[fn](...args)`),
`preview` (`{cmd}`), `emit` (`{cmd}`; **rejected unless the page is read-write**).

## Components

- **`src/dev/bus-bridge-protocol.ts`** — framework-free types + `dispatchBus`. No
  DOM / `ws` / MCP imports, so it's shared by the page client, the Node client,
  and tests.
- **`vite-plugins/bus-bridge.ts`** — dev-only (`apply:'serve'`) WS broker mounted
  on the existing Vite HTTP server via an `upgrade` listener scoped to `/__bus`
  (coexists with Vite HMR's socket). Loopback-only. One game peer (last writer
  wins) + N clients. Fails in-flight reqs if the game disconnects.
- **`src/dev/bus-bridge-client.ts`** — the game peer. Loaded **lazily from
  `main.ts` only when `?bridge` is present**, so it's inert + code-split out of
  the prod hot path by default. `?bridge` = read-only; `?bridge=rw` = allow
  `emit`. Auto-reconnects across HMR / broker restarts.
- **`tools/bus-client.ts`** — Node `client` peer (promise-based; global
  `WebSocket`, no client dep). Shared by the CLI + MCP server.
- **`tools/bus-cli.ts`** (Layer 2a) — smoke CLI. `npm run bus -- <ping|
  capabilities|query <fn> [args…]|preview <json>|emit <json>|watch>`.
- **`tools/mcp-server.ts`** (Layer 2b) — stdio MCP server. 14 tools: read tools
  (world_summary, list_npcs, get_npc, belief_state, belief_powers, divine_inbox,
  settlement, timeline, recent_events, list_spirits, capabilities, screenshot →
  PNG image block) + write tools (preview_command, emit_command). The
  `emit_command` verb vocabulary is discoverable via the `capabilities` tool —
  one source of truth (`src/sim/command/registry.ts`), never hand-maintained.
  Registered in `.mcp.json` as `small-gods`; connects to the broker lazily on the
  first tool call. `npm run mcp`.

## Security

Dev-only (`apply:'serve'`, lazy page load behind a flag). Broker is loopback-only.
Writes gated by `?bridge=rw`. The bus already enforces tier/capability/power
gating + deterministic replay regardless of who emits, so the bridge adds no new
trust surface beyond "can a localhost process reach the tab."

## Verification (2026-06-21, live)

End-to-end against a running dev server + a `?bridge=rw` tab:
- CLI: `ping`→pong, `capabilities`→20 verbs, `query worldSummary`→live data
  (`tick` advancing proves it reads the running sim), `preview`→null,
  `emit whisper`→accepted, `watch`→received live `whisper` event frames.
- MCP: client handshake lists all 14 tools; `world_summary` + `capabilities`
  return live data through the full chain (MCP client → server → BusClient →
  broker → page → GameBus).
- Build clean; `bus-bridge-client` is a 1.76 kB lazy chunk; no `ws`/MCP in the
  client bundle. `dispatchBus` unit test: 10 cases.

## Deferred / next

- **Authoring/editor-tier writes** — `emit_command` reaches them, but their
  executors are still partial (Fate cycle). No bridge change needed.
- **MCP-UI host** — the same broker serves it; a browser-WS client instead of
  stdio. Not yet wired.
- **Resources/prompts** — expose `query` snapshots as MCP *resources* (not just
  tools) so hosts can subscribe; expose canned analysis prompts.
- **Multi-game** — broker is single-game (last writer wins). A keyed registry
  would let one broker front several tabs.
