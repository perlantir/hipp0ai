/**
 * Collab Room WebSocket Manager — room-scoped real-time broadcasting.
 *
 * Each room (identified by share_token) maintains a Set<WebSocket> of
 * connected clients.  Server-side code calls `broadcastToRoom` to push
 * events to every client in that room.
 *
 * Client message types:
 *   join_room   — subscribe to a room by token
 *   leave_room  — unsubscribe
 *   chat        — send a chat message (writes to DB + broadcast)
 *   typing      — broadcast typing indicator
 *   heartbeat   — presence keep-alive
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { getDb } from '@hipp0/core/db/index.js';

  // Types

interface ClientInfo {
  ws: WebSocket;
  token: string | null;        // room share_token (null until join_room)
  displayName: string | null;
  participantId: string | null;
  lastHeartbeat: number;
}

export interface RoomEvent {
  event: string;
  data: unknown;
  timestamp: string;
}

  // State

/** token → Set<ClientInfo> */
const rooms = new Map<string, Set<ClientInfo>>();

/** Track all connected clients for cleanup */
const allClients = new Set<ClientInfo>();

const HEARTBEAT_TIMEOUT_MS = 60_000;  // Mark offline after 60s without heartbeat
const SWEEP_INTERVAL_MS = 15_000;     // Check for stale clients every 15s

let sweepTimer: ReturnType<typeof setInterval> | null = null;

let collabWss: WebSocketServer | null = null;

/** Return the collab WebSocketServer instance (call after initCollabWebSocket). */
export function getCollabWss(): WebSocketServer | null {
  return collabWss;
}

  // Public API

/** Broadcast a typed event to every client in a room. */
export function broadcastToRoom(token: string, event: string, data: unknown): void {
  const clients = rooms.get(token);
  if (!clients || clients.size === 0) return;

  const payload = JSON.stringify({
    event,
    data,
    timestamp: new Date().toISOString(),
  } satisfies RoomEvent);

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

/** Get the set of online display names for a room. */
export function getRoomPresence(token: string): string[] {
  const clients = rooms.get(token);
  if (!clients) return [];
  const names: string[] = [];
  for (const c of clients) {
    if (c.displayName && c.ws.readyState === WebSocket.OPEN) {
      names.push(c.displayName);
    }
  }
  return [...new Set(names)];
}

  // Initialisation

export function initCollabWebSocket(): void {
  // noServer mode — the HTTP upgrade event is handled in index.ts
  const wss = new WebSocketServer({ noServer: true });
  collabWss = wss;

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Parse token from URL: /ws/room?token=xxx  (or /ws/room/xxx via path param fallback)
    let initialToken: string | null = null;
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      initialToken = url.searchParams.get('token') ?? null;
      if (!initialToken) {
        // Try path segment: /ws/room/abc123
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length >= 3) initialToken = segments[2];
      }
    } catch { /* ignore parse errors */ }

    const client: ClientInfo = {
      ws,
      token: null,
      displayName: null,
      participantId: null,
      lastHeartbeat: Date.now(),
    };
    allClients.add(client);

    // If token was in the URL, auto-join
    if (initialToken) {
      addClientToRoom(client, initialToken);
    }

    // Send welcome
    ws.send(JSON.stringify({
      event: 'connected',
      data: { message: 'Connected to Collab Room WebSocket' },
      timestamp: new Date().toISOString(),
    }));

    ws.on('message', (raw) => {
      handleClientMessage(client, raw);
    });

    ws.on('close', () => {
      handleDisconnect(client);
    });

    ws.on('error', () => {
      handleDisconnect(client);
    });
  });

  // Start stale-client sweep
  if (!sweepTimer) {
    sweepTimer = setInterval(sweepStaleClients, SWEEP_INTERVAL_MS);
  }

  console.warn('[hipp0] Collab Room WebSocket ready on /ws/room (noServer mode)');
}

  // Client message handling

function handleClientMessage(client: ClientInfo, raw: unknown): void {
  let msg: { type: string; [key: string]: unknown };
  try {
    msg = JSON.parse(String(raw)) as { type: string; [key: string]: unknown };
  } catch {
    return; // Ignore malformed messages
  }

  switch (msg.type) {
    case 'join_room': {
      const token = String(msg.token ?? '') || client.token;
      const name = String(msg.display_name ?? msg.name ?? '');
      if (name) client.displayName = name;
      if (!token) return;
      if (client.token !== token) addClientToRoom(client, token);
      // Re-broadcast presence now that displayName may have been set
      if (client.displayName && client.token) {
        broadcastToRoom(client.token, 'participant_joined', {
          display_name: client.displayName,
          online: getRoomPresence(client.token),
        });
      }
      break;
    }

    case 'leave_room': {
      if (client.token) removeClientFromRoom(client);
      break;
    }

    case 'chat': {
      // Chat messages go through the REST endpoint which handles DB + broadcast.
      // But we also support sending via WS for convenience.
      handleWsChat(client, msg).catch((err) => {
        console.warn('[collab-ws] chat error:', (err as Error).message);
      });
      break;
    }

    case 'typing': {
      if (client.token && client.displayName) {
        broadcastToRoom(client.token, 'typing', {
          sender_name: client.displayName,
          is_typing: msg.is_typing !== false,
        });
      }
      break;
    }

    case 'heartbeat': {
      client.lastHeartbeat = Date.now();
      updatePresenceInDb(client).catch(() => { /* non-fatal */ });
      // Ack
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          event: 'heartbeat_ack',
          data: { server_time: new Date().toISOString() },
          timestamp: new Date().toISOString(),
        }));
      }
      break;
    }

    default:
      // Unknown message type — ignore
      break;
  }
}

  // Room membership

