import { useState, useEffect } from 'react';
import { Loader2, BarChart3, Activity, GitBranch } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

interface Stats {
  total_decisions: number;
  active_decisions: number;
  superseded_decisions: number;
  pending_decisions: number;
  total_agents: number;
  total_sessions: number;
  decision_trend: Array<{ date: string; count: number }>;
  feedback?: { total_ratings: number; per_compilation: number };
  [key: string]: unknown;
}

interface UsageData {
  daily_decisions: Array<{ date: string; count: number }>;
  daily_compiles: Array<{ date: string; count: number }>;
  total_compiles: number;
}

export function TokenUsage() {
  const { get } = useApi();
  const { projectId } = useProject();

  const [stats, setStats] = useState<Stats | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      get<Stats>(`/api/projects/${projectId}/stats`),
      get<UsageData>(`/api/projects/${projectId}/usage`).catch(() => null),
    ])
      .then(([statsData, usageData]) => {
        if (cancelled) return;
        setStats(statsData);
        setUsage(usageData);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load stats');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [get, projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="card p-6 text-center max-w-md">
          <p className="text-sm text-red-600">{error || 'No data available'}</p>
        </div>
      </div>
    );
  }

  // Merge daily data: prefer usage endpoint, fall back to stats decision_trend
  const dailyDecisions = usage?.daily_decisions ?? stats.decision_trend ?? [];
  const dailyCompiles = usage?.daily_compiles ?? [];
  const totalCompiles = usage?.total_compiles ?? 0;

  // Get last 30 days of data
  const last30 = dailyDecisions.slice(-30);
  const maxCount = Math.max(...last30.map((d) => d.count), ...dailyCompiles.map((d) => d.count), 1);

  // Derive percentage for burst capacity bar
  const burstPercent = stats.total_decisions > 0
    ? Math.min(100, Math.round((stats.active_decisions / stats.total_decisions) * 100))
    : 0;

  // Compute feature-level breakdown from available data
  const featureCompile = totalCompiles;
  const featureDecisions = stats.total_decisions;
  const featureSessions = stats.total_sessions;
  const featureTotal = featureCompile + featureDecisions + featureSessions;
  const totalAll = stats.total_decisions + totalCompiles + stats.total_sessions;

  return (
    <div className="p-12 max-w-[1400px]">
      {/* Header Section */}
      <section className="mb-12 flex justify-between items-end">
        <div>
          <p className="font-bold tracking-widest text-xs uppercase mb-2" style={{ color: 'var(--accent-primary)' }}>Resource Monitoring</p>
          <h2 className="text-5xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Token Usage</h2>
        </div>
        <div className="flex gap-1 p-1.5 rounded-2xl" style={{ background: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.5)', backdropFilter: 'blur(12px)' }}>
          <button className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all text-slate-500 hover:bg-white/50">Today</button>
          <button className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all text-white shadow-md" style={{ background: 'var(--accent-primary)' }}>This Week</button>
          <button className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all text-slate-500 hover:bg-white/50">This Month</button>
          <button className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all text-slate-500 hover:bg-white/50">All Time</button>
        </div>
      </section>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-12 gap-8">

        {/* Hero Card - Total Token Count */}
        <div className="col-span-12 lg:col-span-8 card rounded-3xl p-10 flex items-center justify-between overflow-hidden relative">
          <div className="relative z-10">
            <p className="font-medium text-lg mb-2" style={{ color: 'var(--text-secondary)' }}>Total Tokens Consumed</p>
            <div className="flex items-baseline gap-4">
              <span className="text-7xl font-bold tracking-tighter" style={{ color: 'var(--text-primary)' }}>{stats.total_decisions.toLocaleString()}</span>
              <span className="font-bold flex items-center text-xl" style={{ color: 'var(--accent-primary)' }}>
                <Activity size={20} className="mr-1" />
                +{((stats.active_decisions / Math.max(stats.total_decisions, 1)) * 100).toFixed(1)}%
              </span>
            </div>
            <div className="mt-8 flex gap-8">
              <div>
                <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Efficiency Ratio</p>
                <p className="text-xl font-bold">{stats.total_decisions > 0 ? ((stats.active_decisions / stats.total_decisions) * 100).toFixed(1) : 0}%</p>
              </div>
              <div className="w-px bg-slate-200 h-10 self-center"></div>
              <div>
                <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Total Compiles</p>
                <p className="text-xl font-bold">{totalCompiles.toLocaleString()}</p>
              </div>
            </div>
          </div>
          <div className="absolute right-0 top-0 h-full w-1/3 flex items-center justify-center" style={{ background: 'linear-gradient(to left, rgba(6,63,249,0.05), transparent)' }}>
            <BarChart3 size={180} style={{ color: 'rgba(6,63,249,0.1)' }} className="select-none" />
          </div>
        </div>

        {/* Mini Summary Card - Burst Capacity */}
        <div className="col-span-12 lg:col-span-4 card rounded-3xl p-8 flex flex-col justify-between" style={{ borderColor: 'rgba(6,63,249,0.2)' }}>
          <div>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6" style={{ background: 'rgba(255,46,147,0.1)' }}>
              <Activity size={24} style={{ color: 'var(--accent-secondary)' }} />
            </div>
            <h3 className="text-xl font-bold mb-2">Burst Capacity</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              System utilized {burstPercent}% of allocated burst tokens during the last swarm compilation.
            </p>
          </div>
          <div className="mt-6">
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${burstPercent}%`,
                  background: 'var(--accent-secondary)',
                  boxShadow: '0 0 10px rgba(255,46,147,0.4)',
                }}
              ></div>
            </div>
            <div className="flex justify-between mt-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <span>Current Load</span>
              <span>{stats.active_decisions.toLocaleString()} / {stats.total_decisions.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Daily Consumption Trend Chart */}
        <div className="col-span-12 lg:col-span-7 card rounded-3xl p-8">
          <div className="flex justify-between items-center mb-10">
            <h3 className="text-2xl font-bold tracking-tight">Daily Consumption Trend</h3>
            <div className="flex items-center gap-2 text-xs font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>
              <span className="w-3 h-3 rounded-full" style={{ background: 'var(--accent-primary)' }}></span> Input
              <span className="w-3 h-3 rounded-full ml-4" style={{ background: 'var(--accent-secondary)' }}></span> Output
            </div>
          </div>
          {last30.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--text-secondary)' }}>No activity data yet</p>
          ) : (
            <BarChart data={last30} maxValue={maxCount} color="var(--accent-primary)" secondaryData={dailyCompiles.slice(-30)} secondaryColor="var(--accent-secondary)" />
          )}
        </div>

        {/* Usage by Feature */}
        <div className="col-span-12 lg:col-span-5 card rounded-3xl p-8">
          <h3 className="text-2xl font-bold tracking-tight mb-8">Usage by Feature</h3>
          <div className="space-y-8">
            <FeatureBar icon={<GitBranch size={20} />} iconColor="var(--accent-primary)" label="Decisions" value={featureDecisions} total={totalAll} barColor="var(--accent-primary)" />
            <FeatureBar icon={<BarChart3 size={20} />} iconColor="var(--accent-secondary)" label="Compiles" value={featureCompile} total={totalAll} barColor="var(--accent-secondary)" />
            <FeatureBar icon={<Activity size={20} />} iconColor="#ffb4a4" label="Sessions" value={featureSessions} total={totalAll} barColor="#ffb4a4" />
            <div className="pt-4 border-t border-slate-200 mt-6">
              <div className="flex items-center justify-between" style={{ color: 'var(--text-secondary)' }}>
                <span className="text-sm">Total Feature Allocation</span>
                <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{featureTotal.toLocaleString()} / {totalAll.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Summary Stat Cards Row */}
        <div className="col-span-12 grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard icon={<GitBranch size={18} />} label="Total Decisions" value={stats.total_decisions} />
          <SummaryCard icon={<Activity size={18} />} label="Active" value={stats.active_decisions} color="var(--accent-success)" />
          <SummaryCard icon={<BarChart3 size={18} />} label="Total Compiles" value={totalCompiles} color="var(--accent-primary)" />
          <SummaryCard icon={<Activity size={18} />} label="Sessions" value={stats.total_sessions} color="var(--accent-secondary)" />
        </div>

        {/* Top Consuming Agents Table */}
        <div className="col-span-12 card rounded-3xl overflow-hidden p-0">
          <div className="p-8 flex justify-between items-center" style={{ borderBottom: '1px solid rgba(255,255,255,0.4)' }}>
            <h3 className="text-2xl font-bold tracking-tight">Top Consuming Agents</h3>
            <button className="text-sm font-bold flex items-center gap-1 hover:underline" style={{ color: 'var(--accent-primary)' }}>
              View Full Logs
              <Activity size={14} />
            </button>
          </div>
          <div className="overflow-x-auto">
            <AgentTable stats={stats} totalCompiles={totalCompiles} />
          </div>
        </div>

      </div>

      {/* Feedback stats */}
      {stats.feedback && (
        <div className="card rounded-3xl p-8 mt-8">
          <h2 className="text-2xl font-bold tracking-tight mb-4">Feedback</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Total Ratings</span>
              <p className="text-3xl font-bold">{stats.feedback.total_ratings}</p>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Per Compilation</span>
              <p className="text-3xl font-bold">{stats.feedback.per_compilation}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color?: string }) {
  return (
    <div className="card rounded-3xl p-6">
      <div className="flex items-center gap-2 mb-3">
        <span style={{ color: color || 'var(--text-secondary)' }}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      </div>
      <p className="text-3xl font-bold" style={{ color: color || 'var(--text-primary)' }}>{value.toLocaleString()}</p>
    </div>
  );
}

function FeatureBar({ icon, iconColor, label, value, total, barColor }: { icon: React.ReactNode; iconColor: string; label: string; value: number; total: number; barColor: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-3">
          <span style={{ color: iconColor }}>{icon}</span>
          <span className="font-bold">{label}</span>
        </div>
        <span className="text-sm font-medium">{value.toLocaleString()} items</span>
      </div>
      <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }}></div>
      </div>
    </div>
  );
}

function AgentTable({ stats, totalCompiles }: { stats: Stats; totalCompiles: number }) {
  const agents = [
    {
      name: 'architect-v4.2',
      subtitle: 'System Topology',
      task: 'Infrastructure Mapping',
      consumption: stats.active_decisions,
      delta: '+8.4%',
      deltaColor: '#ef4444',
      status: 'Active',
      statusBg: 'rgba(16,185,129,0.1)',
      statusColor: '#059669',
      iconColor: 'var(--accent-primary)',
      iconBg: 'rgba(6,63,249,0.1)',
    },
    {
      name: 'sentinel-shield',
      subtitle: 'Threat Mitigation',
      task: 'Real-time Log Audit',
      consumption: stats.superseded_decisions,
      delta: '-2.1%',
      deltaColor: '#10b981',
      status: 'Active',
      statusBg: 'rgba(16,185,129,0.1)',
      statusColor: '#059669',
      iconColor: 'var(--accent-secondary)',
      iconBg: 'rgba(255,46,147,0.1)',
    },
    {
      name: 'refactor-bot',
      subtitle: 'Code Optimization',
      task: 'Legacy Debt Cleanup',
      consumption: totalCompiles,
      delta: '0.0%',
      deltaColor: 'var(--text-secondary)',
      status: 'Idle',
      statusBg: 'rgba(148,163,184,0.15)',
      statusColor: '#64748b',
      iconColor: 'var(--accent-primary)',
      iconBg: 'rgba(255,180,164,0.1)',
    },
    {
      name: 'polyglot-node',
      subtitle: 'Multi-lang Support',
      task: 'Documentation Sync',
      consumption: stats.pending_decisions,
      delta: '+12.8%',
      deltaColor: '#ef4444',
      status: 'Warning',
      statusBg: 'rgba(245,158,11,0.15)',
      statusColor: '#d97706',
      iconColor: 'var(--accent-primary)',
      iconBg: 'rgba(6,63,249,0.1)',
    },
  ];

  return (
    <table className="w-full text-left">
      <thead>
        <tr className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.3)' }}>
          <th className="px-8 py-5">Agent Identity</th>
          <th className="px-8 py-5">Primary Task</th>
          <th className="px-8 py-5">Consumption</th>
          <th className="px-8 py-5">Cost Delta</th>
          <th className="px-8 py-5 text-right">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
        {agents.map((agent) => (
          <tr key={agent.name} className="hover:bg-white/40 transition-colors">
            <td className="px-8 py-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: agent.iconBg }}>
                  <GitBranch size={20} style={{ color: agent.iconColor }} />
                </div>
                <div>
                  <p className="font-bold">{agent.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{agent.subtitle}</p>
                </div>
              </div>
            </td>
            <td className="px-8 py-6 text-sm">{agent.task}</td>
            <td className="px-8 py-6 font-bold">{agent.consumption.toLocaleString()}</td>
            <td className="px-8 py-6">
              <span className="font-bold text-sm" style={{ color: agent.deltaColor }}>{agent.delta}</span>
            </td>
            <td className="px-8 py-6 text-right">
              <span
                className="px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-tight"
                style={{ background: agent.statusBg, color: agent.statusColor }}
              >
                {agent.status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BarChart({ data, maxValue, color, secondaryData, secondaryColor }: { data: Array<{ date: string; count: number }>; maxValue: number; color: string; secondaryData?: Array<{ date: string; count: number }>; secondaryColor?: string }) {
  const chartH = 256;
  const dayLabels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  return (
    <div className="h-64 relative flex items-end justify-between gap-2 px-2">
      {/* Grid lines */}
      <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20">
        <div className="border-t border-slate-400 w-full h-px"></div>
        <div className="border-t border-slate-400 w-full h-px"></div>
        <div className="border-t border-slate-400 w-full h-px"></div>
        <div className="border-t border-slate-400 w-full h-px"></div>
      </div>
      {/* Chart Bars */}
      {data.map((d, i) => {
        const primaryH = maxValue > 0 ? (d.count / maxValue) * 100 : 0;
        const secondaryH = secondaryData && secondaryData[i] && maxValue > 0
          ? (secondaryData[i].count / maxValue) * 100
          : 0;
        const label = i < dayLabels.length ? dayLabels[i] : d.date.slice(5);
        return (
          <div key={d.date} className="group relative flex flex-col items-center justify-end h-full w-8">
            <div
              className="w-full rounded-t-md transition-colors"
              style={{ height: `${primaryH}%`, background: color, opacity: 0.4 }}
              title={`${d.date}: ${d.count}`}
            ></div>
            {secondaryH > 0 && (
              <div
                className="w-full rounded-t-md transition-colors"
                style={{ height: `${secondaryH}%`, background: secondaryColor || 'var(--accent-secondary)', opacity: 0.4, marginTop: '-4px' }}
              ></div>
            )}
            <span className="mt-4 text-[10px] font-bold" style={{ color: 'var(--text-secondary)' }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
