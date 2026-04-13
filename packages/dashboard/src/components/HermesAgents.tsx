/**
 * HermesAgents view — browse the persistent Hermes agents registered
 * against the current project, their SOUL.md persona, and their recent
 * conversations/sessions.
 *
 * Backed by the /api/hermes/* routes added in Phase 0 + Phase 2:
 *
 *   GET /api/hermes/agents?project_id=<uuid>
 *   GET /api/hermes/agents/:name?project_id=<uuid>
 *   GET /api/hermes/agents/:name/conversations?project_id=<uuid>
 *   GET /api/hermes/conversations/:session_id/messages
 *
 * Read-only. Agents and conversations are written by the Hermes runtime;
 * this view is the dashboard's window into that data.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Users,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Bot,
  Cpu,
  Wrench,
  MessageSquare,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface HermesAgentConfig {
  model: string;
  toolset?: string;
  platform_access?: string[];
  metadata?: Record<string, unknown>;
}

interface HermesAgentListItem {
  agent_id: string;
  agent_name: string;
  config: HermesAgentConfig | null;
  created_at: string;
  updated_at: string;
}

interface HermesAgentDetail extends HermesAgentListItem {
  soul: string;
}

interface HermesConversation {
  conversation_id: string;
  session_id: string;
  platform: string;
  external_user_id: string | null;
  external_chat_id: string | null;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
}

interface HermesMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls: unknown;
  tool_results: unknown;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

interface HermesMessagesResponse {
  session_id: string;
  conversation_id: string;
  started_at: string;
  ended_at: string | null;
  platform: string;
  messages: HermesMessage[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function HermesAgents() {
  const { get } = useApi();
  const { projectId } = useProject();

  const [agents, setAgents] = useState<HermesAgentListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [detail, setDetail] = useState<HermesAgentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [conversations, setConversations] = useState<HermesConversation[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);

  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, HermesMessagesResponse>>({});
  const [messagesLoadingBySession, setMessagesLoadingBySession] = useState<Record<string, boolean>>({});
  const [messagesErrorBySession, setMessagesErrorBySession] = useState<Record<string, string>>({});

  const isValidProject = UUID_RE.test(projectId);

  const loadAgents = useCallback(() => {
    if (!isValidProject) {
      setAgents([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    get<HermesAgentListItem[]>(`/api/hermes/agents?project_id=${encodeURIComponent(projectId)}`)
      .then((data) => {
        setAgents(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : 'Failed to load agents');
        setError(msg);
        setLoading(false);
      });
  }, [get, projectId, isValidProject]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const openAgent = useCallback(
    async (name: string) => {
      setSelectedName(name);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      setConversations([]);
      setConvError(null);
      setConvLoading(true);
      setExpandedSessionId(null);
      setMessagesBySession({});
      setMessagesLoadingBySession({});
      setMessagesErrorBySession({});

      // Parallel fetch: agent detail + recent conversations
      const detailPromise = get<HermesAgentDetail>(
        `/api/hermes/agents/${encodeURIComponent(name)}?project_id=${encodeURIComponent(projectId)}`,
      )
        .then((data) => {
          setDetail(data);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message: unknown }).message)
              : 'Failed to load agent';
          setDetailError(msg);
        })
        .finally(() => {
          setDetailLoading(false);
        });

      const convPromise = get<HermesConversation[]>(
        `/api/hermes/agents/${encodeURIComponent(name)}/conversations?project_id=${encodeURIComponent(projectId)}&limit=50`,
      )
        .then((data) => {
          setConversations(Array.isArray(data) ? data : []);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message: unknown }).message)
              : 'Failed to load conversations';
          setConvError(msg);
        })
        .finally(() => {
          setConvLoading(false);
        });

      await Promise.all([detailPromise, convPromise]);
    },
    [get, projectId],
  );

  const toggleConversation = useCallback(
    async (sessionId: string) => {
      if (expandedSessionId === sessionId) {
        setExpandedSessionId(null);
        return;
      }
      setExpandedSessionId(sessionId);
      // Only fetch messages if we don't already have them cached
      if (messagesBySession[sessionId]) return;
      setMessagesLoadingBySession((prev) => ({ ...prev, [sessionId]: true }));
      setMessagesErrorBySession((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      try {
        const data = await get<HermesMessagesResponse>(
          `/api/hermes/conversations/${encodeURIComponent(sessionId)}/messages`,
        );
        setMessagesBySession((prev) => ({ ...prev, [sessionId]: data }));
      } catch (err: unknown) {
        const msg = err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Failed to load messages';
        setMessagesErrorBySession((prev) => ({ ...prev, [sessionId]: msg }));
      } finally {
        setMessagesLoadingBySession((prev) => ({ ...prev, [sessionId]: false }));
      }
    },
    [get, expandedSessionId, messagesBySession],
  );

  /* ---- Empty: no project selected ---------------------------------- */
  if (!isValidProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md">
          <Bot size={36} className="mx-auto mb-3 text-[var(--text-secondary)] opacity-60" />
          <p className="text-sm text-[var(--text-secondary)]">
            Select a project to browse its Hermes agents.
          </p>
        </div>
      </div>
    );
  }

  /* ---- Loading ----------------------------------------------------- */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-primary" />
          <span className="text-sm text-[var(--text-secondary)]">Loading Hermes agents…</span>
        </div>
      </div>
    );
  }

  /* ---- Error ------------------------------------------------------- */
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="card p-6 max-w-md text-center" style={{ backgroundColor: 'var(--bg-card)' }}>
          <AlertTriangle size={24} className="mx-auto mb-2 text-status-reverted" />
          <p className="text-sm text-status-reverted mb-3">{error}</p>
          <button
            onClick={loadAgents}
            className="px-3 py-1.5 text-xs rounded-md bg-[#063ff9] text-white hover:bg-[#0534d4]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const rows = agents ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <Users size={18} className="text-primary" />
              Hermes Agents
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Persistent named agents running on the Hermes runtime. Each agent keeps its own SOUL.md
              persona and shares memory with the rest of the team through HIPP0.
            </p>
          </div>
          <button
            onClick={loadAgents}
            className="p-2 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className="text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Empty state */}
        {rows.length === 0 && (
          <div className="card p-10 text-center" style={{ backgroundColor: 'var(--bg-card)' }}>
            <Bot size={36} className="mx-auto mb-3 text-[var(--text-secondary)] opacity-60" />
            <p className="text-sm font-medium mb-1">No agents registered yet</p>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
              Agents appear here after a Hermes runtime calls <code>POST /api/hermes/register</code>.
              See the Hermes integration docs to configure your first agent.
            </p>
          </div>
        )}

        {/* Grid layout: list + detail */}
        {rows.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* List */}
            <div className="lg:col-span-2 space-y-2">
              {rows.map((agent) => {
                const isActive = selectedName === agent.agent_name;
                return (
                  <button
                    key={agent.agent_id}
                    onClick={() => openAgent(agent.agent_name)}
                    className={`w-full text-left card p-4 hover:border-[#063ff9] transition-colors ${
                      isActive ? 'border-[#063ff9] ring-1 ring-[#063ff9]/40' : ''
                    }`}
                    style={{ backgroundColor: 'var(--bg-card)' }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{agent.agent_name}</div>
                        <div className="text-xs text-[var(--text-secondary)] mt-1 truncate flex items-center gap-1.5">
                          <Cpu size={12} />
                          {agent.config?.model ?? 'unknown model'}
                        </div>
                        {agent.config?.toolset && (
                          <div className="text-xs text-[var(--text-secondary)] mt-0.5 truncate flex items-center gap-1.5">
                            <Wrench size={12} />
                            {agent.config.toolset}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] text-[var(--text-secondary)] mt-2 opacity-70">
                      updated {formatTimestamp(agent.updated_at)}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Detail */}
            <div className="lg:col-span-3">
              {!selectedName && (
                <div
                  className="card p-10 text-center h-full flex items-center justify-center"
                  style={{ backgroundColor: 'var(--bg-card)' }}
                >
                  <p className="text-sm text-[var(--text-secondary)]">
                    Select an agent to see its persona and configuration.
                  </p>
                </div>
              )}

              {selectedName && detailLoading && (
                <div className="card p-10 text-center" style={{ backgroundColor: 'var(--bg-card)' }}>
                  <Loader2 size={20} className="mx-auto animate-spin text-primary" />
                </div>
              )}

              {selectedName && detailError && (
                <div className="card p-6 text-center" style={{ backgroundColor: 'var(--bg-card)' }}>
                  <AlertTriangle size={20} className="mx-auto mb-2 text-status-reverted" />
                  <p className="text-sm text-status-reverted">{detailError}</p>
                </div>
              )}

              {selectedName && detail && !detailLoading && (
                <div className="card p-6 space-y-5" style={{ backgroundColor: 'var(--bg-card)' }}>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-base font-semibold">{detail.agent_name}</h2>
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)] font-mono">
                      {detail.agent_id}
                    </div>
                  </div>

                  {/* Config */}
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                      Configuration
                    </div>
                    <dl className="text-xs space-y-1.5">
                      <div className="flex justify-between gap-3">
                        <dt className="text-[var(--text-secondary)]">Model</dt>
                        <dd className="font-mono text-right truncate">{detail.config?.model ?? '—'}</dd>
                      </div>
                      {detail.config?.toolset && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-[var(--text-secondary)]">Toolset</dt>
                          <dd className="font-mono text-right truncate">{detail.config.toolset}</dd>
                        </div>
                      )}
                      {detail.config?.platform_access && detail.config.platform_access.length > 0 && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-[var(--text-secondary)]">Platforms</dt>
                          <dd className="font-mono text-right truncate">
                            {detail.config.platform_access.join(', ')}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between gap-3">
                        <dt className="text-[var(--text-secondary)]">Created</dt>
                        <dd className="text-right">{formatTimestamp(detail.created_at)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-[var(--text-secondary)]">Updated</dt>
                        <dd className="text-right">{formatTimestamp(detail.updated_at)}</dd>
                      </div>
                    </dl>
                  </div>

                  {/* SOUL.md */}
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                      SOUL.md
                    </div>
                    <pre
                      className="text-xs whitespace-pre-wrap font-mono p-3 rounded-md overflow-x-auto"
                      style={{
                        backgroundColor: 'var(--bg-code, rgba(0,0,0,0.2))',
                        maxHeight: '40vh',
                      }}
                    >
                      {detail.soul || '(empty)'}
                    </pre>
                  </div>

                  {/* Recent conversations */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                        <MessageSquare size={12} />
                        Recent conversations
                      </div>
                      {convLoading && <Loader2 size={12} className="animate-spin text-primary" />}
                    </div>

                    {convError && (
                      <div className="text-xs text-status-reverted mb-2">{convError}</div>
                    )}

                    {!convLoading && !convError && conversations.length === 0 && (
                      <div className="text-xs text-[var(--text-secondary)] italic py-2">
                        No conversations yet for this agent.
                      </div>
                    )}

                    {conversations.length > 0 && (
                      <div className="space-y-1.5">
                        {conversations.map((conv) => {
                          const isExpanded = expandedSessionId === conv.session_id;
                          const msgs = messagesBySession[conv.session_id];
                          const msgLoading = messagesLoadingBySession[conv.session_id];
                          const msgError = messagesErrorBySession[conv.session_id];
                          return (
                            <div
                              key={conv.session_id}
                              className="rounded-md border border-[var(--border-color,rgba(255,255,255,0.08))]"
                            >
                              <button
                                onClick={() => toggleConversation(conv.session_id)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover,rgba(255,255,255,0.03))] transition-colors"
                              >
                                {isExpanded ? (
                                  <ChevronDown size={14} className="text-[var(--text-secondary)] shrink-0" />
                                ) : (
                                  <ChevronRight size={14} className="text-[var(--text-secondary)] shrink-0" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-medium truncate">
                                    {conv.platform}
                                    {conv.external_chat_id ? ` · ${conv.external_chat_id}` : ''}
                                  </div>
                                  <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                                    {formatTimestamp(conv.started_at)}
                                    {conv.ended_at ? ` → ${formatTimestamp(conv.ended_at)}` : ' · active'}
                                  </div>
                                </div>
                              </button>

                              {isExpanded && (
                                <div className="border-t border-[var(--border-color,rgba(255,255,255,0.08))] px-3 py-2">
                                  {msgLoading && (
                                    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                                      <Loader2 size={12} className="animate-spin" />
                                      Loading messages…
                                    </div>
                                  )}
                                  {msgError && (
                                    <div className="text-xs text-status-reverted">{msgError}</div>
                                  )}
                                  {msgs && msgs.messages.length === 0 && (
                                    <div className="text-xs text-[var(--text-secondary)] italic">
                                      No messages in this session.
                                    </div>
                                  )}
                                  {msgs && msgs.messages.length > 0 && (
                                    <div className="space-y-2 max-h-64 overflow-y-auto">
                                      {msgs.messages.map((msg) => (
                                        <div key={msg.id} className="text-xs">
                                          <div
                                            className="text-[10px] uppercase tracking-wider mb-0.5 font-semibold"
                                            style={{
                                              color: msg.role === 'user'
                                                ? 'var(--text-secondary)'
                                                : msg.role === 'assistant'
                                                  ? '#063ff9'
                                                  : 'var(--text-secondary)',
                                            }}
                                          >
                                            {msg.role}
                                          </div>
                                          <div className="whitespace-pre-wrap break-words">
                                            {msg.content}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