function addClientToRoom(client: ClientInfo, token: string): void {
  // Remove from old room if switching
  if (client.token && client.token !== token) {
    removeClientFromRoom(client);
  }

  client.token = token;
  client.lastHeartbeat = Date.now();

  let room = rooms.get(token);
  if (!room) {
    room = new Set();
    rooms.set(token, room);
  }
  room.add(client);

  // Broadcast join to others
  if (client.displayName) {
    broadcastToRoom(token, 'participant_joined', {
      display_name: client.displayName,
      online: getRoomPresence(token),
    });
  }
}

function removeClientFromRoom(client: ClientInfo): void {
  const token = client.token;
  if (!token) return;

  const room = rooms.get(token);
  if (room) {
    room.delete(client);
    if (room.size === 0) rooms.delete(token);
  }

  client.token = null;

  // Broadcast leave
  if (client.displayName) {
    broadcastToRoom(token, 'participant_left', {
      display_name: client.displayName,
      online: getRoomPresence(token),
    });
  }
}

function handleDisconnect(client: ClientInfo): void {
  if (client.token) {
    removeClientFromRoom(client);
  }
  allClients.delete(client);

  // Mark offline in DB (fire-and-forget)
  if (client.participantId) {
    const db = getDb();
    db.query(
      'UPDATE collab_participants SET is_online = false WHERE id = $1',
      [client.participantId],
    ).catch(() => { /* non-fatal */ });
  }
}

  // WS chat shortcut

async function handleWsChat(
  client: ClientInfo,
  msg: Record<string, unknown>,
): Promise<void> {
  if (!client.token) return;
  const senderName = client.displayName || 'Anonymous';

  const message = String(msg.message ?? '').trim();
  if (!message) return;

  const senderType = String(msg.sender_type ?? 'human');
  const messageType = String(msg.message_type ?? 'chat');

  const db = getDb();

  // Resolve room_id from token
  const roomResult = await db.query(
    'SELECT id FROM collab_rooms WHERE share_token = $1',
    [client.token],
  );
  if (roomResult.rows.length === 0) return;
  const roomId = (roomResult.rows[0] as Record<string, unknown>).id;

  // Parse @mentions
  const mentionMatches = message.match(/@(\w+)/g) || [];
  const mentions = mentionMatches.map((m: string) => m.slice(1));

  const result = await db.query(
    `INSERT INTO collab_messages (room_id, sender_name, sender_type, message, message_type, mentions)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [roomId, senderName, senderType, message, messageType, JSON.stringify(mentions)],
  );

  const saved = result.rows[0] as Record<string, unknown>;

  // Broadcast to room
  broadcastToRoom(client.token, 'new_message', saved);
}

  // Presence

async function updatePresenceInDb(client: ClientInfo): Promise<void> {
  if (!client.participantId) {
    // Try to resolve participantId from name + room
    if (!client.token || !client.displayName) return;
    const db = getDb();
    const roomResult = await db.query(
      'SELECT id FROM collab_rooms WHERE share_token = $1',
      [client.token],
    );
    if (roomResult.rows.length === 0) return;
    const roomId = (roomResult.rows[0] as Record<string, unknown>).id;

    const pResult = await db.query(
      'SELECT id FROM collab_participants WHERE room_id = $1 AND display_name = $2 LIMIT 1',
      [roomId, client.displayName],
    );
    if (pResult.rows.length > 0) {
      client.participantId = (pResult.rows[0] as Record<string, unknown>).id as string;
    }
  }

  if (client.participantId) {
    const db = getDb();
    await db.query(
      'UPDATE collab_participants SET last_seen = NOW(), is_online = true WHERE id = $1',
      [client.participantId],
    );
  }
}

  // Stale client sweep

function sweepStaleClients(): void {
  const now = Date.now();
  const db = getDb();

  for (const client of allClients) {
    if (now - client.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      // Mark offline
      if (client.participantId) {
        db.query(
          'UPDATE collab_participants SET is_online = false WHERE id = $1',
          [client.participantId],
        ).catch(() => { /* non-fatal */ });
      }

      // Notify room
      if (client.token && client.displayName) {
        broadcastToRoom(client.token, 'participant_offline', {
          display_name: client.displayName,
          online: getRoomPresence(client.token),
        });
      }

      // Close the socket
      try { client.ws.close(); } catch { /* ignore */ }
      handleDisconnect(client);
    }
  }
}
