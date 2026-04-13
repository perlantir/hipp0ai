import { useEffect, useState, useCallback } from 'react';
import {
  Share2,
  Loader2,
  AlertTriangle,
  Users,
  CheckCircle,
  TrendingUp,
  Globe,
  Download,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SharedPattern {
  id: string;
  title: string;
  description: string;
  domain?: string;
  adoption_count: number;
  success_rate: number;
  contributor_count?: number;
  tags?: string[];
  adopted?: boolean;
  match_score?: number;
}

interface CommunityStats {
  total_patterns: number;
  total_contributors: number;
  top_domains: { name: string; count: number }[];
  total_adoptions?: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function successRateColor(rate: number): string {
  if (rate >= 0.75) return 'text-green-400';
  if (rate >= 0.5) return 'text-yellow-400';
  return 'text-red-400';
}

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

type ViewMode = 'all' | 'relevant';

export function SharedPatterns() {
  const { get, post } = useApi();
  const { projectId } = useProject();

  const [patterns, setPatterns] = useState<SharedPattern[]>([]);
  const [stats, setStats] = useState<CommunityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('all');
  const [domainFilter, setDomainFilter] = useState<string>('');
  const [adoptingId, setAdoptingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    kind: 'success' | 'error';
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [patternsData, statsData] = await Promise.all([
        view === 'relevant' && projectId
          ? get<SharedPattern[] | { patterns: SharedPattern[] }>(
              `/api/projects/${projectId}/suggested-patterns`,
            )
          : get<SharedPattern[] | { patterns: SharedPattern[] }>(
              domainFilter
                ? `/api/shared-patterns?domain=${encodeURIComponent(domainFilter)}`
                : `/api/shared-patterns`,
            ),
        get<CommunityStats>('/api/shared-patterns/community-stats').catch(
          () => null,
        ),
      ]);

      const list = Array.isArray(patternsData)
        ? patternsData
        : Array.isArray(
              (patternsData as { patterns?: SharedPattern[] })?.patterns,
            )
          ? (patternsData as { patterns: SharedPattern[] }).patterns
          : [];
      setPatterns(list);
      setStats(statsData);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : String((err as { message?: string })?.message ?? 'Failed to load patterns'),
      );
    } finally {
      setLoading(false);
    }
  }, [get, projectId, view, domainFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAdopt = async (pattern: SharedPattern) => {
    if (!projectId) {
      setToast({ message: 'No project selected', kind: 'error' });
      return;
    }
    setAdoptingId(pattern.id);
    try {
      await post(
        `/api/projects/${projectId}/patterns/${pattern.id}/adopt`,
        {},
      );
      setPatterns((prev) =>
        prev.map((p) =>
          p.id === pattern.id
            ? { ...p, adopted: true, adoption_count: p.adoption_count + 1 }
            : p,
        ),
      );
      setToast({ message: `Adopted "${pattern.title}"`, kind: 'success' });
    } catch (err) {
      setToast({
        message:
          err instanceof Error
            ? err.message
            : String((err as { message?: string })?.message ?? 'Adoption failed'),
        kind: 'error',
      });
    } finally {
      setAdoptingId(null);
    }
  };

  // Build unique domain list from patterns + stats
  const availableDomains = Array.from(
    new Set([
      ...(stats?.top_domains?.map((d) => d.name) ?? []),
      ...patterns.map((p) => p.domain).filter(Boolean),
    ]),
  ) as string[];

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
        <div>
          <h1 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <Share2 size={18} className="text-primary" />
            Shared Patterns
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Community patterns from other projects (anonymized) that your team
            can adopt.
          </p>
        </div>

        {/* Community stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div
              className="rounded-xl border p-4 flex items-start gap-3"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10">
                <Globe size={18} className="text-primary" />
              </div>
              <div>
                <p className="text-2xs uppercase tracking-wide text-[var(--text-secondary)] mb-0.5">
                  Total Patterns
                </p>
                <p className="text-xl font-semibold text-[var(--text-primary)]">
                  {stats.total_patterns ?? 0}
                </p>
              </div>
            </div>
            <div
              className="rounded-xl border p-4 flex items-start gap-3"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10">
                <Users size={18} className="text-primary" />
              </div>
              <div>
                <p className="text-2xs uppercase tracking-wide text-[var(--text-secondary)] mb-0.5">
                  Contributors
                </p>
                <p className="text-xl font-semibold text-[var(--text-primary)]">
                  {stats.total_contributors ?? 0}
                </p>
              </div>
            </div>
            <div
              className="rounded-xl border p-4"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border)',
              }}
            >
              <p className="text-2xs uppercase tracking-wide text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
                <TrendingUp size={12} />
                Top Domains
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(stats.top_domains ?? []).slice(0, 5).map((d) => (
                  <span
                    key={d.name}
                    className="px-2 py-0.5 rounded text-2xs font-medium capitalize bg-primary/10 text-primary"
                  >
                    {d.name} ({d.count})
                  </span>
                ))}
                {(!stats.top_domains || stats.top_domains.length === 0) && (
                  <span className="text-xs text-[var(--text-tertiary)]">
                    No domains yet
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div
            className="flex rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--border)' }}
          >
            {(
              [
                { key: 'all', label: 'Show all' },
                { key: 'relevant', label: 'Relevant to my project' },
              ] as { key: ViewMode; label: string }[]
            ).map((opt) => (
              <button
                key={opt.key}
                onClick={() => setView(opt.key)}
                className="px-4 py-2 text-xs font-medium transition-colors"
                style={{
                  backgroundColor:
                    view === opt.key
                      ? 'var(--accent, #d97706)'
                      : 'transparent',
                  color:
                    view === opt.key ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {view === 'all' && availableDomains.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-secondary)]">
                Domain:
              </label>
              <select
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg text-xs border outline-none focus:ring-2 focus:ring-primary/50"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="">All</option>
                {availableDomains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
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
        ) : patterns.length === 0 ? (
          <div
            className="rounded-xl border p-10 text-center"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <Share2
              size={32}
              className="mx-auto mb-3 text-[var(--text-tertiary)]"
            />
            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
              No shared patterns available
            </p>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
              {view === 'relevant'
                ? 'No patterns match your project yet. Try switching to "Show all".'
                : 'The community pattern library is currently empty.'}
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {patterns.map((pattern) => (
              <div
                key={pattern.id}
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
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] leading-snug">
                    {pattern.title}
                  </h3>
                  {pattern.domain && (
                    <span
                      className="px-2 py-0.5 rounded text-2xs font-medium capitalize shrink-0"
                      style={{
                        backgroundColor: 'var(--bg-card-hover)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      {pattern.domain}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-3 flex-1">
                  {pattern.description}
                </p>

                {pattern.tags && pattern.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {pattern.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 rounded text-2xs bg-primary/10 text-primary"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                <div
                  className="flex items-center justify-between pt-3 mb-3 text-2xs"
                  style={{ borderTop: '1px solid var(--border)' }}
                >
                  <span className="text-[var(--text-tertiary)]">
                    {pattern.adoption_count} adoptions
                  </span>
                  <span
                    className={`font-semibold ${successRateColor(pattern.success_rate ?? 0)}`}
                  >
                    {Math.round((pattern.success_rate ?? 0) * 100)}% success
                  </span>
                </div>

                <button
                  onClick={() => handleAdopt(pattern)}
                  disabled={
                    adoptingId === pattern.id || pattern.adopted || !projectId
                  }
                  className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {adoptingId === pattern.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : pattern.adopted ? (
                    <>
                      <CheckCircle size={14} /> Adopted
                    </>
                  ) : (
                    <>
                      <Download size={14} /> Adopt
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SharedPatterns;
