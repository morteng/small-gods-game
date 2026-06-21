#!/usr/bin/env -S npx tsx
/**
 * bus-cli — Layer 2a smoke client for the bus bridge.
 *
 * Drives a running game from the terminal through the dev broker. Prove-it tool
 * and a handy debugging porthole; the MCP server (`mcp-server.ts`) is the durable
 * surface. Requires `npm run dev` running AND the game open with `?bridge`
 * (read-only) or `?bridge=rw` (to allow `emit`).
 *
 * Usage:
 *   npm run bus -- ping
 *   npm run bus -- capabilities
 *   npm run bus -- query worldSummary
 *   npm run bus -- query npc npc:1
 *   npm run bus -- query npcs                 # all npcs
 *   npm run bus -- preview '{"verb":"whisper","source":"player","target":{"kind":"none"},"seq":0}'
 *   npm run bus -- emit    '{"verb":"whisper","source":"player","target":{"kind":"none"},"seq":0}'
 *   npm run bus -- watch                       # stream sim events until Ctrl-C
 *
 * Env: BUS_URL overrides the broker origin (default ws://localhost:3000).
 */
import { BusClient } from './bus-client';

function print(v: unknown): void {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    process.stdout.write('usage: npm run bus -- <ping|capabilities|query <fn> [args…]|preview <json>|emit <json>|watch>\n');
    return cmd ? 0 : 1;
  }

  const client = new BusClient({ url: process.env.BUS_URL });
  await client.connect();

  try {
    switch (cmd) {
      case 'ping': print(await client.ping()); return 0;
      case 'capabilities': print(await client.capabilities()); return 0;
      case 'query': {
        const [fn, ...args] = rest;
        if (!fn) { process.stderr.write('query needs a fn name\n'); return 1; }
        // Best-effort: parse JSON args, else pass the raw string.
        const parsed = args.map((a) => { try { return JSON.parse(a); } catch { return a; } });
        print(await client.query(fn, ...parsed)); return 0;
      }
      case 'preview': { print(await client.preview(JSON.parse(rest[0] ?? '{}'))); return 0; }
      case 'emit': { print(await client.emit(JSON.parse(rest[0] ?? '{}'))); return 0; }
      case 'watch': {
        process.stderr.write('[bus-cli] watching sim events — Ctrl-C to stop\n');
        client.onEvent((e) => print(e));
        await new Promise(() => {}); // run until killed
        return 0;
      }
      default:
        process.stderr.write(`unknown command: ${cmd}\n`);
        return 1;
    }
  } finally {
    if (cmd !== 'watch') client.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => { process.stderr.write(`error: ${(err as Error).message}\n`); process.exit(1); },
);
