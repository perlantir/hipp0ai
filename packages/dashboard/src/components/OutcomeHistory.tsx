import { useEffect, useState } from 'react';
import {
  CheckCircle,
  XCircle,
  Target,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  BarChart3,
  Users,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Outcome {
  id: string;
  compile_history_id: string;
  agent_id: string;
  task_completed: boolean | null;
  task_duration_ms: number | null;
  error_occurred: boolean;
  error_message: string | null;
  decisions_compiled: number;
  decisions_referenced: number;
  decisions_ignored: number;
  alignment_score: number | null;
  created_at: string;
}

interface AgentStat {
  agent_id: string;
  agent_name: string;
  total_outcomes: number;
  avg_alignment_score: number;
  avg_task_completion_rate: number;
  avg_task_duration_ms: number;
}

interface OutcomeSummary {
  total_outcomes: number;
  avg_alignment_score: number;
  avg_task_completion_rate: number;
  avg_task_duration_ms: number;
  by_agent: AgentStat[];
  trend: {
    period: string;
    alignment_delta: number;
    completion_delta: number;
    recent_count: number;
    previous_count: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatCard({
  label,
  value,
  icon,
  sub,
  warn,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`card p-4 flex items-start gap-3 ${warn ? 'ring-1 ring-status-reverted/40' : ''}`}
    >
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          warn ? 'bg-status-reverted/10' : 'bg-primary/10'
        }`}
      >
        <span className={warn ? 'text-status-reverted' : 'text-primary'}>{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-2xs text-[var(--text-secondary)] uppercase tracking-wide mb-0.5">
          {label}
        </p>
        <p
          className={`text-xl font-semibold tabular-nums leading-tight ${
            warn && typeof value === 'number' && value > 0 ? 'text-status-reverted' : ''
          }`}
        >
          {value}
        </p>
        {sub && <p className="text-2xs text-[var(--text-tertiary)] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function TrendIndicator({ delta, label }: { delta: number; label: string }) {
  if (Math.abs(delta) < 0.001) {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-[var(--text-tertiary)]">
        <Minus size={12} /> {label} unchanged
      </span>
    );
  }
  const positive = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-2xs ${
        positive ? 'text-status-active' : 'text-status-reverted'
      }`}
    >
      {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {positive ? '+' : ''}{pct(delta)} {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function OutcomeHistory() {
  const { get } = useApi();
  const { projectId } = useProject();
  const [summary, setSummary] = useState<OutcomeSummary | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId === 'default') return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    Promise.all([
      get<OutcomeSummary>(`/api/projects/${projectId}/outcome-summary`),
      // Get outcomes for all agents — we fetch the agents first
      get<Array<{ id: string; name: string }>>(`/api/projects/${projectId}/agents`),
    ])
      .then(async ([summaryData, agents]) => {
        if (cancelled) return;
        setSummary(summaryData);

        // Fetch outcomes from all agents
        const allOutcomes: Outcome[] = [];
        for (const agent of agents.slice(0, 10)) {
          try {
            const agentOutcomes = await get<Outcome[]>(
              `/api/agents/${agent.id}/outcomes?limit=20`,
            );
            allOutcomes.push(...agentOutcomes);
          } catch {
            // skip agents with no outcomes
          }
        }

        if (!cancelled) {
          allOutcomes.sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
          setOutcomes(allOutcomes.slice(0, 50));
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? 'Failed to load outcome data');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [get, projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-tertiary)' }}>
        <Loader2 className="animate-spin mr-2" size={20} />
        Loading outcomes...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="card p-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Outcome Tracking
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Passive feedback loop — track task outcomes and decision alignment
        </p>
      </div>

      {/* Summary stats */}
      {summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Total Outcomes"
              value={summary.total_outcomes}
              icon={<BarChart3 size={18} />}
              sub={`${summary.trend.recent_count} this week`}
            />
            <StatCard
              label="Success Rate"
              value={pct(summary.avg_task_completion_rate)}
              icon={<CheckCircle size={18} />}
              sub={
                summary.trend.completion_delta !== 0
                  ? `${summary.trend.completion_delta > 0 ? '+' : ''}${pct(summary.trend.completion_delta)} vs last week`
                  : 'vs last week'
              }
            />
            <StatCard
              label="Avg Alignment"
              value={pct(summary.avg_alignment_score)}
              icon={<Target size={18} />}
              sub={
                summary.trend.alignment_delta !== 0
                  ? `${summary.trend.alignment_delta > 0 ? '+' : ''}${pct(summary.trend.alignment_delta)} vs last week`
                  : 'vs last week'
              }
            />
            <StatCard
              label="Avg Duration"
              value={summary.avg_task_duration_ms ? formatDuration(summary.avg_task_duration_ms) : '--'}
              icon={<Clock size={18} />}
            />
          </div>

          {/* Trend */}
          <div className="card p-4 flex items-center gap-4 flex-wrap">
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              7-day Trend
            </span>
            <TrendIndicator delta={summary.trend.completion_delta} label="completion" />
            <TrendIndicator delta={summary.trend.alignment_delta} label="alignment" />
          </div>

          {/* Per-agent breakdown */}
          {summary.by_agent.length > 0 && (
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Users size={16} /> Per-Agent Stats
              </h2>
              <div className="space-y-3">
                {summary.by_agent.map((agent) => (
                  <div key={agent.agent_id} className="flex items-center gap-4">
                    <span
                      className="text-sm font-medium w-28 truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {agent.agent_name}
                    </span>
                    <div className="flex-1">
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: pct(agent.avg_alignment_score),
                            background: 'var(--accent-primary)',
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-xs tabular-nums w-14 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {pct(agent.avg_alignment_score)}
                    </span>
                    <span className="text-xs tabular-nums w-14 text-right" style={{ color: 'var(--text-tertiary)' }}>
                      {agent.total_outcomes} runs
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Outcome timeline */}
      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Recent Outcomes
        </h2>

        {outcomes.length === 0 ? (
          <p className="text-sm py-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
            No outcomes recorded yet. Outcomes are reported after compiled context is used.
          </p>
        ) : (
          <div className="space-y-2">
            {outcomes.map((o) => (
              <div
                key={o.id}
                className="flex items-center gap-3 py-2 px-3 rounded-lg"
                style={{ background: 'var(--bg-secondary)' }}
              >
                {/* Status icon */}
                {o.task_completed ? (
                  <CheckCircle size={16} className="text-status-active shrink-0" />
                ) : o.task_completed === false ? (
                  <XCircle size={16} className="text-status-reverted shrink-0" />
                ) : (
                  <Minus size={16} style={{ color: 'var(--text-tertiary)' }} className="shrink-0" />
                )}

                {/* Alignment bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: o.alignment_score != null ? pct(o.alignment_score) : '0%',
                          background:
                            o.alignment_score != null && o.alignment_score >= 0.7
                              ? 'var(--accent-success)'
                              : o.alignment_score != null && o.alignment_score >= 0.4
                                ? 'var(--accent-warning)'
                                : 'var(--accent-danger)',
                        }}
                      />
                    </div>
                    <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {o.alignment_score != null ? pct(o.alignment_score) : '--'}
                    </span>
                  </div>
                  <span className="text-2xs" style={{ color: 'var(--text-tertiary)' }}>
                    {o.decisions_referenced}/{o.decisions_compiled} decisions referenced
                  </span>
                </div>

                {/* Duration */}
                {o.task_duration_ms != null && (
                  <span className="text-2xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                    {formatDuration(o.task_duration_ms)}
                  </span>
                )}

                {/* Time */}
                <span className="text-2xs w-16 text-right shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                  {formatTime(o.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Task Success Card (embeddable monitoring widget)                    */
/* ------------------------------------------------------------------ */

export function TaskSuccessCard() {
  const { get } = useApi();
  const { projectId } = useProject();
  const [summary, setSummary] = useState<OutcomeSummary | null>(null);

  useEffect(() => {
    if (projectId === 'default') return;
    let cancelled = false;

    get<OutcomeSummary>(`/api/projects/${projectId}/outcome-summary`)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [get, projectId]);

  if (!summary || summary.total_outcomes === 0) return null;

  return (
    <div className="card p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
        Task Success
      </h3>
      <div className="flex items-end gap-4">
        <div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {pct(summary.avg_task_completion_rate)}
          </p>
          <p className="text-2xs" style={{ color: 'var(--text-tertiary)' }}>success rate</p>
        </div>
        <div>
          <p className="text-lg font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {pct(summary.avg_alignment_score)}
          </p>
          <p className="text-2xs" style={{ color: 'var(--text-tertiary)' }}>alignment</p>
        </div>
        <div className="flex-1 text-right">
          <TrendIndicator delta={summary.trend.completion_delta} label="" />
        </div>
      </div>
    </div>
  );
}
