/**
 * Collab Room — real-time multi-agent collaboration dashboard.
 *
 * Phases: landing → join-name → room
 *
 * Features:
 *  - Create new room or join existing by share_token
 *  - Deep-link: auto-join if URL has ?token=xxx or hash contains token param
 *  - WebSocket-first messaging with REST polling fallback
 *  - @mention autocomplete from room participants
 *  - Typing indicators (throttled 1/sec, 4s auto-clear)
 *  - Participant sidebar with online/offline dots
 *  - Session timeline with Brain suggestions + Accept/Override
 *  - Connection status badge: green WS / yellow Connecting / red Polling
 *  - Close room with confirmation
 *  - Message deduplication by id
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Radio, Users, Send, Check, X, Link, ChevronRight, MessageSquare,
  Clock, Wifi, WifiOff, Copy, CheckCircle, AlertTriangle, ExternalLink,
  Loader, Plus, LogIn,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

// -- Types ----------------------------------------------------------------

interface Participant {
  id: string;
  display_name: string;
  sender_type: 'human' | 'agent';
  platform: string;
  role: string;
  is_online: boolean;
  last_seen?: string;
}

interface Message {
  id: string;
  sender_name: string;
  sender_type: 'human' | 'agent' | 'system';
  message: string;
  message_type: string;
  mentions: string[] | string;
  created_at: string;
}

interface Step {
  id: string;
  step_number: number;
  agent_name: string;
  agent_role: string;
  output_summary: string;
  status: 'complete' | 'in_progress';
  comments_count: number;
  created_at: string;
}

interface Room {
  room_id: string;
  share_token: string;
  title: string;
  task_description: string;
  status: 'open' | 'closed' | 'archived';
  participants: Participant[];
  recent_messages: Message[];
  steps: Step[];
}

interface CreateRoomResult {
  room_id: string;
  share_token: string;
  share_url: string;
  status: string;
}

interface WsEvent {
  event: string;
  data: unknown;
  timestamp: string;
}

// -- Helpers ---------------------------------------------------------------

function platformBadgeColor(platform: string): string {
  switch (platform) {
    case 'openclaw': return '#7c3aed';
    case 'mcp': return '#0891b2';
    case 'sdk': return '#059669';
    case 'api': return '#d97706';
    default: return '#4b5563';
  }
}

function highlightMentions(text: string): React.ReactNode[] {
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) =>
    part.startsWith('@')
      ? <span key={i} style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{part}</span>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

function timeAgo(ts: string): string {
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

/** Build a ws:// or wss:// URL for the collab room WS endpoint. */
function buildWsUrl(token: string): string {
  const apiBase = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL || window.location.origin;
  const base = apiBase.replace(/^http/, 'ws');
  return `${base}/ws/room?token=${encodeURIComponent(token)}`;
}

