import type { Plugin } from 'vite';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * Bus-bridge broker — a DEV-ONLY WebSocket broker that carries a running game's
 * `GameBus` seam out of the browser heap so an out-of-process consumer (the CLI
 * in `tools/bus-cli.ts`, the MCP server in `tools/mcp-server.ts`, or any MCP-UI
 * host) can drive and inspect it.
 *
 * Topology (see `src/dev/bus-bridge-protocol.ts` for the wire contract): the
 * broker accepts ONE `game` peer (the browser tab, via `bus-bridge-client.ts`)
 * and N `client` peers. It is a dumb relay — it neither parses nor validates
 * `req`/`res` payloads, only routes them by role:
 *   - a `client`'s `req`  → forwarded to the game peer
 *   - the game's `res`    → forwarded to whichever client owns that `req` id
 *   - the game's `event`  → broadcast to every client
 * The game peer does all dispatch/validation/gating against its live bus.
 *
 * Mounted on the existing Vite HTTP server via an `upgrade` listener scoped to
 * `BRIDGE_PATH`, so it shares the dev port and never collides with Vite's HMR
 * socket (that listener ignores any path but its own). `apply: 'serve'` keeps it
 * out of the production build entirely.
 */

const BRIDGE_PATH = '/__bus';

/** Loopback-only guard: the broker is a control channel, never expose it off-box. */
function isLocalHost(req: IncomingMessage): boolean {
  const host = String(req.headers['host'] ?? '');
  return /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(host);
}

export function busBridgePlugin(): Plugin {
  return {
    name: 'bus-bridge',
    apply: 'serve',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      /** The single attached game peer, or null when no tab has `?bridge`. */
      let game: WebSocket | null = null;
      const clients = new Set<WebSocket>();
      /** req id → the client socket that issued it, so a `res` routes back to one
       *  client rather than broadcasting. */
      const pending = new Map<string, WebSocket>();

      function send(sock: WebSocket, frame: unknown): void {
        if (sock.readyState === sock.OPEN) sock.send(JSON.stringify(frame));
      }
      function broadcastStatus(): void {
        for (const c of clients) send(c, { t: 'status', gameConnected: game !== null });
      }

      wss.on('connection', (sock: WebSocket) => {
        let role: 'game' | 'client' | null = null;

        sock.on('message', (data) => {
          let frame: any;
          try { frame = JSON.parse(String(data)); } catch { return; }

          // First frame must declare the role.
          if (role === null) {
            if (frame?.t !== 'hello' || (frame.role !== 'game' && frame.role !== 'client')) {
              send(sock, { t: 'res', id: frame?.id ?? '', ok: false, error: 'expected hello frame' });
              sock.close();
              return;
            }
            role = frame.role;
            if (role === 'game') {
              // Last writer wins: a fresh tab supersedes a stale one.
              if (game && game !== sock) game.close();
              game = sock;
            } else {
              clients.add(sock);
              send(sock, { t: 'status', gameConnected: game !== null });
            }
            broadcastStatus();
            return;
          }

          if (role === 'client') {
            if (frame?.t !== 'req') return;
            if (!game) {
              send(sock, { t: 'res', id: frame.id, ok: false, error: 'no game peer attached (open the game with ?bridge)' });
              return;
            }
            pending.set(frame.id, sock);
            send(game, frame);
            return;
          }

          // role === 'game'
          if (frame?.t === 'res') {
            const client = pending.get(frame.id);
            pending.delete(frame.id);
            if (client) send(client, frame);
          } else if (frame?.t === 'event') {
            for (const c of clients) send(c, frame);
          }
        });

        sock.on('close', () => {
          if (role === 'game' && game === sock) {
            game = null;
            // Fail any in-flight requests so clients don't hang.
            for (const [id, client] of pending) send(client, { t: 'res', id, ok: false, error: 'game peer disconnected' });
            pending.clear();
            broadcastStatus();
          } else if (role === 'client') {
            clients.delete(sock);
            for (const [id, c] of pending) if (c === sock) pending.delete(id);
          }
        });

        sock.on('error', () => { /* close handler does the cleanup */ });
      });

      server.httpServer?.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        let path = '';
        try { path = new URL(req.url ?? '', 'http://localhost').pathname; } catch { return; }
        if (path !== BRIDGE_PATH) return; // not ours — let Vite's HMR listener handle it
        if (!isLocalHost(req)) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      });

      server.httpServer?.once('close', () => wss.close());
    },
  };
}
