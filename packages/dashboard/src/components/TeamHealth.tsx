import { useCallback, useEffect, useState } from 'react';
import {
  HeartPulse,
  RefreshCw,
  FileText,
  Activity,
  AlertTriangle,
  Users,
  TrendingUp,
  TrendingDown,
  Minus,
  Gauge,
  Target,
  Crown,
  Loader2,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TopAgent {
  name: string;
  success_rate: number;
}

interface WeakestDomain {
  domain: string;
  success_rate: number;
}

interface TeamHealthData {
  total_decisions: number;
  active_decisions: number;
  decisions_this_week: number;
  contradictions_unresolved: number;
  avg_success_rate: number;
  agent_count: number;
  top_performing_agent: TopAgent;
  weakest_domain: WeakestDomain;
  decision_velocity: number;
  memory_growth_rate: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '0%';
  return `${Math.round(n * 100)}%`;
}

function formatDelta(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 10) / 10;
  if (rounded > 0) return `+${rounded}`;
  return `${rounded}`;
}

function TrendArrow({ value, size = 14 }: { value: number; size?: number }) {
  if (value > 0) return <TrendingUp size={size} className="text-emerald-600" />;
  if (value < 0) return <TrendingDown size={size} className="text-red-600" />;
  return <Minus size={size} className="text-[var(--text-secondary)]" />;
}

function trendColor(value: number): string {
  if (value > 0) return 'text-emerald-600';
  if (value < 0) return 'text-red-600';
  return 'text-[var(--text-secondary)]';
}

/* ------------------------------------------------------------------ */
/*  MetricCard                                                         */
/* ------------------------------------------------------------------ */

function MetricCard({
  label,
  value,
  icon,
  warn,
  trendValue,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  warn?: boolean;
  trendValue?: number;
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: 'var(--bg-card)',
        borderColor: warn ? '#DC2626' : 'var(--border)',
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{
            background: warn ? 'rgba(220, 38, 38, 0.1)' : 'rgba(217, 119, 6, 0.1)',
            color: warn ? '#DC2626' : '#D97706',
          }}
        >
          {icon}
        </div>
        {trendValue !== undefined && <TrendArrow value={trendValue} />}
      </div>
      <p
        className={`text-2xl font-semibold tabular-nums leading-tight ${
          warn ? 'text-red-600' : ''
        }`}
        style={warn ? undefined : { color: 'var(--text-primary)' }}
      >
        {value}
      </p>
      <p
        className="text-xs mt-1"
        style={{ color: 'var(--text-secondary)' }}
      >
        {label}
      </p>
      {trendValue !== undefined && (
        <p className={`text-2xs mt-0.5 font-medium ${trendColor(trendValue)}`}>
          {formatDelta(trendValue)}
          {label.toLowerCase().includes('growth') ? '%' : ''} wk/wk
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function TeamHealth() {
  const { get } = useApi();
  const { projectId } = useProject();
  const [health, setHealth] = useState<TeamHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(() => {
    setLoading(true);
    setError(null);
    get<TeamHealthData>(`/api/projects/${projectId}/analytics/health`)
      .then((data) => setHealth(data))
      .catch((err) => {
        setError(err?.message ?? 'Failed to load team health');
      })
      .finally(() => setLoading(false));
  }, [get, projectId]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  /* ---- Loading -------------------------------------------------- */
  if (loading && !health) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin" style={{ color: '#D97706' }} />
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Loading team health…
          </span>
        </div>
      </div>
    );
  }

  /* ---- Error ---------------------------------------------------- */
  if (error && !health) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-start justify-between mb-6">
            <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <HeartPulse size={20} style={{ color: '#D97706' }} /> Team Health
            </h1>
            <button
              onClick={fetchHealth}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white"
              style={{ background: '#D97706' }}
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
          <div
            className="rounded-xl border p-6 text-center"
            style={{ background: 'var(--bg-card)', borderColor: '#DC2626' }}
          >
            <AlertTriangle size={24} className="mx-auto mb-2 text-red-600" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const h = health!;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1
              className="text-xl font-bold flex items-center gap-2"
              style={{ color: 'var(--text-primary)' }}
            >
              <HeartPulse size={20} style={{ color: '#D97706' }} /> Team Health
            </h1>
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              A snapshot of your team's memory vitals
            </p>
          </div>
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-all"
            style={{
              background: loading ? '#92400E' : '#D97706',
              opacity: loading ? 0.7 : 1,
            }}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Metric grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Total Decisions"
            value={h.total_decisions}
            icon={<FileText size={18} />}
          />
          <MetricCard
            label="Active Decisions"
            value={h.active_decisions}
            icon={<Activity size={18} />}
          />
          <MetricCard
            label="Decisions This Week"
            value={h.decisions_this_week}
            icon={<TrendingUp size={18} />}
          />
          <MetricCard
            label="Contradictions Unresolved"
            value={h.contradictions_unresolved}
            icon={<AlertTriangle size={18} />}
            warn={h.contradictions_unresolved > 0}
          />
          <MetricCard
            label="Avg Success Rate"
            value={formatPct(h.avg_success_rate)}
            icon={<Gauge size={18} />}
          />
          <MetricCard
            label="Agent Count"
            value={h.agent_count}
            icon={<Users size={18} />}
          />
          <MetricCard
            label="Decision Velocity"
            value={formatDelta(h.decision_velocity)}
            icon={<Activity size={18} />}
            trendValue={h.decision_velocity}
          />
          <MetricCard
            label="Memory Growth Rate"
            value={`${formatDelta(h.memory_growth_rate)}%`}
            icon={<TrendingUp size={18} />}
            trendValue={h.memory_growth_rate}
          />
        </div>

        {/* Callout cards */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Top performing agent */}
          <div
            className="rounded-xl border p-5"
            style={{
              background: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Crown size={16} className="text-emerald-600" />
              <h2
                className="text-sm font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                Top Performing Agent
              </h2>
            </div>
            {h.top_performing_agent.name ? (
              <>
                <p
                  className="text-2xl font-semibold mb-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {h.top_performing_agent.name}
                </p>
                <p className="text-sm text-emerald-600 font-medium">
                  {formatPct(h.top_performing_agent.success_rate)} success rate
                </p>
              </>
            ) : (
              <p
                className="text-sm italic"
                style={{ color: 'var(--text-secondary)' }}
              >
                Not enough outcome data yet.
              </p>
            )}
          </div>

          {/* Weakest domain */}
          <div
            className="rounded-xl border p-5"
            style={{
              background: 'var(--bg-card)',
              borderColor: '#DC2626',
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Target size={16} className="text-red-600" />
              <h2
                className="text-sm font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                Weakest Domain
              </h2>
            </div>
            {h.weakest_domain.domain ? (
              <>
                <p
                  className="text-2xl font-semibold mb-1 capitalize"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {h.weakest_domain.domain}
                </p>
                <p className="text-sm text-red-600 font-medium">
                  {formatPct(h.weakest_domain.success_rate)} success rate
                </p>
              </>
            ) : (
              <p
                className="text-sm italic"
                style={{ color: 'var(--text-secondary)' }}
              >
                No weak domains detected.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