/** Try to extract a room token from the current URL (deep-link support). */
function getTokenFromUrl(): string | null {
  // Check ?token=xxx in search params
  const params = new URLSearchParams(window.location.search);
  const fromSearch = params.get('token');
  if (fromSearch) return fromSearch;

  // Check hash: #collab?token=xxx or #collab/TOKEN
  const hash = window.location.hash;
  if (hash.includes('token=')) {
    const hashParams = new URLSearchParams(hash.split('?')[1] || '');
    const fromHash = hashParams.get('token');
    if (fromHash) return fromHash;
  }
  // #collab/abc123def
  const match = hash.match(/#collab\/([a-zA-Z0-9]{6,})/);
  if (match) return match[1];

  return null;
}

// -- WebSocket hook -------------------------------------------------------

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

function useCollabSocket(
  token: string | null,
  displayName: string | null,
  onEvent: (evt: WsEvent) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [state, setState] = useState<ConnectionState>('disconnected');

  const cleanup = useCallback(() => {
    if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    const attempt = reconnectAttempts.current;
    const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
    reconnectAttempts.current = attempt + 1;
    reconnectTimer.current = setTimeout(() => {
      connectWs();
    }, delay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectWs = useCallback(() => {
    if (!token) return;
    cleanup();
    setState('connecting');

    const url = buildWsUrl(token);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState('connected');
      reconnectAttempts.current = 0;

      // Send join with display name
      if (displayName) {
        ws.send(JSON.stringify({ type: 'join_room', token, display_name: displayName }));
      }

      // Start heartbeat every 20s
      heartbeatTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }, 20_000);
    };

    ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(String(e.data)) as WsEvent;
        onEvent(evt);
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      setState('disconnected');
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }, [token, displayName, onEvent, cleanup, scheduleReconnect]);

  // Send a message through the WebSocket
  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  // Connect when token + displayName are both available
  useEffect(() => {
    if (token && displayName) {
      connectWs();
    }
    return cleanup;
  }, [token, displayName, connectWs, cleanup]);

  return { state, send };
}

// -- Component ------------------------------------------------------------

type Phase = 'landing' | 'join-name' | 'room';

export function CollabRoom() {
  const { get, post } = useApi();
  const { projectId } = useProject();

  const [phase, setPhase] = useState<Phase>('landing');
  const [room, setRoom] = useState<Room | null>(null);
  const [token, setToken] = useState('');

  // Landing: create form
  const [title, setTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Landing: join form
  const [joinToken, setJoinToken] = useState('');
  const [joining, setJoining] = useState(false);

  // Join-name
  const [joinName, setJoinName] = useState('');
  const [myName, setMyName] = useState('');
  const [joined, setJoined] = useState(false);

  // In-room state
  const [chatMsg, setChatMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [suggestion, setSuggestion] = useState<{ agent: string; reason: string } | null>(null);
  const [typingUsers, setTypingUsers] = useState<Map<string, number>>(new Map());
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showParticipants, setShowParticipants] = useState(true);

  // @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTypingSent = useRef(0);

  // -- Deep-link: check URL for token on mount ---------------------------

  useEffect(() => {
    const deepToken = getTokenFromUrl();
    if (deepToken) {
      setJoinToken(deepToken);
      setToken(deepToken);
      // Auto-fetch room details and go to join-name
      get<Room>(`/api/collab/rooms/${deepToken}`)
        .then(data => {
          setRoom(data);
          setPhase('join-name');
        })
        .catch(() => {
          setError('Room not found from URL. Check the token.');
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- WebSocket event handler -------------------------------------------

  const handleWsEvent = useCallback((evt: WsEvent) => {
    switch (evt.event) {
      case 'connected':
        // Server confirmed WS connection
        break;

      case 'new_message': {
        const msg = evt.data as Message;
        setRoom(prev => {
          if (!prev) return prev;
          if (prev.recent_messages.some(m => m.id === msg.id)) return prev;
          return { ...prev, recent_messages: [...prev.recent_messages, msg] };
        });
        break;
      }

      case 'new_step': {
        const step = evt.data as Step;
        setRoom(prev => {
          if (!prev) return prev;
          if (prev.steps.some(s => s.id === step.id)) return prev;
          return { ...prev, steps: [...prev.steps, step] };
        });
        break;
      }

      case 'participant_joined': {
        const data = evt.data as { participant?: Participant; display_name?: string; online?: string[] };
        if (data.participant) {
          setRoom(prev => {
            if (!prev) return prev;
            if (prev.participants.some(p => p.id === data.participant!.id)) return prev;
            return { ...prev, participants: [...prev.participants, data.participant!] };
          });
        }
        // Update online list if provided
        if (data.online) {
          setRoom(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              participants: prev.participants.map(p => ({
                ...p,
                is_online: data.online!.includes(p.display_name),
              })),
            };
          });
        }
        break;
      }

      case 'participant_left':
      case 'participant_offline': {
        const data = evt.data as { display_name?: string; online?: string[] };
        if (data.online) {
          setRoom(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              participants: prev.participants.map(p => ({
                ...p,
                is_online: data.online!.includes(p.display_name),
              })),
            };
          });
        } else if (data.display_name) {
          setRoom(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              participants: prev.participants.map(p =>
                p.display_name === data.display_name ? { ...p, is_online: false } : p
              ),
            };
          });
        }
        break;
      }

      case 'typing': {
        const data = evt.data as { sender_name?: string; is_typing?: boolean };
        if (data.sender_name && data.sender_name !== myName) {
          setTypingUsers(prev => {
            const next = new Map(prev);
            if (data.is_typing) {
              next.set(data.sender_name!, Date.now());
            } else {
              next.delete(data.sender_name!);
            }
            return next;
          });
        }
        break;
      }

      case 'suggestion': {
        const data = evt.data as { sender_name?: string; message?: string };
        if (data.message) {
          const match = data.message.match(/Suggesting (\w+) as next agent/);
          const agent = match ? match[1] : 'next-agent';
          setSuggestion({ agent, reason: data.message });
        }
        break;
      }

      case 'action':
        setSuggestion(null);
        break;

      case 'room_closed':
        setRoom(prev => prev ? { ...prev, status: 'closed' } : prev);
        break;

      case 'heartbeat_ack':
        // Connection alive confirmation
        break;

      default:
        break;
    }
  }, [myName]);

  // -- WebSocket connection ----------------------------------------------

  const { state: wsState, send: wsSend } = useCollabSocket(
    phase === 'room' && joined ? token : null,
    joined ? myName : null,
    handleWsEvent,
  );

  // -- Clean up stale typing indicators every 3s ------------------------

  useEffect(() => {
    const timer = setInterval(() => {
      setTypingUsers(prev => {
        const now = Date.now();
        const next = new Map(prev);
        let changed = false;
        for (const [name, ts] of next) {
          if (now - ts > 4000) {
            next.delete(name);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  // -- Polling fallback (only when WS is disconnected) ------------------

  const fetchRoom = useCallback(async (tok: string) => {
    try {
      const data = await get<Room>(`/api/collab/rooms/${tok}`);
      setRoom(data);
    } catch {
      // silent poll failure
    }
  }, [get]);

  useEffect(() => {
    if (phase === 'room' && token && joined) {
      fetchRoom(token);

      if (wsState === 'disconnected') {
        pollRef.current = setInterval(() => fetchRoom(token), 3000);
      }

      return () => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      };
    }
  }, [phase, token, wsState, fetchRoom, joined]);

  useEffect(() => {
    if (wsState === 'connected' && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [wsState]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room?.recent_messages.length]);

  // -- @mention autocomplete ---------------------------------------------

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null || !room) return [];
    const q = mentionQuery.toLowerCase();
    return room.participants
      .filter(p => p.display_name !== myName && p.display_name.toLowerCase().includes(q))
      .slice(0, 5);
  }, [mentionQuery, room, myName]);

  function insertMention(name: string) {
    // Replace the @query with @name in chatMsg
    const atIdx = chatMsg.lastIndexOf('@');
    if (atIdx >= 0) {
      const before = chatMsg.slice(0, atIdx);
      setChatMsg(`${before}@${name} `);
    }
    setMentionQuery(null);
    chatInputRef.current?.focus();
  }

  // -- Actions ----------------------------------------------------------

  async function createRoom() {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { title: title.trim(), task_description: taskDesc.trim() };
      if (projectId && projectId !== 'default') body.project_id = projectId;
      const result = await post<CreateRoomResult>('/api/collab/rooms', body);
      setToken(result.share_token);
      // Fetch full room data
      const data = await get<Room>(`/api/collab/rooms/${result.share_token}`);
      setRoom(data);
      setPhase('join-name');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setCreating(false);
    }
  }

  async function loadRoomByToken() {
    if (!joinToken.trim()) return;
    setJoining(true);
    setError(null);
    try {
      const data = await get<Room>(`/api/collab/rooms/${joinToken.trim()}`);
      setRoom(data);
      setToken(joinToken.trim());
      setPhase('join-name');
    } catch {
      setError('Room not found. Check the token and try again.');
    } finally {
      setJoining(false);
    }
  }

  async function joinRoom() {
    if (!joinName.trim()) return;
    setError(null);
    try {
      await post(`/api/collab/rooms/${token}/join`, {
        name: joinName.trim(),
        type: 'human',
        platform: 'browser',
      });
      setMyName(joinName.trim());
      setJoined(true);
      setPhase('room');
      fetchRoom(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
    }
  }

  async function sendMessage() {
    if (!chatMsg.trim() || !myName) return;
    setSending(true);
    setMentionQuery(null);

    // Clear typing indicator
    wsSend({ type: 'typing', is_typing: false });

    const text = chatMsg.trim();
    setChatMsg('');

    // Prefer WebSocket, fall back to REST
    const sentViaWs = wsSend({ type: 'chat', message: text });

    if (!sentViaWs) {
      // WS unavailable — send via REST
      try {
        await post(`/api/collab/rooms/${token}/messages`, {
          sender_name: myName,
          sender_type: 'human',
          message: text,
          message_type: 'chat',
        });
        if (wsState !== 'connected') fetchRoom(token);
      } catch {
        // Restore message on failure
        setChatMsg(text);
      }
    }
    setSending(false);
  }

  function handleChatInput(value: string) {
    setChatMsg(value);

    // @mention detection
    const atIdx = value.lastIndexOf('@');
    if (atIdx >= 0) {
      const after = value.slice(atIdx + 1);
      // Only show autocomplete if @ is at start or after a space, and no space in query
      const charBefore = atIdx > 0 ? value[atIdx - 1] : ' ';
      if ((charBefore === ' ' || atIdx === 0) && !after.includes(' ')) {
        setMentionQuery(after);
        setMentionIndex(0);
      } else {
        setMentionQuery(null);
      }
    } else {
      setMentionQuery(null);
    }

    // Throttle typing events to 1 per second
    const now = Date.now();
    if (now - lastTypingSent.current > 1000) {
      wsSend({ type: 'typing', is_typing: value.length > 0 });
      lastTypingSent.current = now;
    }
  }

  function handleChatKeyDown(e: React.KeyboardEvent) {
    // @mention nav
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(i => Math.min(i + 1, mentionCandidates.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (mentionCandidates[mentionIndex]) {
          e.preventDefault();
          insertMention(mentionCandidates[mentionIndex].display_name);
          return;
        }
      }
      if (e.key === 'Escape') {
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function handleAction(action: 'accept' | 'override') {
    if (!suggestion) return;
    try {
      await post(`/api/collab/rooms/${token}/action`, {
        action_type: action,
        agent: suggestion.agent,
        reason: action === 'override' ? 'Manually overridden by operator' : undefined,
      });
      setSuggestion(null);
      if (wsState !== 'connected') fetchRoom(token);
    } catch { /* silent */ }
  }

  async function closeRoom() {
    try {
      await post(`/api/collab/rooms/${token}/close`, {});
      setShowCloseConfirm(false);
      if (wsState !== 'connected') fetchRoom(token);
    } catch { /* silent */ }
  }

  async function seedDemo() {
    setError(null);
    try {
      const result = await post<{ room_id: string; share_token: string }>('/api/collab/rooms/seed-demo', {});
      setToken(result.share_token);
      const data = await get<Room>(`/api/collab/rooms/${result.share_token}`);
      setRoom(data);
      setPhase('join-name');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seed demo');
    }
  }

  function copyShareLink() {
    const url = `${window.location.origin}${window.location.pathname}?token=${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  }

  function copyToken() {
    navigator.clipboard.writeText(token);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  }

  // -- Typing indicator text ---------------------------------------------

  const typingNames = [...typingUsers.keys()];
  const typingText = typingNames.length === 0
    ? null
    : typingNames.length === 1
      ? `${typingNames[0]} is typing...`
      : typingNames.length === 2
        ? `${typingNames[0]} and ${typingNames[1]} are typing...`
        : `${typingNames[0]} and ${typingNames.length - 1} others are typing...`;

  // -- Styles -----------------------------------------------------------

  const card: React.CSSProperties = {
    background: 'rgba(255, 255, 255, 0.6)',
    backdropFilter: 'blur(24px)',
    border: '1px solid rgba(255, 255, 255, 0.4)',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.05)',
  };

  const glassCard: React.CSSProperties = {
    background: 'rgba(255, 255, 255, 0.6)',
    backdropFilter: 'blur(24px)',
    border: '1px solid rgba(255, 255, 255, 0.4)',
    borderRadius: 16,
    padding: 24,
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.05)',
  };

  const accentBtn: React.CSSProperties = {
    background: 'var(--accent-primary)',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    padding: '12px 24px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 0 20px rgba(6,63,249,0.4)',
    transition: 'all 0.2s',
  };

  const ghostBtn: React.CSSProperties = {
    background: 'rgba(255, 255, 255, 0.4)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.4)',
    borderRadius: 10,
    padding: '8px 16px',
    fontSize: 13,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontWeight: 600,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 12,
    border: '1px solid rgba(255, 255, 255, 0.4)',
    background: 'rgba(255, 255, 255, 0.5)',
    color: 'var(--text-primary)',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };

  // -- Phase: Landing ----------------------------------------------------

  if (phase === 'landing') {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 20px' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 16,
              background: 'var(--accent-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 20px rgba(6,63,249,0.4)',
            }}>
              <Radio size={22} color="#fff" />
            </div>
            <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: -0.5 }}>
              Collab Room
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
              background: 'rgba(16,185,129,0.1)', color: '#059669', letterSpacing: 1.5,
              border: '1px solid rgba(16,185,129,0.2)',
            }}>LIVE</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 15, margin: 0, lineHeight: 1.6 }}>
            Create a shared room where humans and AI agents collaborate in real time.
            Share the link with any team member or agent.
          </p>
        </div>

        {error && (
          <div style={{
            marginBottom: 16, padding: '12px 16px', borderRadius: 10,
            background: '#7f1d1d22', border: '1px solid #991b1b44',
            color: '#fca5a5', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Create New Room */}
        <div style={{ ...glassCard, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <Plus size={18} color="var(--accent-primary)" />
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 16 }}>
              Create New Room
            </span>
          </div>

          <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            Room title
          </label>
          <input
            style={{ ...inputStyle, marginBottom: 12 }}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g., Build JWT Auth System"
            onKeyDown={e => { if (e.key === 'Enter' && title.trim()) createRoom(); }}
          />

          <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            Task description
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> (optional)</span>
          </label>
          <textarea
            style={{ ...inputStyle, resize: 'none', marginBottom: 16 }}
            rows={3}
            value={taskDesc}
            onChange={e => setTaskDesc(e.target.value)}
            placeholder="Describe what needs to get done..."
          />

          <button
            onClick={createRoom}
            disabled={!title.trim() || creating}
            style={{ ...accentBtn, width: '100%', opacity: (!title.trim() || creating) ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {creating ? <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Creating...</> : <>Create Room</>}
          </button>
        </div>

        {/* Join Existing Room */}
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <LogIn size={18} color="var(--accent-primary)" />
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 16 }}>
              Join Existing Room
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={joinToken}
              onChange={e => setJoinToken(e.target.value)}
              placeholder="Paste room token (e.g. a1b2c3d4e)"
              onKeyDown={e => { if (e.key === 'Enter') loadRoomByToken(); }}
            />
            <button
              onClick={loadRoomByToken}
              disabled={!joinToken.trim() || joining}
              style={{ ...accentBtn, padding: '12px 20px', opacity: (!joinToken.trim() || joining) ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {joining ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ChevronRight size={16} />}
              Join
            </button>
          </div>
        </div>

        <button
          onClick={seedDemo}
          style={{ ...ghostBtn, width: '100%', textAlign: 'center' }}
        >
          Load Demo Room
        </button>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // -- Phase: Join Name --------------------------------------------------

  if (phase === 'join-name') {
    return (
      <div style={{ maxWidth: 420, margin: '80px auto', padding: '0 20px' }}>
        <div style={glassCard}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16, margin: '0 auto 14px',
              background: 'var(--accent-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 24px rgba(6,63,249,0.4)',
            }}>
              <Radio size={24} color="#fff" />
            </div>
            <div style={{ fontWeight: 800, fontSize: 20, color: 'var(--text-primary)', marginBottom: 4 }}>
              {room?.title || 'Collab Room'}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              {room ? `${room.participants.length} participant${room.participants.length !== 1 ? 's' : ''} · ${room.status}` : ''}
            </div>
            {room?.task_description && (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 8, lineHeight: 1.5, fontStyle: 'italic' }}>
                {room.task_description}
              </div>
            )}
          </div>

          <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            Your display name
          </label>
          <input
            style={{ ...inputStyle, marginBottom: 16 }}
            value={joinName}
            onChange={e => setJoinName(e.target.value)}
            placeholder="Enter your name..."
            onKeyDown={e => { if (e.key === 'Enter' && joinName.trim()) joinRoom(); }}
            autoFocus
          />

          {error && (
            <div style={{ marginBottom: 12, padding: '10px 14px', background: '#7f1d1d22', border: '1px solid #991b1b44', borderRadius: 8, color: '#fca5a5', fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => { setPhase('landing'); setError(null); }}
              style={{ ...ghostBtn, flex: '0 0 auto' }}
            >
              Back
            </button>
            <button
              onClick={joinRoom}
              disabled={!joinName.trim()}
              style={{ ...accentBtn, flex: 1, opacity: !joinName.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              Join Room
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -- Phase: Room (loading) ---------------------------------------------

  if (!room) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--text-tertiary)', gap: 10 }}>
        <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />
        Loading room...
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // -- Phase: Room -------------------------------------------------------

  const onlineCount = room.participants.filter(p => p.is_online).length;
  const wsBadge = wsState === 'connected'
    ? { bg: '#05966918', color: '#059669', icon: <Wifi size={10} />, label: 'WS' }
    : wsState === 'connecting'
      ? { bg: '#d9770618', color: '#d97706', icon: <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} />, label: 'Connecting' }
      : { bg: '#ef444418', color: '#ef4444', icon: <WifiOff size={10} />, label: 'Polling' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* -- Room Header ------------------------------------------------ */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px',
        background: 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(255,255,255,0.3)',
        flexShrink: 0,
        flexWrap: 'wrap',
        gap: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Radio size={18} color="var(--accent-primary)" />
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {room.title}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, flexShrink: 0,
            background: room.status === 'open' ? '#05966918' : '#ef444418',
            color: room.status === 'open' ? '#059669' : '#ef4444',
            letterSpacing: 1,
          }}>
            {room.status === 'open' ? 'LIVE' : room.status.toUpperCase()}
          </span>

          {/* Connection badge */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            background: wsBadge.bg, color: wsBadge.color,
          }}>
            {wsBadge.icon}
            {wsBadge.label}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Token + copy */}
          <button
            onClick={copyToken}
            style={{
              ...ghostBtn, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 12,
            }}
          >
            <code style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{token}</code>
            {copySuccess ? <CheckCircle size={12} color="#059669" /> : <Copy size={12} />}
          </button>

          {/* Share */}
          <button onClick={copyShareLink} style={{ ...ghostBtn, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <ExternalLink size={12} />
            Share
          </button>

          {/* Participant toggle */}
          <button
            onClick={() => setShowParticipants(p => !p)}
            style={{ ...ghostBtn, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
          >
            <Users size={12} />
            {onlineCount}
          </button>

          {/* Close room */}
          {room.status === 'open' && (
            <button
              onClick={() => setShowCloseConfirm(true)}
              style={{ ...ghostBtn, padding: '5px 10px', color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <X size={12} />
              Close
            </button>
          )}
        </div>
      </div>

      {/* Close confirmation modal */}
      {showCloseConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{ ...card, maxWidth: 360, textAlign: 'center' }}>
            <AlertTriangle size={32} color="#ef4444" style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 8 }}>
              Close this room?
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>
              All participants will be notified. No new messages can be sent after closing.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowCloseConfirm(false)} style={{ ...ghostBtn, flex: 1 }}>
                Cancel
              </button>
              <button
                onClick={closeRoom}
                style={{
                  ...accentBtn, flex: 1,
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  boxShadow: '0 4px 14px rgba(239,68,68,0.25)',
                }}
              >
                Close Room
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -- Main layout: Timeline | Chat | Participants --------------- */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* -- Timeline panel (left) ----------------------------------- */}
        <div style={{
          width: 300, flexShrink: 0,
          borderRight: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(255,255,255,0.3)',
          backdropFilter: 'blur(16px)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={14} color="var(--accent-primary)" />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>Timeline</span>
            </div>
            {room.task_description && (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
                {room.task_description}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {room.steps.length === 0 && (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', marginTop: 40, lineHeight: 1.6 }}>
                No steps yet.<br />Accept a Brain suggestion to start.
              </div>
            )}

            {room.steps.map((step, i) => (
              <div key={step.id} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: step.status === 'in_progress' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.6)',
                    border: `2px solid ${step.status === 'in_progress' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.4)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                    color: step.status === 'in_progress' ? '#fff' : 'var(--text-secondary)',
                  }}>
                    {step.status === 'in_progress'
                      ? <Loader size={13} style={{ animation: 'spin 1.5s linear infinite' }} />
                      : <Check size={13} color="#059669" />
                    }
                  </div>
                  {i < room.steps.length - 1 && (
                    <div style={{ width: 2, flex: 1, background: 'var(--border-light)', marginTop: 4 }} />
                  )}
                </div>

                <div style={{ flex: 1, paddingBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: '50%', background: 'var(--accent-primary)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0,
                    }}>
                      {step.agent_name[0]?.toUpperCase()}
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>
                      {step.agent_name}
                    </span>
                    <span style={{
                      fontSize: 10, padding: '1px 5px', borderRadius: 3,
                      background: step.status === 'in_progress' ? 'rgba(6,63,249,0.1)' : 'rgba(5,150,105,0.1)',
                      color: step.status === 'in_progress' ? 'var(--accent-primary)' : '#059669',
                      fontWeight: 600,
                    }}>
                      {step.status === 'in_progress' ? 'working' : 'done'}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>
                    {step.output_summary}
                  </div>
                  {step.comments_count > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, color: 'var(--text-tertiary)', fontSize: 11 }}>
                      <MessageSquare size={11} />
                      {step.comments_count} comment{step.comments_count !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Brain suggestion card */}
            {suggestion && room.status === 'open' && (
              <div style={{
                background: 'rgba(6,63,249,0.06)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(6,63,249,0.2)',
                borderRadius: 14,
                padding: 16,
                marginTop: 8,
                boxShadow: '0 4px 16px rgba(6,63,249,0.08)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-primary)', letterSpacing: 1.5, marginBottom: 8, textTransform: 'uppercase' }}>
                  Brain Suggestion
                </div>
                <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  Next: {suggestion.agent}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
                  {suggestion.reason}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => handleAction('accept')}
                    style={{
                      flex: 1, padding: '8px 10px', borderRadius: 10, border: 'none',
                      background: 'var(--accent-primary)', color: '#fff',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      boxShadow: '0 0 14px rgba(6,63,249,0.3)',
                    }}
                  >
                    <Check size={13} /> Accept
                  </button>
                  <button
                    onClick={() => handleAction('override')}
                    style={{
                      flex: 1, padding: '8px 10px', borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.4)',
                      background: 'rgba(255,255,255,0.4)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      fontWeight: 600,
                    }}
                  >
                    <X size={13} /> Override
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* -- Chat panel (center) ------------------------------------- */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {room.recent_messages.length === 0 && (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', marginTop: 60, lineHeight: 1.6 }}>
                No messages yet. Start the conversation.
              </div>
            )}

            {room.recent_messages.map(msg => {
              const isSystem = msg.sender_type === 'system';
              const isSuggestionMsg = msg.message_type === 'suggestion';
              const isAction = msg.message_type === 'action';

              if (isSystem) {
                return (
                  <div key={msg.id} style={{ textAlign: 'center', margin: '4px 0' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '5px 14px',
                      borderRadius: 12,
                      background: isSuggestionMsg ? 'rgba(6,63,249,0.08)' : isAction ? 'rgba(5,150,105,0.08)' : 'rgba(255,255,255,0.5)',
                      color: isSuggestionMsg ? 'var(--accent-primary)' : isAction ? '#059669' : 'var(--text-tertiary)',
                      fontSize: 12,
                      fontStyle: 'italic',
                      border: isSuggestionMsg ? '1px solid rgba(6,63,249,0.2)' : '1px solid rgba(255,255,255,0.4)',
                    }}>
                      {msg.message}
                    </span>
                  </div>
                );
              }

              const isAgent = msg.sender_type === 'agent';
              const isMe = msg.sender_name === myName;

              return (
                <div key={msg.id} style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  flexDirection: isMe ? 'row-reverse' : 'row',
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: isAgent ? '#7c3aed' : 'var(--accent-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: '#fff',
                    boxShadow: isAgent ? '0 0 10px rgba(124,58,237,0.3)' : '0 0 10px rgba(6,63,249,0.3)',
                    border: isAgent ? '2px solid rgba(124,58,237,0.3)' : 'none',
                  }}>
                    {msg.sender_name[0]?.toUpperCase()}
                  </div>
                  <div style={{ maxWidth: '72%' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3,
                      flexDirection: isMe ? 'row-reverse' : 'row',
                    }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                        {msg.sender_name}
                      </span>
                      {isAgent && (
                        <span style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 4,
                          background: '#7c3aed18', color: '#7c3aed', fontWeight: 600,
                        }}>agent</span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {timeAgo(msg.created_at)}
                      </span>
                    </div>
                    <div style={{
                      padding: '12px 16px',
                      borderRadius: isMe ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                      background: isMe ? 'var(--accent-primary)' : 'rgba(255,255,255,0.6)',
                      backdropFilter: isMe ? undefined : 'blur(12px)',
                      border: isMe ? 'none' : isAgent ? '1px solid rgba(6,63,249,0.15)' : '1px solid rgba(255,255,255,0.4)',
                      color: isMe ? '#fff' : 'var(--text-primary)',
                      fontSize: 13,
                      lineHeight: 1.5,
                      borderLeft: isAgent && !isMe ? '3px solid var(--accent-primary)' : undefined,
                      boxShadow: isMe ? '0 4px 14px rgba(6,63,249,0.25)' : '0 2px 8px rgba(0,0,0,0.03)',
                    }}>
                      {highlightMentions(msg.message)}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Typing indicator */}
          {typingText && (
            <div style={{
              padding: '4px 20px',
              fontSize: 12,
              color: 'var(--text-tertiary)',
              fontStyle: 'italic',
              flexShrink: 0,
            }}>
              {typingText}
            </div>
          )}

          {/* Chat input */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.5)',
            backdropFilter: 'blur(16px)',
            flexShrink: 0,
            position: 'relative',
          }}>
            {/* @mention autocomplete dropdown */}
            {mentionQuery !== null && mentionCandidates.length > 0 && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 16, right: 16,
                background: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(24px)',
                border: '1px solid rgba(255,255,255,0.4)',
                borderRadius: 14,
                boxShadow: '0 -4px 24px rgba(0,0,0,0.1)',
                overflow: 'hidden',
                marginBottom: 4,
              }}>
                {mentionCandidates.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => insertMention(p.display_name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 14px',
                      background: i === mentionIndex ? 'rgba(6,63,249,0.08)' : 'transparent',
                      border: 'none',
                      borderBottom: i < mentionCandidates.length - 1 ? '1px solid var(--border-light)' : 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: p.sender_type === 'agent' ? '#7c3aed' : 'var(--accent-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0,
                    }}>
                      {p.display_name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        @{p.display_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {p.sender_type} · {p.platform}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={chatInputRef}
                style={{ ...inputStyle, flex: 1 }}
                value={chatMsg}
                onChange={e => handleChatInput(e.target.value)}
                placeholder={room.status === 'open' ? `Message as ${myName}... (@ to mention)` : 'Room is closed'}
                onKeyDown={handleChatKeyDown}
                disabled={room.status !== 'open'}
              />
              <button
                onClick={sendMessage}
                disabled={!chatMsg.trim() || sending || room.status !== 'open'}
                style={{
                  ...accentBtn,
                  padding: '10px 16px',
                  opacity: (!chatMsg.trim() || sending) ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* -- Participants sidebar (right) ---------------------------- */}
        {showParticipants && (
          <div style={{
            width: 240, flexShrink: 0,
            borderLeft: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.3)',
            backdropFilter: 'blur(16px)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '16px 18px',
              borderBottom: '1px solid rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} color="var(--accent-primary)" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>
                  Participants
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                  background: '#05966918', color: '#059669',
                }}>
                  {onlineCount}
                </span>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
              {/* Online first, then offline */}
              {[...room.participants]
                .sort((a, b) => (b.is_online ? 1 : 0) - (a.is_online ? 1 : 0))
                .map(p => {
                  const roleColor = p.sender_type === 'agent' ? platformBadgeColor(p.platform) : '#063ff9';
                  return (
                    <div key={p.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 8px',
                      borderRadius: 8,
                      opacity: p.is_online ? 1 : 0.5,
                      transition: 'opacity 0.2s',
                    }}>
                      {/* Avatar with online dot */}
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: `${roleColor}22`,
                          border: `2px solid ${roleColor}44`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, color: roleColor,
                        }}>
                          {p.display_name[0]?.toUpperCase()}
                        </div>
                        <div style={{
                          position: 'absolute', bottom: -1, right: -1,
                          width: 10, height: 10, borderRadius: '50%',
                          background: p.is_online ? '#059669' : '#6b7280',
                          border: '2px solid var(--bg-primary)',
                        }} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontWeight: 600, fontSize: 13, color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {p.display_name}
                          {p.display_name === myName && (
                            <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, fontSize: 11 }}> (you)</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          {p.sender_type === 'agent' && (
                            <span style={{
                              fontSize: 10, padding: '0px 5px', borderRadius: 3,
                              background: `${roleColor}18`, color: roleColor,
                              fontWeight: 600,
                            }}>
                              {p.platform}
                            </span>
                          )}
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                            {p.is_online ? 'online' : p.last_seen ? timeAgo(p.last_seen) : 'offline'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
