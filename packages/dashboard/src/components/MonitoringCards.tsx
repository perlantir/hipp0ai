import { useEffect, useState } from 'react';
import {
  Activity,
  GitBranch,
  Cpu,
  MessageSquare,
  AlertTriangle,
  Users,
  Loader2,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface HealthData {
  extractionQuality: number;
  decisionsCount: number;
  edgesCount: number;
  compilesToday: number;
  avgCompileMs: number;
  feedbackRate: number;
  totalFeedback: number;
  contradictionsOpen: number;
  contradictionsFalsePositive: number;
  agentsTotal: number;
  agentsActive: number;
}

type HealthLevel = 'healthy' | 'warning' | 'problem';

/* ------------------------------------------------------------------ */
/*  Card config                                                        */
/* ------------------------------------------------------------------ */

interface CardConfig {
  label: string;
  icon: React.ReactNode;
  getValue: (d: HealthData) => string;
  getSub: (d: HealthData) => string;
  getLevel: (d: HealthData) => HealthLevel;
  viewLink: string;
}

const BORDER_COLORS: Record<HealthLevel, string> = {
  healthy: 'border-t-green-500',
  warning: 'border-t-amber-500',
  problem: 'border-t-red-500',
};

const CARDS: CardConfig[] = [
  {
    label: 'Extraction Quality',
    icon: <Activity size={18} />,
    getValue: (d) => `${d.extractionQuality}%`,
    getSub: (d) => d.extractionQuality >= 80 ? 'Good' : d.extractionQuality >= 50 ? 'Needs attention' : 'Low quality',
    getLevel: (d) => d.extractionQuality >= 80 ? 'healthy' : d.extractionQuality >= 50 ? 'warning' : 'problem',
    viewLink: 'stats',
  },
  {
    label: 'Decisions Graph',
    icon: <GitBranch size={18} />,
    getValue: (d) => String(d.decisionsCount),
    getSub: (d) => `${d.edgesCount} edges`,
    getLevel: (d) => d.decisionsCount > 0 ? 'healthy' : 'warning',
    viewLink: 'graph',
  },
  {
    label: 'Compiles Today',
    icon: <Cpu size={18} />,
    getValue: (d) => String(d.compilesToday),
    getSub: (d) => d.compilesToday > 0 ? `avg ${Math.round(d.avgCompileMs)}ms` : 'No compiles',
    getLevel: (d) => d.avgCompileMs > 5000 ? 'problem' : d.avgCompileMs > 2000 ? 'warning' : 'healthy',
    viewLink: 'compile-tester',
  },
  {
    label: 'Feedback Rate',
    icon: <MessageSquare size={18} />,
    getValue: (d) => d.compilesToday > 0 ? (d.totalFeedback / Math.max(d.compilesToday, 1)).toFixed(1) : '0',
    getSub: (d) => `${d.totalFeedback} total`,
    getLevel: (d) => d.feedbackRate > 0.5 ? 'healthy' : d.feedbackRate > 0 ? 'warning' : 'healthy',
    viewLink: 'stats',
  },
  {
    label: 'Contradictions',
    icon: <AlertTriangle size={18} />,
    getValue: (d) => String(d.contradictionsOpen),
    getSub: (d) => `${d.contradictionsFalsePositive} false positives`,
    getLevel: (d) => d.contradictionsOpen > 5 ? 'problem' : d.contradictionsOpen > 0 ? 'warning' : 'healthy',
    viewLink: 'contradictions',
  },
  {
    label: 'Agents',
    icon: <Users size={18} />,
    getValue: (d) => String(d.agentsTotal),
    getSub: (d) => `${d.agentsActive} active`,
    getLevel: (d) => d.agentsTotal > 0 ? 'healthy' : 'warning',
    viewLink: 'sessions',
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MonitoringCards({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const { get } = useApi();
  const { projectId } = useProject();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const [stats, metrics, contradictions, agents] = await Promise.allSettled([
          get<Record<string, unknown>>(`/api/projects/${projectId}/stats`),
          get<Record<string, unknown>>('/api/metrics'),
          get<Array<Record<string, unknown>>>(`/api/projects/${projectId}/contradictions?status=unresolved`),
          get<Array<Record<string, unknown>>>(`/api/projects/${projectId}/agents`),
        ]);

        if (cancelled) return;

        const s = stats.status === 'fulfilled' ? stats.value : ({} as Record<string, unknown>);
        const m = metrics.status === 'fulfilled' ? metrics.value : ({} as Record<string, unknown>);
        const c = contradictions.status === 'fulfilled' ? contradictions.value : [];
        const a = agents.status === 'fulfilled' ? agents.value : [];

        const totalDecisions = (s.total_decisions as number) ?? 0;
        const byStatus = (s.by_status as Record<string, number>) ?? {};
        const activeDecisions = byStatus.active ?? 0;

        setData({
          extractionQuality: totalDecisions > 0 ? Math.round((activeDecisions / totalDecisions) * 100) : 0,
          decisionsCount: totalDecisions,
          edgesCount: 0, // edges come from graph data
          compilesToday: (m.compiles_today as number) ?? 0,
          avgCompileMs: (m.avg_compile_ms as number) ?? 0,
          feedbackRate: 0,
          totalFeedback: 0,
          contradictionsOpen: Array.isArray(c) ? c.length : 0,
          contradictionsFalsePositive: 0,
          agentsTotal: Array.isArray(a) ? a.length : 0,
          agentsActive: Array.isArray(a) ? a.filter((ag) => ag.role !== 'inactive').length : 0,
        });
      } catch {
        // Fail silently — cards will show zero state
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [get, projectId]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card p-4 border-t-2 border-t-[var(--border-light)] animate-pulse">
            <div className="h-4 w-24 rounded bg-[var(--border-light)] mb-2" />
            <div className="h-7 w-16 rounded bg-[var(--border-light)] mb-1" />
            <div className="h-3 w-20 rounded bg-[var(--border-light)]" />
          </div>
        ))}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
      {CARDS.map((card) => {
        const level = card.getLevel(data);
        return (
          <button
            key={card.label}
            onClick={() => onNavigate?.(card.viewLink)}
            className={`card p-4 border-t-2 ${BORDER_COLORS[level]} text-left hover:shadow-md transition-shadow cursor-pointer`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[var(--text-secondary)]">{card.icon}</span>
              <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                {card.label}
              </span>
            </div>
            <p className="text-xl font-semibold tabular-nums">{card.getValue(data)}</p>
            <p className="text-2xs text-[var(--text-tertiary)] mt-0.5">{card.getSub(data)}</p>
          </button>
        );
      })}
    </div>
  );
}
