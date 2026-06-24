/**
 * Page-side bus bridge — the `game` peer of the bus-bridge broker.
 *
 * When the game is opened with `?bridge` (read-only) or `?bridge=rw` (writes
 * allowed), this connects to the dev broker on `BRIDGE_PATH`, dispatches incoming
 * `req` frames against the live `GameBus` (`window.__bus`) via the shared pure
 * `dispatchBus`, and streams `bus.subscribe` events back out as `event` frames.
 *
 * DEV ONLY. It is loaded lazily from `main.ts` solely when the flag is present,
 * so it never ships in the production bundle's hot path and is inert by default.
 * Auto-reconnects so a Vite HMR reload or a broker restart re-attaches.
 */
import {
  dispatchBus,
  BRIDGE_PATH,
  type BusLike,
  type ReqFrame,
} from './bus-bridge-protocol';

export interface BridgeClientOpts {
  bus: BusLike & { subscribe(fn: (e: unknown) => void): () => void };
  /** Allow `emit` (state mutation). Driven by `?bridge=rw`. */
  allowWrite: boolean;
}

/** Read the `?bridge` flag. Returns null when absent (the common case). */
export function readBridgeFlag(search: string): { allowWrite: boolean } | null {
  const params = new URLSearchParams(search);
  if (!params.has('bridge')) return null;
  return { allowWrite: params.get('bridge') === 'rw' };
}

export function startBridgeClient(opts: BridgeClientOpts): void {
  const { bus, allowWrite } = opts;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${BRIDGE_PATH}`;
  let unsubscribe: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect(): void {
    const ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ t: 'hello', role: 'game' }));
      // eslint-disable-next-line no-console
      console.info(`[bus-bridge] attached (${allowWrite ? 'read-write' : 'read-only'})`);
      unsubscribe = bus.subscribe((event) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'event', event }));
      });
    });

    ws.addEventListener('message', async (ev) => {
      let frame: ReqFrame;
      try { frame = JSON.parse(String(ev.data)); } catch { return; }
      if (frame?.t !== 'req') return;
      try {
        const result = await dispatchBus(bus, frame.method, frame.params, { allowWrite });
        ws.send(JSON.stringify({ t: 'res', id: frame.id, ok: true, result }));
      } catch (e) {
        ws.send(JSON.stringify({ t: 'res', id: frame.id, ok: false, error: (e as Error).message }));
      }
    });

    const onDown = () => {
      unsubscribe?.(); unsubscribe = null;
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 1000);
    };
    ws.addEventListener('close', onDown);
    ws.addEventListener('error', () => ws.close());
  }

  connect();
}
