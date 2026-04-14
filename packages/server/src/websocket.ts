/**
 * WebSocket server — real-time event broadcasting for the Hipp0 dashboard.
 *
 * Usage:
 *   import { initWebSocket, broadcast } from './websocket.js';
 *   initWebSocket(httpServer);
 *   broadcast('decision_created', { id: '...' }, tenantId);
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@hipp0/core/db/index.js';

let wss: WebSocketServer | null = null;

// Track tenant_id per connected client
const clientTenants = new WeakMap<WebSocket, string>();

/** Return the WebSocketServer instance (call after initWebSocket). */
export function getMainWss(): WebSocketServer | null {
  return wss;
}

async function authenticateWsToken(token: string): Promise<string | null> {
  if (!token) return null;
  try {
    if (token.startsWith('h0_live_') || token.startsWith('h0_test_')) {
      const hash = createHash('sha256').update(token).digest('hex');
      const db = getDb();
      const result = await db.query(
        'SELECT tenant_id FROM api_keys WHERE key_hash = ? AND (expires_at IS NULL OR expires_at > NOW())',
        [hash],
      );
      if (result.rows.length > 0) {
        return (result.rows[0] as Record<string, unknown>).tenant_id as string;
      }
    }
  } catch {
    // Auth failure
  }
  return null;
}

export function initWebSocket(): void {
  // noServer mode — the HTTP upgrade event is handled in index.ts
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (ws, req) => {
    const connectionId = randomUUID();

    // Authenticate: require valid API key via ?token= query param or Sec-WebSocket-Protocol
    const url = new URL(req.url ?? '', 'ws://localhost');
    const token = url.searchParams.get('token') ?? req.headers['sec-websocket-protocol'] ?? '';

    const tenantId = await authenticateWsToken(token);
    if (!tenantId) {
      ws.close(4001, 'Authentication required');
      return;
    }

    clientTenants.set(ws, tenantId);

    // Send welcome message
    ws.send(JSON.stringify({
      event: 'connected',
      data: { connection_id: connectionId, timestamp: new Date().toISOString() },
    }));

    ws.on('error', (err) => {
      console.warn('[hipp0/ws] Client error:', err.message);
    });

    ws.on('close', () => {
      // Client disconnected — nothing to clean up
    });
  });

  console.warn('[hipp0] WebSocket server ready on /ws (noServer mode)');
}

// Drop payloads for clients whose outbound buffer exceeds this size — the
// slow consumer is starving the event loop and would grow the buffer
// unbounded if we kept enqueueing. 1 MiB is generous for typical
// dashboard events (a few KB each).
const WS_BACKPRESSURE_DROP_BYTES = 1024 * 1024;

export function broadcast(event: string, data: unknown, tenantId?: string): void {
  if (!wss) return;

  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });

  // Collect eligible clients first, then fan out with Promise.all. The
  // previous sequential loop blocked per-client on socket writes; with
  // Promise.all, Node's internal write scheduler can parallelize across
  // TCP streams and a slow peer no longer holds up the rest.
  const sends: Promise<void>[] = [];
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (tenantId) {
      const clientTenant = clientTenants.get(client);
      if (clientTenant !== tenantId) continue;
    }
    if (client.bufferedAmount > WS_BACKPRESSURE_DROP_BYTES) {
      console.warn(
        `[hipp0/ws] Dropping broadcast for slow client — bufferedAmount=${client.bufferedAmount} event=${event}`,
      );
      continue;
    }
    sends.push(
      new Promise<void>((resolve) => {
        client.send(message, (err) => {
          if (err) console.warn('[hipp0/ws] send error:', err.message);
          resolve();
        });
      }),
    );
  }

  // Fire-and-forget — broadcast callers don't await. Any per-send errors
  // are already logged inside the Promise wrapper.
  void Promise.all(sends);
}
