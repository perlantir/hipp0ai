# Collaboration Rooms

Collaboration rooms enable real-time multi-agent communication with WebSocket-first messaging, presence tracking, typing indicators, and @mention support. Rooms support humans, AI agents, and any MCP-compatible client on any platform.

## Creating a Room

```bash
curl -X POST http://localhost:3100/api/collab/rooms \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "<PROJECT_ID>",
    "name": "Sprint Planning",
    "created_by": "human-user"
  }'
```

Response:

```json
{
  "room_id": "uuid",
  "share_token": "a1b2c3d4e5",
  "share_url": "/room/a1b2c3d4e5",
  "status": "open"
}
```

The `share_token` (9-character hex) is used to join the room and establish WebSocket connections.

## Joining a Room

### REST

```bash
curl -X POST http://localhost:3100/api/collab/rooms/<TOKEN>/join \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "backend-agent",
    "sender_type": "agent",
    "platform": "mcp"
  }'
```

### WebSocket

Connect to `ws://localhost:3100/ws/room?token=<SHARE_TOKEN>` and send:

```json
{ "type": "join_room", "token": "<SHARE_TOKEN>", "display_name": "backend-agent" }
```

## REST API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/collab/rooms` | Create a room |
| `GET` | `/api/collab/rooms/:token` | Get room state (participants, messages, steps) |
| `POST` | `/api/collab/rooms/:token/join` | Join a room |
| `POST` | `/api/collab/rooms/:token/messages` | Send a message |
| `GET` | `/api/collab/rooms/:token/messages?after=<ts>` | Poll messages (incremental or full) |
| `POST` | `/api/collab/rooms/:token/action` | Accept/override a Brain suggestion |
| `POST` | `/api/collab/rooms/:token/close` | Close the room |
| `POST` | `/api/collab/rooms/seed-demo` | Seed a demo room for testing |

## WebSocket Events

### Client → Server

| Message Type | Payload | Effect |
|-------------|---------|--------|
| `join_room` | `{ token, display_name }` | Subscribe to room; broadcasts `participant_joined` |
| `leave_room` | — | Unsubscribe; broadcasts `participant_left` |
| `chat` | `{ message, sender_type, message_type }` | Persists to DB and broadcasts `new_message` |
| `typing` | `{ is_typing }` | Broadcasts `typing` indicator to other participants |
| `heartbeat` | — | Resets timeout; server responds with `heartbeat_ack` |

### Server → Client

| Event | Description |
|-------|-------------|
| `connected` | Connection established |
| `participant_joined` | A new participant joined the room |
| `participant_left` | A participant left the room |
| `participant_offline` | A participant timed out (no heartbeat for 60s) |
| `new_message` | A new message was sent |
| `suggestion` | Brain suggestion for the session |
| `action` | A suggestion was accepted or overridden |
| `new_step` | A new session step was recorded |
| `room_closed` | The room was closed |
| `typing` | A participant started or stopped typing |
| `heartbeat_ack` | Heartbeat acknowledgment with `server_time` |

All broadcasts use the `RoomEvent` shape: `{ event, data, timestamp }`.

## Presence

- **Heartbeat interval**: Clients should send `heartbeat` messages periodically.
- **Timeout**: 60 seconds — clients are marked offline after no heartbeat.
- **Sweep interval**: Every 15 seconds, stale connections are closed and the room is notified.
- `getRoomPresence(token)` returns all active `displayName` values for open WebSocket connections.

## Participant Types

| Field | Values |
|-------|--------|
| `sender_type` | `human`, `agent`, `system` |
| `platform` | `browser`, `openclaw`, `mcp`, `sdk`, `api` |
| `role` | `owner`, `operator`, `viewer` |

## @Mentions

Messages containing `@word` patterns are automatically parsed. Matched mentions are stored as a JSON array in the `mentions` column and can trigger targeted notifications to the mentioned participants.

## Message Types

| Type | Description |
|------|-------------|
| `chat` | Standard conversation message |
| `step_comment` | Comment on a session step |
| `suggestion` | Brain suggestion |
| `action` | Accept/override response |
| `system` | System-generated notification |

## Dashboard

Access the collaboration room at `#collab-room` in the dashboard. Features include:
- Real-time WebSocket messaging with REST polling fallback
- @mention autocomplete
- Typing indicators
- Participant sidebar with online/offline status
- Session timeline with Brain suggestion accept/override
