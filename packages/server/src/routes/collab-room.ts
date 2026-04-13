/**
 * Collaboration Room API — real-time multi-agent session rooms.
 *
 * Every mutation (message, join, action, step, close) broadcasts
 * the event to connected WebSocket clients via broadcastToRoom().
 */
import type { Hono } from 'hono';
import { requireUUID, requireString, optionalString, logAudit, mapDbError } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import { getDb } from '@hipp0/core/db/index.js';
import { randomBytes } from 'crypto';
import { broadcastToRoom } from '../collab-ws.js';

function generateToken(): string {
  return randomBytes(6).toString('hex').slice(0, 9);
}

export function registerCollabRoomRoutes(app: Hono): void {

    // Create a room
  app.post('/api/collab/rooms', async (c) => {
    const body = await c.req.json<{
      project_id?: unknown;
      title?: unknown;
      task_description?: unknown;
      session_id?: unknown;
    }>();

    const title = requireString(body.title as string, 'title', 500);
    const taskDescription = optionalString(body.task_description, 'task_description', 5000) || '';
    const db = getDb();

    try {
      const token = generateToken();
      const projectId = typeof body.project_id === 'string' ? body.project_id : null;
      if (projectId) await requireProjectAccess(c, projectId);
      const sessionId = typeof body.session_id === 'string' ? body.session_id : null;

      const result = await db.query(
        `INSERT INTO collab_rooms (project_id, session_id, share_token, title, task_description)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [projectId, sessionId, token, title, taskDescription],
      );
      const room = result.rows[0] as Record<string, unknown>;

      // Add creator as owner
      await db.query(
        `INSERT INTO collab_participants (room_id, display_name, sender_type, platform, role)
         VALUES ($1, 'Owner', 'human', 'browser', 'owner')`,
        [room.id],
      );

      // System message
      const sysMsg = `Room created. Session started: ${title}`;
      const msgResult = await db.query(
        `INSERT INTO collab_messages (room_id, sender_name, sender_type, message, message_type)
         VALUES ($1, 'System', 'system', $2, 'system') RETURNING *`,
        [room.id, sysMsg],
      );

      broadcastToRoom(token, 'new_message', msgResult.rows[0]);

      logAudit('collab_room_created', projectId, { room_id: room.id, token });

      return c.json({
        room_id: room.id,
        share_token: token,
        share_url: `/room/${token}`,
        status: 'open',
      }, 201);
    } catch (err) {
      mapDbError(err);
    }
  });

    // Get room by token
  app.get('/api/collab/rooms/:token', async (c) => {
    const token = c.req.param('token');
    const db = getDb();

    try {
      const roomResult = await db.query('SELECT * FROM collab_rooms WHERE share_token = $1', [token]);
      if (roomResult.rows.length === 0) return c.json({ error: 'Room not found' }, 404);
      const room = roomResult.rows[0] as Record<string, unknown>;

      const [participants, messages, steps] = await Promise.all([
        db.query('SELECT * FROM collab_participants WHERE room_id = $1 ORDER BY joined_at', [room.id]),
        db.query('SELECT * FROM collab_messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT 100', [room.id]),
        db.query('SELECT * FROM collab_steps WHERE room_id = $1 ORDER BY step_number', [room.id]),
      ]);

      return c.json({
        room_id: room.id,
        share_token: room.share_token,
        title: room.title,
        task_description: room.task_description,
        status: room.status,
        participants: participants.rows,
        recent_messages: (messages.rows as Array<Record<string, unknown>>).reverse(),
        steps: steps.rows,
      });
    } catch (err) {
      mapDbError(err);
    }
  });

    // Join room
  app.post('/api/collab/rooms/:token/join', async (c) => {
    const token = c.req.param('token');
    const body = await c.req.json<{
      name?: unknown;
      type?: unknown;
      platform?: unknown;
    }>();

    const name = requireString(body.name as string, 'name', 100);
    const senderType = (body.type === 'agent' ? 'agent' : 'human') as string;
    const platform = (['browser', 'openclaw', 'mcp', 'sdk', 'api'].includes(body.platform as string) ? body.platform : 'browser') as string;
    const db = getDb();

    try {
      const roomResult = await db.query('SELECT * FROM collab_rooms WHERE share_token = $1', [token]);
      if (roomResult.rows.length === 0) return c.json({ error: 'Room not found' }, 404);
      const room = roomResult.rows[0] as Record<string, unknown>;

      const participant = await db.query(
        `INSERT INTO collab_participants (room_id, display_name, sender_type, platform, role, is_online)
         VALUES ($1, $2, $3, $4, 'viewer', true) RETURNING *`,
        [room.id, name, senderType, platform],
      );

      // System join message
      const msgResult = await db.query(
        `INSERT INTO collab_messages (room_id, sender_name, sender_type, message, message_type)
         VALUES ($1, 'System', 'system', $2, 'system') RETURNING *`,
        [room.id, `${name} joined the room`],
      );

      // Broadcast both the join event and the system message
      broadcastToRoom(token, 'participant_joined', {
        participant: participant.rows[0],
        display_name: name,
      });
      broadcastToRoom(token, 'new_message', msgResult.rows[0]);

      return c.json(participant.rows[0]);
    } catch (err) {
      mapDbError(err);
    }
  });

    // Send message
  app.post('/api/collab/rooms/:token/messages', async (c) => {
    const token = c.req.param('token');
    const body = await c.req.json<{
      sender_name?: unknown;
      sender_type?: unknown;
      message?: unknown;
      message_type?: unknown;
      step_id?: unknown;
    }>();

    const senderName = requireString(body.sender_name as string, 'sender_name', 100);
    const message = requireString(body.message as string, 'message', 10000);
    const senderType = (['human', 'agent', 'system'].includes(body.sender_type as string) ? body.sender_type : 'human') as string;
    const messageType = (['chat', 'step_comment', 'suggestion', 'action', 'system'].includes(body.message_type as string) ? body.message_type : 'chat') as string;
    const db = getDb();

    try {
      const roomResult = await db.query('SELECT * FROM collab_rooms WHERE share_token = $1', [token]);
      if (roomResult.rows.length === 0) return c.json({ error: 'Room not found' }, 404);
      const room = roomResult.rows[0] as Record<string, unknown>;

      // Parse @mentions
      const mentionMatches = message.match(/@(\w+)/g) || [];
      const mentions = mentionMatches.map((m: string) => m.slice(1));

      const result = await db.query(
        `INSERT INTO collab_messages (room_id, sender_name, sender_type, message, message_type, step_id, mentions)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [room.id, senderName, senderType, message, messageType, body.step_id || null, JSON.stringify(mentions)],
      );

      const saved = result.rows[0] as Record<string, unknown>;

      // Broadcast to WebSocket clients
      broadcastToRoom(token, 'new_message', saved);

      // If this is a suggestion message, also broadcast as a suggestion event
      if (messageType === 'suggestion') {
        broadcastToRoom(token, 'suggestion', {
          sender_name: senderName,
          message,
        });
      }

      return c.json(saved, 201);
    } catch (err) {
      mapDbError(err);
    }
  });

    // Get messages (polling fallback)
  app.get('/api/collab/rooms/:token/messages', async (c) => {
    const token = c.req.param('token');
    const db = getDb();

    try {
      const roomResult = await db.query('SELECT id FROM collab_rooms WHERE share_token = $1', [token]);
      if (roomResult.rows.length === 0) return c.json({ error: 'Room not found' }, 404);
      const roomId = (roomResult.rows[0] as Record<string, unknown>).id;

      const after = c.req.query('after');  // Support ?after=<timestamp> for incremental polling
      let result;
      if (after) {
        result = await db.query(
          'SELECT * FROM collab_messages WHERE room_id = $1 AND created_at > $2 ORDER BY created_at ASC LIMIT 100',
          [roomId, after],
        );
      } else {
        result = await db.query(
          'SELECT * FROM collab_messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT 100',
          [roomId],
        );
        result = { ...result, rows: (result.rows as Array<Record<string, unknown>>).reverse() };
      }
      return c.json(result.rows);
    } catch (err) {
      mapDbError(err);
    }
  });

    // Accept/Override suggestion
  app.post('/api/collab/rooms/:token/action', async (c) => {
    const token = c.req.param('token');
    const body = await c.req.json<{
      action_type?: unknown;
      agent?: unknown;
      reason?: unknown;
    }>();

    const actionType = requireString(body.action_type as string, 'action_type', 50);
    const agent = requireString(body.agent as string, 'agent', 100);
    const db = getDb();

    try {
      const roomResult = await db.query('SELECT * FROM collab_rooms WHERE share_token = $1', [token]);
      if (roomResult.rows.length === 0) return c.json({ error: 'Room not found' }, 404);
      const room = roomResult.rows[0] as Record<string, unknown>;

      const label = actionType === 'accept' ? 'Accepted' : 'Overridden';
      const reason = typeof body.reason === 'string' ? ` — ${body.reason}` : '';

      const msgResult = await db.query(
        `INSERT INTO collab_messages (room_id, sender_name, sender_type, message, message_type)
         VALUES ($1, 'System', 'system', $2, 'action') RETURNING *`,
        [room.id, `${label}: ${agent}${reason}`],
      );

      // Broadcast the action message
      broadcastToRoom(token, 'new_message', msgResult.rows[0]);
      broadcastToRoom(token, 'action', {
        action_type: actionType,
        agent,
        reason: body.reason ?? null,
      });

      if (actionType === 'accept') {
        const stepCount = await db.query('SELECT COUNT(*) as c FROM collab_steps WHERE room_id = $1', [room.id]);
        const nextStep = parseInt((stepCount.rows[0] as Record<string, unknown>).c as string, 10) + 1;

        const stepResult = await db.query(
          `INSERT INTO collab_steps (room_id, step_number, agent_name, agent_role, output_summary, status)
           VALUES ($1, $2, $3, $3, $4, 'in_progress') RETURNING *`,
          [room.id, nextStep, agent, `${agent} is working on the task...`],
        );

        // Broadcast the new step
        broadcastToRoom(token, 'new_step', stepResult.rows[0]);
      }

      return c.json({ success: true });
    } catch (err) {
      mapDbError(err);
    }
  });

    // Close room
  app.post('/api/collab/rooms/:token/close', async (c) => {
    const token = c.req.param('token');
    const db = getDb();

    try {
      const roomResult = await db.query('SELECT * FROM collab_rooms WHERE share_token = $1', [token]);
      if (roomResult.rows.length === 0) return c.json({ error: 'Room not found' }, 404);
      const room = roomResult.rows[0] as Record<string, unknown>;

      await db.query(`UPDATE collab_rooms SET status = 'closed', closed_at = now() WHERE id = $1`, [room.id]);

      const msgResult = await db.query(
        `INSERT INTO collab_messages (room_id, sender_name, sender_type, message, message_type)
         VALUES ($1, 'System', 'system', 'Room closed by owner', 'system') RETURNING *`,
        [room.id],
      );

      broadcastToRoom(token, 'new_message', msgResult.rows[0]);
      broadcastToRoom(token, 'room_closed', { token });

      return c.json({ success: true });
    } catch (err) {
      mapDbError(err);
    }
  });

    // Seed demo room
  app.post('/api/collab/rooms/seed-demo', async (c) => {
    const db = getDb();

    try {
      const token = generateToken();
      const result = await db.query(
        `INSERT INTO collab_rooms (share_token, title, task_description)
         VALUES ($1, 'Build JWT Auth System', 'Implement JWT authentication with refresh tokens') RETURNING *`,
        [token],
      );
      const room = result.rows[0] as Record<string, unknown>;

      // Seed participants
      const participants = [
        ['Owner', 'human', 'browser', 'owner'],
        ['maks', 'agent', 'openclaw', 'operator'],
        ['security', 'agent', 'mcp', 'operator'],
        ['forge', 'agent', 'sdk', 'operator'],
      ];
      for (const [name, type, plat, role] of participants) {
        await db.query(
          `INSERT INTO collab_participants (room_id, display_name, sender_type, platform, role, is_online)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [room.id, name, type, plat, role, name !== 'forge'],
        );
      }

      // Seed steps
      const steps = [
        [1, 'architect', 'architect', 'Designed JWT auth flow with 15-minute access tokens and 7-day refresh tokens. Recommended RS256 signing with key rotation every 90 days.', 'complete', 2],
        [2, 'backend', 'backend', 'Implementing Express middleware for token validation. Added /auth/login, /auth/refresh, and /auth/logout endpoints.', 'complete', 0],
        [3, 'security', 'security', 'Reviewing auth implementation for vulnerabilities...', 'in_progress', 0],
      ];
      for (const [num, agent, role, summary, status, comments] of steps) {
        await db.query(
          `INSERT INTO collab_steps (room_id, step_number, agent_name, agent_role, output_summary, status, comments_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [room.id, num, agent, role, summary, status, comments],
        );
      }

      // Seed messages
      const msgs = [
        ['System', 'system', 'Room created. Session started: Build JWT Auth System', 'system'],
        ['Owner', 'human', "Let's make sure we handle token refresh edge cases properly", 'chat'],
        ['Brain', 'system', 'Suggesting security as next agent (62% relevance) — auth implementation needs security review before proceeding to frontend', 'suggestion'],
        ['security', 'agent', 'Starting review of auth implementation. Checking for token leakage vectors, CSRF protection, and secure cookie configuration.', 'chat'],
        ['Owner', 'human', '@security also check PCI compliance requirements', 'chat'],
        ['maks', 'agent', 'I can handle the frontend auth context and protected route wrappers once security review is complete.', 'chat'],
      ];
      for (const [name, type, msg, msgType] of msgs) {
        const mentions = (msg as string).match(/@(\w+)/g)?.map((m: string) => m.slice(1)) || [];
        await db.query(
          `INSERT INTO collab_messages (room_id, sender_name, sender_type, message, message_type, mentions)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [room.id, name, type, msg, msgType, JSON.stringify(mentions)],
        );
      }

      return c.json({ room_id: room.id, share_token: token }, 201);
    } catch (err) {
      mapDbError(err);
    }
  });
}
