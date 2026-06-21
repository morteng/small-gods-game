/**
 * Node-side bus client — the `client` peer of the bus-bridge broker.
 *
 * A thin promise-based wrapper over the WebSocket wire (see
 * `src/dev/bus-bridge-protocol.ts`) shared by the smoke CLI (`bus-cli.ts`) and
 * the MCP server (`mcp-server.ts`). Uses Node's global `WebSocket` (Node ≥ 21),
 * so it needs no extra client dependency.
 *
 * It connects to a running dev server's broker (`ws://localhost:3000/__bus` by
 * default) which relays to the browser tab opened with `?bridge`. Requests
 * reject if no game peer is attached or after a timeout, so callers fail fast
 * rather than hang.
 */
import { BRIDGE_PATH, type BridgeMethod, type Frame } from '../src/dev/bus-bridge-protocol';

export interface BusClientOpts {
  /** Dev server origin. Default ws://localhost:3000. */
  url?: string;
  /** Per-request timeout (ms). Default 10_000. */
  timeoutMs?: number;
}

export class BusClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly timeoutMs: number;
  private seq = 0;
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly eventHandlers = new Set<(event: unknown) => void>();
  private gameConnected = false;

  constructor(opts: BusClientOpts = {}) {
    const origin = opts.url ?? 'ws://localhost:3000';
    this.url = origin.replace(/\/$/, '') + BRIDGE_PATH;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** Open the socket and complete the `hello` handshake. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const onOpenFail = () => reject(new Error(`bus-client: cannot reach broker at ${this.url} (is the dev server running?)`));
      ws.addEventListener('error', onOpenFail, { once: true });
      ws.addEventListener('open', () => {
        ws.removeEventListener('error', onOpenFail);
        ws.send(JSON.stringify({ t: 'hello', role: 'client' }));
        resolve();
      });
      ws.addEventListener('message', (ev) => this.onMessage(String((ev as MessageEvent).data)));
      ws.addEventListener('close', () => {
        for (const { reject: rej, timer } of this.pending.values()) { clearTimeout(timer); rej(new Error('bus-client: connection closed')); }
        this.pending.clear();
      });
    });
  }

  private onMessage(data: string): void {
    let frame: Frame;
    try { frame = JSON.parse(data); } catch { return; }
    if (frame.t === 'res') {
      const p = this.pending.get(frame.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(frame.id);
      if (frame.ok) p.resolve(frame.result);
      else p.reject(new Error(frame.error));
    } else if (frame.t === 'event') {
      for (const h of this.eventHandlers) h(frame.event);
    } else if (frame.t === 'status') {
      this.gameConnected = frame.gameConnected;
    }
  }

  /** Whether a game peer is currently attached to the broker. */
  isGameConnected(): boolean { return this.gameConnected; }

  /** Invoke a bus method and await its result. */
  request(method: BridgeMethod, params?: unknown): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== ws.OPEN) return Promise.reject(new Error('bus-client: not connected'));
    const id = `c${this.seq++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`bus-client: request '${method}' timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ t: 'req', id, method, params }));
    });
  }

  // ── Convenience wrappers ───────────────────────────────────────────────────
  ping(): Promise<unknown> { return this.request('ping'); }
  capabilities(): Promise<unknown> { return this.request('capabilities'); }
  query(fn: string, ...args: unknown[]): Promise<unknown> { return this.request('query', { fn, args }); }
  preview(cmd: unknown): Promise<unknown> { return this.request('preview', { cmd }); }
  emit(cmd: unknown): Promise<unknown> { return this.request('emit', { cmd }); }

  onEvent(handler: (event: unknown) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  close(): void { this.ws?.close(); }
}
