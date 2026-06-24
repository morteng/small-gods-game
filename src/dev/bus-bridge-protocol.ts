/**
 * Bus-bridge protocol — the framework-free wire contract + dispatcher shared by
 * the page-side bridge client (`bus-bridge-client.ts`), the Node clients
 * (`tools/bus-client.ts`), and the unit tests.
 *
 * It carries the EXISTING `GameBus` seam (emit/preview/capabilities/query/
 * subscribe — see `src/game/game-bus.ts`) out of the browser heap over a neutral
 * JSON-over-WebSocket wire so an out-of-process consumer (a CLI, an MCP server,
 * an MCP-UI host) can drive and inspect a running game. It is a DEV/observability
 * + control channel only: Fate and the WebGPU UI still call `GameBus` in-process
 * and must never round-trip through here.
 *
 * Topology: a broker (the Vite dev plugin) brokers ONE `game` peer (the browser
 * tab) and N `client` peers. Clients send `req` frames; the broker forwards them
 * to the game peer, which dispatches against its live bus and replies with a
 * `res` frame; the game peer also pushes `event` frames (from `bus.subscribe`)
 * that the broker fans out to every client.
 *
 * No DOM, no `ws`, no MCP imports here — pure types + a pure async dispatcher, so
 * it is unit-testable in Node against a mock bus.
 */

// ── Wire frames ──────────────────────────────────────────────────────────────

/** First frame a socket sends, declaring which side of the broker it is. */
export interface HelloFrame {
  t: 'hello';
  role: 'game' | 'client';
}

/** Client → broker → game: invoke a bus method. `id` correlates the response. */
export interface ReqFrame {
  t: 'req';
  id: string;
  method: BridgeMethod;
  params?: unknown;
}

/** Game → broker → client: the result of a `req`. */
export type ResFrame =
  | { t: 'res'; id: string; ok: true; result: unknown }
  | { t: 'res'; id: string; ok: false; error: string };

/** Game → broker → all clients: a sim event appended to the EventLog. */
export interface EventFrame {
  t: 'event';
  event: unknown;
}

/** Broker → client (informational): whether a game peer is currently attached. */
export interface StatusFrame {
  t: 'status';
  gameConnected: boolean;
}

export type Frame = HelloFrame | ReqFrame | ResFrame | EventFrame | StatusFrame;

// ── Methods ──────────────────────────────────────────────────────────────────

export type BridgeMethod =
  | 'ping'
  | 'capabilities'
  | 'query'
  | 'preview'
  | 'emit';

/** The slice of `GameBus` the dispatcher needs. Structural, so a mock satisfies
 *  it in tests and the real bus satisfies it in the browser. `query` is typed
 *  `any` because it's a dynamic by-name dispatch surface (`GameQuery` is an
 *  interface, which TS won't assign to a `Record<string, fn>` target). */
export interface BusLike {
  query: any;
  capabilities(): unknown;
  preview(cmd: unknown): unknown;
  emit(cmd: unknown): void;
}

export interface DispatchOpts {
  /** When false, `emit` is rejected (read-only bridge). */
  allowWrite: boolean;
}

/**
 * Pure dispatch of one bridge method against a bus. Throws on unknown method /
 * unknown query fn / a write to a read-only bridge; the caller turns a throw into
 * an `ok:false` `ResFrame`. Returns the (JSON-serializable) result.
 */
export async function dispatchBus(
  bus: BusLike,
  method: BridgeMethod,
  params: unknown,
  opts: DispatchOpts,
): Promise<unknown> {
  switch (method) {
    case 'ping':
      return 'pong';

    case 'capabilities':
      return bus.capabilities();

    case 'query': {
      const { fn, args } = (params ?? {}) as { fn?: string; args?: unknown[] };
      if (!fn) throw new Error('query requires { fn }');
      const f = bus.query[fn];
      if (typeof f !== 'function') throw new Error(`unknown query fn: ${fn}`);
      return f.apply(bus.query, args ?? []);
    }

    case 'preview': {
      const { cmd } = (params ?? {}) as { cmd?: unknown };
      if (!cmd) throw new Error('preview requires { cmd }');
      return bus.preview(cmd);
    }

    case 'emit': {
      if (!opts.allowWrite) throw new Error('bridge is read-only (start the page with ?bridge=rw)');
      const { cmd } = (params ?? {}) as { cmd?: unknown };
      if (!cmd) throw new Error('emit requires { cmd }');
      bus.emit(cmd);
      return { accepted: true };
    }

    default:
      throw new Error(`unknown method: ${method}`);
  }
}

/** The broker path on the dev server. */
export const BRIDGE_PATH = '/__bus';
