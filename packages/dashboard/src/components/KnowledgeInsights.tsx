import { useEffect, useState, useCallback } from 'react';
import {
  Lightbulb,
  Loader2,
  AlertTriangle,
  X,
  Zap,
  CheckCircle,
  Shield,
  Ban,
  Book,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import { ExportButton } from './ExportButton';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type InsightType = 'procedure' | 'policy' | 'anti_pattern' | 'domain_rule';

interface Insight {
  id: string;
  project_id: string;
  type: InsightType;
  title: string;
  description: string;
  confidence: number;
  evidence_count: number;
  status?: 'active' | 'dismissed';
  metadata?: Record<string, unknown>;
  created_at?: string;
}

interface GenerateResponse {
  insights_generated: number;
  duration_ms?: number;
}

type TabFilter = 'all' | InsightType;

/* ------------------------------------------------------------------ */
/*  Type metadata                                                      */
/* ------------------------------------------------------------------ */

const TYPE_META: Record<
  InsightType,
  { label: string; bg: string; text: string; border: string; icon: React.ReactNode }
> = {
  procedure: {
    label: 'Procedure',
    bg: 'bg-blue-500/15',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
    icon: <CheckCircle size={13} />,
  },
  policy: {
    label: 'Policy',
    bg: 'bg-green-500/15',
    text: 'text-green-400',
    border: 'border-green-500/30',
    icon: <Shield size={13} />,
  },
  anti_pattern: {
    label: 'Anti-pattern',
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    border: 'border-red-500/30',
    icon: <Ban size={13} />,
  },
  domain_rule: {
    label: 'Domain Rule',
    bg: 'bg-purple-500/15',
    text: 'text-purple-400',
    border: 'border-purple-500/30',
    icon: <Book size={13} />,
  },
};

/* ------------------------------------------------------------------ */
/*  Toast                                                              */
/* ------------------------------------------------------------------ */

function Toast({
  message,
  kind,
  onClose,
}: {
  message: string;
  kind: 'success' | 'error';
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className="fixed bottom-4 right-4 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm z-50"
      style={{
        backgroundColor: kind === 'success' ? '#065f46' : '#7f1d1d',
        color: kind === 'success' ? '#d1fae5' : '#fecaca',
        border: `1px solid ${kind === 'success' ? '#059669' : '#b91c1c'}`,
      }}
    >
      {kind === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function KnowledgeInsights() {
  const { get, post, patch } = useApi();
  const { projectId } = useProject();

  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [tab, setTab] = useState<TabFilter>('all');
  const [toast, setToast] = useState<{
    message: string;
    kind: 'success' | 'error';
  } | null>(null);

  const fetchInsights = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const path =
        tab === 'all'
          ? `/api/projects/${projectId}/insights`
          : `/api/projects/${projectId}/insights?type=${tab}`;
      const data = await get<Insight[] | { insights: Insight[] }>(path);
      const list = Array.isArray(data)
        ? data
        : Array.isArray((data as { insights?: Insight[] })?.insights)
          ? (data as { insights: Insight[] }).insights
          : [];
      setInsights(list.filter((i) => i.status !== 'dismissed'));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : String((err as { message?: string })?.message ?? 'Failed to load insights'),
      );
    } finally {
      setLoading(false);
    }
  }, [get, projectId, tab]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const handleGenerate = async () => {
    if (!projectId || generating) return;
    setGenerating(true);
    try {
      const result = await post<GenerateResponse>(
        `/api/projects/${projectId}/insights/generate`,
        {},
      );
      setToast({
        message: `Generated ${result?.insights_generated ?? 0} new insights`,
        kind: 'success',
      });
      await fetchInsights();
    } catch (err) {
      setToast({
        message:
          err instanceof Error
            ? err.message
            : String((err as { message?: string })?.message ?? 'Generation failed'),
        kind: 'error',
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleDismiss = async (insightId: string) => {
    try {
      await patch(`/api/projects/${projectId}/insights/${insightId}`, {
        status: 'dismissed',
      });
      setInsights((prev) => prev.filter((i) => i.id !== insightId));
      setToast({ message: 'Insight dismissed', kind: 'success' });
    } catch (err) {
      setToast({
        message:
          err instanceof Error
            ? err.message
            : String((err as { message?: string })?.message ?? 'Dismiss failed'),
        kind: 'error',
      });
    }
  };

  const filtered = tab === 'all' ? insights : insights.filter((i) => i.type === tab);

  const counts: Record<TabFilter, number> = {
    all: insights.length,
    procedure: insights.filter((i) => i.type === 'procedure').length,
    policy: insights.filter((i) => i.type === 'policy').length,
    anti_pattern: insights.filter((i) => i.type === 'anti_pattern').length,
    domain_rule: insights.filter((i) => i.type === 'domain_rule').length,
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Toast */}
        {toast && (
          <Toast
            message={toast.message}
            kind={toast.kind}
            onClose={() => setToast(null)}
          />
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <Lightbulb size={18} className="text-primary" />
              Knowledge Insights
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Procedures, policies, anti-patterns, and domain rules extracted from
              your decision graph.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExportButton
              data={filtered}
              filename={`hipp0-insights-${tab}`}
              disabled={loading}
            />
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Zap size={16} />
              )}
              Generate Insights
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex gap-1 flex-wrap"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          {(
            [
              { key: 'all', label: 'All' },
              { key: 'procedure', label: 'Procedures' },
              { key: 'policy', label: 'Policies' },
              { key: 'anti_pattern', label: 'Anti-patterns' },
              { key: 'domain_rule', label: 'Domain Rules' },
            ] as { key: TabFilter; label: string }[]
          ).map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  color: active
                    ? 'var(--accent, #d97706)'
                    : 'var(--text-secondary)',
                  borderBottom: active
                    ? '2px solid var(--accent, #d97706)'
                    : '2px solid transparent',
                  marginBottom: '-1px',
                }}
              >
                {t.label}
                <span className="ml-1.5 text-xs opacity-60">
                  ({counts[t.key]})
                </span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-primary" />
          </div>
        ) : error ? (
          <div
            className="rounded-xl border p-6 max-w-md mx-auto text-center"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <AlertTriangle
              size={22}
              className="mx-auto mb-2 text-status-reverted"
            />
            <p className="text-sm text-status-reverted">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="rounded-xl border p-10 text-center"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <Lightbulb
              size={32}
              className="mx-auto mb-3 text-[var(--text-tertiary)]"
            />
            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
              No insights yet
            </p>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
              Click &quot;Generate Insights&quot; to analyze your decision graph.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((insight) => {
              const meta = TYPE_META[insight.type] ?? TYPE_META.procedure;
              return (
                <div
                  key={insight.id}
                  className="rounded-xl border p-4 transition-colors flex flex-col"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                      'var(--bg-card-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                  }}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-medium border ${meta.bg} ${meta.text} ${meta.border}`}
                    >
                      {meta.icon}
                      {meta.label}
                    </span>
                    <button
                      onClick={() => handleDismiss(insight.id)}
                      className="p-1 rounded hover:bg-[var(--border)] text-[var(--text-tertiary)]"
                      title="Dismiss"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2 leading-snug">
                    {insight.title}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4 flex-1">
                    {insight.description}
                  </p>
                  <div
                    className="flex items-center justify-between pt-3 text-2xs"
                    style={{ borderTop: '1px solid var(--border)' }}
                  >
                    <span className="text-[var(--text-tertiary)]">
                      {insight.evidence_count} evidence
                    </span>
                    <span className="text-[var(--text-secondary)] font-medium">
                      {Math.round((insight.confidence ?? 0) * 100)}% confidence
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default KnowledgeInsights;
