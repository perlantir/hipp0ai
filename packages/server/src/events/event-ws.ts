/**
 * Event Stream WebSocket server — exposes `/ws/events` for dashboards and
 * external tools to subscribe to a project's real-time memory events.
 *
 * Query parameters:
 *   project_id — the project to subscribe to
 *   api_key    — a valid API key that has access to that project
 *
 * On successful connection, the client receives:
 *   { type: 'connected', project_id, timestamp }
 *
 * Subsequent messages are MemoryEvent objects as they are emitted.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { getDb } from '@hipp0/core/db/index.js';
import {
  subscribeToProject,
  unsubscribeFromProject,
  getActiveSubscribers,
} from './event-stream.js';

let eventsWss: WebSocketServer | null = null;

/** Return the events WebSocketServer (call after initEventWebSocket). */
export function getEventsWss(): WebSocketServer | null {
  return eventsWss;
}

/**
 * Validate that the provided api_key has access to the given project_id.
 * Returns true when the key is valid and the project belongs to the same tenant.
 */
async function authenticateEventsRequest(
  projectId: string,
  apiKey: string,
): Promise<boolean> {
  if (!projectId || !apiKey) return false;
  try {
    const db = getDb();

    // Hash the api_key — matches how websocket.ts and auth middleware look up keys
    const hash = createHash('sha256').update(apiKey).digest('hex');
    const keyResult = await db.query(
      'SELECT tenant_id FROM api_keys WHERE key_hash = ? AND (expires_at IS NULL OR expires_at > NOW())',
      [hash],
    );
    if (keyResult.rows.length === 0) return false;
    const tenantId = (keyResult.rows[0] as Record<string, unknown>).tenant_id as string;

    // Verify the project exists. If the projects table has a tenant_id column,
    // also verify the project belongs to the same tenant as the API key.
    const projResult = await db.query(
      'SELECT id FROM projects WHERE id = ?',
      [projectId],
    );
    if (projResult.rows.length === 0) return false;

    // Best-effort tenant check — tolerate schemas that don't have tenant_id
    try {
      const scoped = await db.query(
        'SELECT id FROM projects WHERE id = ? AND tenant_id = ?',
        [projectId, tenantId],
      );
      if (scoped.rows.length === 0) return false;
    } catch {
      // Projects table might not have tenant_id column — allow through on key validity
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Initialise the `/ws/events` WebSocket server in noServer mode.
 * The HTTP upgrade is routed from index.ts based on the request URL.
 */
export function initEventWebSocket(): void {
  eventsWss = new WebSocketServer({ noServer: true });

  eventsWss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    let projectId = '';
    try {
      const url = new URL(req.url ?? '', 'ws://localhost');
      projectId = url.searchParams.get('project_id') ?? '';
      const apiKey = url.searchParams.get('api_key') ?? '';

      const ok = await authenticateEventsRequest(projectId, apiKey);
      if (!ok) {
        ws.close(4001, 'Authentication failed');
        return;
      }

      const subscribed = subscribeToProject(projectId, ws);
      if (!subscribed) {
        ws.close(4002, 'Project subscriber limit reached');
        return;
      }

      // Welcome message
      ws.send(
        JSON.stringify({
          type: 'connected',
          project_id: projectId,
          timestamp: new Date().toISOString(),
          active_subscribers: getActiveSubscribers(projectId),
        }),
      );
    } catch (err) {
      console.warn('[hipp0:events-ws] Connection error:', (err as Error).message);
      try {
        ws.close(4000, 'Bad request');
      } catch { /* ignore */ }
      return;
    }

    ws.on('close', () => {
      if (projectId) unsubscribeFromProject(projectId, ws);
    });

    ws.on('error', () => {
      if (projectId) unsubscribeFromProject(projectId, ws);
    });

    // Ignore client messages for now — this is a one-way feed
    ws.on('message', () => { /* no-op */ });
  });

  console.warn('[hipp0] Event Stream WebSocket ready on /ws/events (noServer mode)');
}
