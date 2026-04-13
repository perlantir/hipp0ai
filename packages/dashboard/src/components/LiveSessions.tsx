import React, { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import {
  Loader2,
  Play,
  Pause,
  CheckCircle,
  Plus,
  ChevronRight,
  ChevronLeft,
  Users,
  Clock,
  Activity,
} from 'lucide-react';
import { OrchestrationPanel } from './OrchestrationPanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TaskSession {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  agents_involved: string[];
  current_step: number;
  state_summary: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface SessionStep {
  id: string;
  session_id: string;
  step_number: number;
  agent_name: string;
  agent_role: string | null;
  task_description: string;
  output: string | null;
  output_summary: string | null;
  artifacts: unknown[];
  decisions_created: string[];
  duration_ms: number | null;
  status: string;
  created_at: string;
}

interface SessionState {
  session: TaskSession;
  steps: SessionStep[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'active': return '#22C55E';
    case 'paused': return '#EAB308';
    case 'completed': return 'var(--accent-primary)';
    case 'cancelled': return 'var(--accent-danger)';
    default: return 'var(--text-tertiary)';
  }
}

function stepStatusColor(status: string): string {
  switch (status) {
    case 'completed': return '#22C55E';
    case 'in_progress': return '#EAB308';
    case 'failed': return '#EF4444';
    case 'skipped': return 'var(--text-tertiary)';
    default: return 'var(--text-secondary)';
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LiveSessions() {
  const { projectId } = useProject();
  const { get, post } = useApi();

  const [sessions, setSessions] = useState<TaskSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail view
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionState | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // New session form
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Filter
  const [statusFilter, setStatusFilter] = useState<string>('');

  /* ---- Fetch sessions ---------------------------------------------- */
  const fetchSessions = async () => {
    if (projectId === 'default') return;
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const data = await get<TaskSession[]>(`/api/projects/${projectId}/sessions-live${qs}`);
      setSessions(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Failed to load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, statusFilter]);

  /* ---- Fetch detail ------------------------------------------------ */
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    get<SessionState>(`/api/tasks/session/${selectedId}/state`)
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, get]);

  /* ---- Create session ---------------------------------------------- */
  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await post<{ session_id: string }>('/api/tasks/session/start', {
        project_id: projectId,
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
      });
      setNewTitle('');
      setNewDesc('');
      setShowForm(false);
      await fetchSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  /* ---- Status actions ---------------------------------------------- */
  const handleAction = async (id: string, action: 'pause' | 'resume' | 'complete') => {
    try {
      await post<TaskSession>(`/api/tasks/session/${id}/${action}`, {});
      await fetchSessions();
      if (selectedId === id) {
        const data = await get<SessionState>(`/api/tasks/session/${id}/state`);
        setDetail(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  /* ---- Render ------------------------------------------------------ */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-secondary)' }}>
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading sessions...
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.15)' }}>
            <Activity className="w-5 h-5" style={{ color: '#22C55E' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Live Tasks</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Multi-step task sessions where agents share real outputs
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 rounded-md text-sm font-medium text-white flex items-center gap-2"
          style={{ background: 'var(--accent-primary)' }}
        >
          <Plus className="w-4 h-4" />
          New Session
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--accent-danger)', border: '1px solid var(--accent-danger)' }}>
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* New session form */}
      {showForm && (
        <div className="mb-4 rounded-lg p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Start New Session</h3>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Title</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g., Implement auth system"
              className="w-full p-2 rounded-md text-sm"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Description (optional)</label>
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
              className="w-full p-2 rounded-md text-sm"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newTitle.trim()}
              className="px-4 py-2 rounded-md text-sm font-medium text-white flex items-center gap-2"
              style={{ background: creating ? '#6B7280' : '#22C55E' }}
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Start
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-md text-sm"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {['', 'active', 'paused', 'completed'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className="px-3 py-1.5 rounded-md text-xs font-medium"
            style={{
              background: statusFilter === s ? 'var(--accent-primary)' : 'var(--bg-secondary)',
              color: statusFilter === s ? '#fff' : 'var(--text-secondary)',
              border: '1px solid var(--border-light)',
            }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Detail view */}
      {selectedId && detail && (
        <div className="mb-6 rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-1 text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ChevronLeft className="w-4 h-4" /> Back to list
            </button>
            <div className="flex gap-2">
              {detail.session.status === 'active' && (
                <button
                  onClick={() => handleAction(selectedId, 'pause')}
                  className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1"
                  style={{ background: 'rgba(234,179,8,0.15)', color: '#EAB308', border: '1px solid #EAB308' }}
                >
                  <Pause className="w-3 h-3" /> Pause
                </button>
              )}
              {detail.session.status === 'paused' && (
                <button
                  onClick={() => handleAction(selectedId, 'resume')}
                  className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1"
                  style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', border: '1px solid #22C55E' }}
                >
                  <Play className="w-3 h-3" /> Resume
                </button>
              )}
              {(detail.session.status === 'active' || detail.session.status === 'paused') && (
                <button
                  onClick={() => handleAction(selectedId, 'complete')}
                  className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1"
                  style={{ background: 'rgba(59,130,246,0.15)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)' }}
                >
                  <CheckCircle className="w-3 h-3" /> Complete
                </button>
              )}
            </div>
          </div>

          <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{detail.session.title}</h2>
          {detail.session.description && (
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>{detail.session.description}</p>
          )}

          <div className="flex gap-4 text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: statusColor(detail.session.status) }} />
              {detail.session.status}
            </span>
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {detail.session.agents_involved.join(', ') || 'none'}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo(detail.session.updated_at)}
            </span>
          </div>

          {/* Step timeline */}
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
            Steps ({detail.steps.length})
          </h3>

          {detail.steps.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
              No steps recorded yet. Use the API or MCP tools to record steps.
            </div>
          ) : (
            <div className="space-y-3">
              {detail.steps.map((step) => (
                <div
                  key={step.id}
                  className="rounded-lg p-3"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-card)', color: 'var(--text-tertiary)' }}>
                        #{step.step_number}
                      </span>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {step.agent_name}
                      </span>
                      {step.agent_role && (
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>({step.agent_role})</span>
                      )}
                    </div>
                    <span className="text-xs" style={{ color: stepStatusColor(step.status) }}>
                      {step.status}
                    </span>
                  </div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                    {step.task_description}
                  </p>
                  {step.output_summary && (
                    <p className="text-xs mt-1 p-2 rounded" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                      {step.output_summary}
                    </p>
                  )}
                  <div className="flex gap-3 mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {step.duration_ms != null && <span>{(step.duration_ms / 1000).toFixed(1)}s</span>}
                    {step.decisions_created.length > 0 && <span>{step.decisions_created.length} decisions</span>}
                    <span>{timeAgo(step.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Smart Orchestrator (Phase 3) */}
          <OrchestrationPanel
            sessionId={selectedId}
            sessionStatus={detail.session.status}
            onRefresh={async () => {
              const data = await get<SessionState>(`/api/tasks/session/${selectedId}/state`);
              setDetail(data);
            }}
          />
        </div>
      )}

      {/* Session list */}
      {!selectedId && (
        <>
          {sessions.length === 0 ? (
            <div className="text-center py-16" style={{ color: 'var(--text-tertiary)' }}>
              <Activity className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium mb-2">No task sessions yet</p>
              <p className="text-sm">Start a session to coordinate multi-agent task workflows.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className="w-full text-left rounded-lg p-4 flex items-center justify-between transition-colors"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: statusColor(s.status) }} />
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {s.title}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}>
                        {s.status}
                      </span>
                    </div>
                    <div className="flex gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      <span>{s.current_step} step{s.current_step !== 1 ? 's' : ''}</span>
                      {s.agents_involved.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {s.agents_involved.join(', ')}
                        </span>
                      )}
                      <span>{timeAgo(s.updated_at)}</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {detailLoading && (
        <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-secondary)' }}>
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading session...
        </div>
      )}
    </div>
  );
}
