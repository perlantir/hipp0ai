import { useEffect, useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  AlertTriangle,
  Users,
  FileText,
  Clock,
  Loader2,
  Activity,
  Download,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentDecisionCount {
  agent: string;
  count: number;
}

interface ActivityItem {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  agent?: string;
}

interface TrendPoint {
  date: string;
  count: number;
}

interface DomainCount {
  name: string;
  count: number;
  agents: string[];
}

interface ProjectStatsData {
  total_decisions: number;
  by_status: {
    active: number;
    superseded: number;
    reverted: number;
    pending: number;
  };
  decisions_per_agent?: AgentDecisionCount[];
  unresolved_contradictions: number;
  total_agents: number;
  total_artifacts: number;
  total_sessions: number;
  recent_activity: ActivityItem[];
  decision_trend?: TrendPoint[];
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

const STATUS_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  active: { bg: 'bg-status-active/10', text: 'text-status-active', bar: 'bg-status-active' },
  superseded: {
    bg: 'bg-status-superseded/10',
    text: 'text-status-superseded',
    bar: 'bg-status-superseded',
  },
  reverted: {
    bg: 'bg-status-reverted/10',
    text: 'text-status-reverted',
    bar: 'bg-status-reverted',
  },
  pending: {
    bg: 'bg-status-pending/10',
    text: 'text-status-pending',
    bar: 'bg-status-pending',
  },
};

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
      className={`card p-6 rounded-2xl flex flex-col justify-between hover:shadow-xl transition-all ${warn ? 'ring-1 ring-status-reverted/40' : ''}`}
    >
      <div className="flex justify-between items-start">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
          {label}
        </span>
        {warn ? (
          <div className="w-3 h-3 bg-red-500 rounded-full shadow-[0_0_10px_rgba(220,38,38,0.6)]" />
        ) : (
          <div className="w-3 h-3 bg-green-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.6)]" />
        )}
      </div>
      <div className="mt-4">
        <span
          className={`text-4xl font-bold ${
            warn && typeof value === 'number' && value > 0 ? 'text-status-reverted' : ''
          }`}
        >
          {value}
        </span>
        {sub && <p className="text-xs font-bold mt-1 text-[var(--text-tertiary)] uppercase tracking-tighter">{sub}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ProjectStats() {
  const { get } = useApi();
  const { projectId } = useProject();

  const [stats, setStats] = useState<ProjectStatsData>({
    total_decisions: 0,
    by_status: { active: 0, superseded: 0, reverted: 0, pending: 0 },
    decisions_per_agent: [],
    decision_trend: [],
    unresolved_contradictions: 0,
    total_agents: 0,
    total_artifacts: 0,
    total_sessions: 0,
    recent_activity: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domainData, setDomainData] = useState<DomainCount[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      get<ProjectStatsData>(`/api/projects/${projectId}/stats`),
      get<{ domains: DomainCount[] }>(`/api/projects/${projectId}/domains`).catch(() => ({ domains: [] })),
    ])
      .then(([data, domainResp]) => {
        if (!cancelled) {
          setStats({
            ...data,
            by_status: data.by_status ?? { active: 0, superseded: 0, reverted: 0, pending: 0 },
            decisions_per_agent: data.decisions_per_agent ?? [],
            decision_trend: data.decision_trend ?? [],
            recent_activity: data.recent_activity ?? [],
          });
          setDomainData(domainResp.domains ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err?.message ?? 'Failed to load project stats'));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [get, projectId]);

  /* ---- Loading ---------------------------------------------------- */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-primary" />
          <span className="text-sm text-[var(--text-secondary)]">Loading stats…</span>
        </div>
      </div>
    );
  }

  /* ---- Error ------------------------------------------------------ */
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="card p-6 max-w-md text-center">
          <AlertTriangle size={24} className="mx-auto mb-2 text-status-reverted" />
          <p className="text-sm text-status-reverted">{error}</p>
        </div>
      </div>
    );
  }

  const agentData = stats.decisions_per_agent ?? [];
  const trendData = stats.decision_trend ?? [];

  const maxAgentCount =
    agentData.length > 0
      ? Math.max(...agentData.map((a) => a.count))
      : 1;

  const trendMax =
    trendData.length > 0 ? Math.max(...trendData.map((t) => t.count), 1) : 1;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-8 py-8 space-y-10">
        {/* Header */}
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-bold tracking-tight mb-2">System Health</h1>
            <p className="text-lg text-[var(--text-secondary)]">
              Monitoring core orchestration nodes and cognitive latency.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={async () => {
                try {
                  const data = await get(`/api/projects/${projectId}/export`);
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `hipp0-export-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  alert('Export failed');
                }
              }}
              className="card px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-white/80 transition-all"
            >
              <Download size={14} /> Export Project
            </button>
            <button
              className="bg-primary text-white px-6 py-2 rounded-xl text-sm font-bold shadow-[0_0_20px_rgba(6,63,249,0.4)] hover:-translate-y-1 transition-all"
              onClick={() => {/* placeholder for deep diagnostic */}}
            >
              Deep Diagnostic
            </button>
          </div>
        </div>

        {/* Bento Grid - Stat Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            label="Total Decisions"
            value={stats.total_decisions}
            icon={<FileText size={18} />}
          />
          <StatCard
            label="Contradictions"
            value={stats.unresolved_contradictions}
            icon={<AlertTriangle size={18} />}
            warn={stats.unresolved_contradictions > 0}
            sub={stats.unresolved_contradictions > 0 ? 'Needs attention' : 'All clear'}
          />
          <StatCard label="Total Agents" value={stats.total_agents} icon={<Users size={18} />} />
          <StatCard label="Sessions" value={stats.total_sessions} icon={<Clock size={18} />} />
        </div>

        {/* Decisions by status */}
        <div className="card p-8 rounded-[2rem]">
          <h2 className="text-xl font-bold mb-8 flex items-center gap-2">
            <BarChart3 size={16} className="text-primary" />
            Node Vitality
          </h2>
          <div className="space-y-6">
            {(['active', 'superseded', 'reverted', 'pending'] as const).map((status) => {
              const colors = STATUS_COLORS[status];
              const count = stats.by_status[status] ?? 0;
              const pct =
                stats.total_decisions > 0 ? Math.round((count / stats.total_decisions) * 100) : 0;
              return (
                <div key={status} className="flex items-center justify-between p-4 rounded-2xl bg-white/40">
                  <div className="flex items-center gap-4">
                    <div className={`w-3 h-3 rounded-full ${colors.bar}`} />
                    <div>
                      <p className="text-sm font-bold capitalize">{status}</p>
                      <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-widest">{pct}% of total</p>
                    </div>
                  </div>
                  <span className={`font-bold text-sm ${colors.text}`}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Second Tier Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Decisions per agent */}
          <div className="lg:col-span-2 card p-8 rounded-[2rem] relative overflow-hidden">
            <div className="flex justify-between items-start mb-8">
              <div>
                <h2 className="text-xl font-bold">Decisions per Agent</h2>
                <p className="text-[var(--text-secondary)] text-sm">Agent activity distribution</p>
              </div>
              <Users size={16} className="text-primary" />
            </div>
            {agentData.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)] py-4 text-center">No agent data</p>
            ) : (
              <div className="space-y-3">
                {agentData
                  .sort((a, b) => b.count - a.count)
                  .map((row) => {
                    const pct =
                      maxAgentCount > 0 ? Math.round((row.count / maxAgentCount) * 100) : 0;
                    return (
                      <div key={row.agent}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium truncate max-w-[70%]">
                            {row.agent}
                          </span>
                          <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                            {row.count}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-[var(--border-light)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Artifacts + extra metrics (sidebar) */}
          <div className="lg:col-span-1 space-y-6">
            <div className="card p-8 rounded-[2rem]">
              <h3 className="text-xl font-bold mb-8">Infrastructure</h3>
              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-white/40">
                  <div className="flex items-center gap-4">
                    <FileText size={18} className="text-green-500" />
                    <div>
                      <p className="text-sm font-bold">Artifacts</p>
                      <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-widest">Total stored</p>
                    </div>
                  </div>
                  <span className="text-primary font-bold text-sm">{stats.total_artifacts}</span>
                </div>

                {stats.unresolved_contradictions > 0 && (
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-white/40 border-t-2 border-red-500/10 pt-6">
                    <div className="flex items-center gap-4">
                      <AlertTriangle size={18} className="text-red-500" />
                      <div>
                        <p className="text-sm font-bold">Contradictions</p>
                        <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-widest">Needs attention</p>
                      </div>
                    </div>
                    <span className="bg-red-100 text-red-700 px-2 py-1 rounded-md text-[10px] font-extrabold">
                      {stats.unresolved_contradictions}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Domain distribution */}
        {domainData.length > 0 && (
          <div className="card p-8 rounded-[2rem]">
            <h2 className="text-xl font-bold mb-8 flex items-center gap-2">
              <BarChart3 size={16} className="text-primary" />
              Decisions by Domain
            </h2>
            <div className="space-y-3">
              {domainData.map((row) => {
                const maxDomainCount = Math.max(...domainData.map((d) => d.count), 1);
                const pct = Math.round((row.count / maxDomainCount) * 100);
                return (
                  <div key={row.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium capitalize truncate max-w-[50%]">
                        {row.name}
                      </span>
                      <div className="flex items-center gap-2">
                        {row.agents.length > 0 && (
                          <span className="text-2xs text-[var(--text-tertiary)]">
                            {row.agents.slice(0, 3).join(', ')}{row.agents.length > 3 ? ` +${row.agents.length - 3}` : ''}
                          </span>
                        )}
                        <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                          {row.count}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--border-light)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/70 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Decision trend - Response Time Chart */}
        {trendData.length > 0 && (
          <div className="card p-8 rounded-[2rem] relative overflow-hidden">
            <div className="flex justify-between items-start mb-8">
              <div>
                <h2 className="text-xl font-bold">Decision Trend</h2>
                <p className="text-[var(--text-secondary)] text-sm">Activity over time</p>
              </div>
              <div className="flex gap-2">
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest">
                  <span className="w-2 h-2 rounded-full bg-primary" /> Live
                </span>
              </div>
            </div>
            <div className="h-64 flex items-end gap-1 px-2 relative">
              {/* Horizontal Grid Lines */}
              <div className="absolute inset-0 flex flex-col justify-between opacity-10">
                <div className="border-t border-[var(--text-primary)] w-full" />
                <div className="border-t border-[var(--text-primary)] w-full" />
                <div className="border-t border-[var(--text-primary)] w-full" />
                <div className="border-t border-[var(--text-primary)] w-full" />
              </div>
              {trendData.map((point, idx) => {
                const heightPct = trendMax > 0 ? Math.round((point.count / trendMax) * 100) : 0;
                const isHighest = point.count === trendMax;
                return (
                  <div
                    key={point.date}
                    className={`w-full rounded-t-lg group relative ${isHighest ? 'bg-primary shadow-[0_0_20px_rgba(6,63,249,0.4)]' : 'bg-primary/20'}`}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                    title={`${formatDate(point.date)}: ${point.count}`}
                  >
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[var(--text-primary)] text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      {point.count}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* X-axis labels */}
            {trendData.length >= 2 && (
              <div className="flex justify-between mt-4 text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-widest px-2">
                <span>{formatDate(trendData[0].date)}</span>
                <span>
                  {formatDate(
                    trendData[Math.floor(trendData.length / 2)].date,
                  )}
                </span>
                <span>{formatDate(trendData[trendData.length - 1].date)}</span>
              </div>
            )}
          </div>
        )}

        {/* Recent activity - Deep Infrastructure Inventory */}
        {stats.recent_activity && stats.recent_activity.length > 0 && (
          <section className="card rounded-[2.5rem] overflow-hidden shadow-2xl">
            <div className="bg-[var(--text-primary)] text-white p-8">
              <h3 className="text-2xl font-bold">Deep Infrastructure Inventory</h3>
              <p className="text-slate-400 text-sm mt-1">Recent activity and status updates.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[var(--border-light)]">
                    <th className="px-8 py-6 text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">Activity</th>
                    <th className="px-8 py-6 text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">Type</th>
                    <th className="px-8 py-6 text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">Agent</th>
                    <th className="px-8 py-6 text-right text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-light)]">
                  {stats.recent_activity.map((item) => (
                    <tr key={item.id} className="hover:bg-white/40 transition-colors">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-primary/5 rounded-lg text-primary">
                            <Activity size={14} />
                          </div>
                          <span className="font-bold text-sm">{item.description}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <span className="bg-green-100 text-green-700 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase">
                          {(item.type ?? "").replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-8 py-6 text-sm font-medium">{item.agent || '-'}</td>
                      <td className="px-8 py-6 text-right">
                        <span className="text-sm text-[var(--text-secondary)]">{formatTime(item.timestamp)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
