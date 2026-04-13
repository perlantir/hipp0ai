/**
 * Pulse view — the dashboard home for the persistent multi-agent system.
 *
 * Single-call aggregate from /api/hermes/pulse:
 *   - agent_count
 *   - active_session_count
 *   - recent_sessions (joined to agent_name, ordered by started_at DESC)
 *
 * Refreshes automatically every 30 seconds so the activity feed stays live
 * while the user is watching. Manual refresh button always available.
 *
 * This is Phase 3 of the Hermes integration — the first view the user
 * hits when they open the dashboard, showing "what is happening right now"
 * across every agent in the project.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Activity,
  Users as UsersIcon,
  Radio,
  MessageSquare,
  Loader2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface HermesPulseSession {
  conversation_id: string;
  session_id: string;
  agent_name: string;
  platform: string;
  external_user_id: string | null;
  external_chat_id: string | null;
  started_at: string;
  ended_at: string | null;
}

interface HermesPulseResponse {
  agent_count: number;
  active_session_count: number;
  recent_sessions: HermesPulseSession[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTO_REFRESH_MS = 30_000;

function formatRelativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const deltaSec = Math.floor((now - then) / 1000);
    if (deltaSec < 60) return `${deltaSec}s ago`;
    if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
    if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
    return `${Math.floor(deltaSec / 86400)}d ago`;
  } catch {
    return iso;
  }
}

/* ------------------------------------------------------------------ */
/*  Stat card                                                          */
/* ------------------------------------------------------------------ */

function StatCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  loading: boolean;
}) {
  return (
    <div
      className="card p-5"
      style={{ backgroundColor: 'var(--bg-card)' }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-semibold">
          {label}
        </span>
        <span className="text-[var(--text-secondary)]">{icon}</span>
      </div>
      <div className="text-2xl font-semibold">
        {loading ? <Loader2 size={20} className="animate-spin text-primary" /> : (value ?? 0)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Pulse() {
  const { get } = useApi();
  const { subscribe } = useWebSocket();
  const { projectId } = useProject();

  const [data, setData] = useState<HermesPulseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isValidProject = UUID_RE.test(projectId);

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (!isValidProject) {
        setLoading(false);
        setData(null);
        return;
      }
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const resp = await get<HermesPulseResponse>(
          `/api/hermes/pulse?project_id=${encodeURIComponent(projectId)}&limit=20`,
        );
        setData(resp);
      } catch (err: unknown) {
        const msg = err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Failed to load pulse data';
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [get, projectId, isValidProject],
  );

  // Initial load + auto-refresh interval
  useEffect(() => {
    load(false);
    if (!isValidProject) return;
    intervalRef.current = setInterval(() => load(true), AUTO_REFRESH_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [load, isValidProject]);

  // Live WebSocket updates: refetch on Hermes lifecycle events.
  //
  // These events are broadcast from the hermes routes on register,
  // session/start, and session/end. On any of them, we re-pull the
  // pulse aggregate so the UI stays in sync with zero polling delay.
  // Events carry project_id; we filter to only our project.
  useEffect(() => {
    if (!isValidProject) return;
    const handler = (payload: unknown) => {
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'project_id' in payload &&
        (payload as { project_id: unknown }).project_id === projectId
      ) {
        load(true);
      }
    };
    const unsub1 = subscribe('hermes.agent.registered', handler);
    const unsub2 = subscribe('hermes.session.started', handler);
    const unsub3 = subscribe('hermes.session.ended', handler);
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [subscribe, load, isValidProject, projectId]);

  /* ---- Empty: no project ------------------------------------------ */
  if (!isValidProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md">
          <Activity size={36} className="mx-auto mb-3 text-[var(--text-secondary)] opacity-60" />
          <p className="text-sm text-[var(--text-secondary)]">
            Select a project to see its Pulse.
          </p>
        </div>
      </div>
    );
  }

  /* ---- Loading ---------------------------------------------------- */
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-primary" />
          <span className="text-sm text-[var(--text-secondary)]">Loading Pulse…</span>
        </div>
      </div>
    );
  }

  /* ---- Error ------------------------------------------------------ */
  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="card p-6 max-w-md text-center" style={{ backgroundColor: 'var(--bg-card)' }}>
          <AlertTriangle size={24} className="mx-auto mb-2 text-status-reverted" />
          <p className="text-sm text-status-reverted mb-3">{error}</p>
          <button
            onClick={() => load(false)}
            className="px-3 py-1.5 text-xs rounded-md bg-[#063ff9] text-white hover:bg-[#0534d4]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const agentCount = data?.agent_count ?? 0;
  const activeCount = data?.active_session_count ?? 0;
  const sessions = data?.recent_sessions ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <Activity size={18} className="text-primary" />
              Pulse
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Live activity across every Hermes agent in this project. Auto-refreshes every 30 seconds.
            </p>
          </div>
          <button
            onClick={() => load(true)}
            className="p-2 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
            title="Refresh"
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 size={16} className="animate-spin text-[var(--text-secondary)]" />
            ) : (
              <RefreshCw size={16} className="text-[var(--text-secondary)]" />
            )}
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={<UsersIcon size={16} />}
            label="Registered Agents"
            value={agentCount}
            loading={loading && !data}
          />
          <StatCard
            icon={<Radio size={16} />}
            label="Active Sessions"
            value={activeCount}
            loading={loading && !data}
          />
          <StatCard
            icon={<MessageSquare size={16} />}
            label="Recent Sessions"
            value={sessions.length}
            loading={loading && !data}
          />
        </div>

        {/* Recent sessions feed */}
        <div>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <MessageSquare size={14} className="text-[var(--text-secondary)]" />
            Recent Activity
          </h2>

          {sessions.length === 0 && (
            <div className="card p-8 text-center" style={{ backgroundColor: 'var(--bg-card)' }}>
              <p className="text-sm text-[var(--text-secondary)]">
                No sessions yet. Once a Hermes runtime calls{' '}
                <code className="text-xs font-mono">POST /api/hermes/session/start</code>, activity will appear here.
              </p>
            </div>
          )}

          {sessions.length > 0 && (
            <div className="space-y-2">
              {sessions.map((s) => {
                const isActive = !s.ended_at;
                return (
                  <div
                    key={s.session_id}
                    className="card px-4 py-3 flex items-center gap-3"
                    style={{ backgroundColor: 'var(--bg-card)' }}
                  >
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-green-500' : 'bg-[var(--text-secondary)] opacity-40'}`}
                      title={isActive ? 'Active' : 'Ended'}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                        <span>{s.agent_name}</span>
                        <span className="text-[var(--text-secondary)] text-xs font-normal">
                          on {s.platform}
                        </span>
                        {s.external_chat_id && (
                          <span className="text-[var(--text-secondary)] text-xs font-mono font-normal">
                            · {s.external_chat_id}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                        started {formatRelativeTime(s.started_at)}
                        {s.ended_at ? ` · ended ${formatRelativeTime(s.ended_at)}` : ''}
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-green-500">
                        live
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
